// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { RASTER_MAX_IMAGE_PIXELS } from "../pdfjs-guard";
import { VIEWER_KEPT_IMAGE_PIXELS } from "../viewer";
import {
  EDITOR_KEPT_IMAGE_PIXELS,
  EDITOR_KEPT_PAGES,
  editorPdfjs,
  openEditorPdf,
} from "./page-render";
import { viewerProofPdf } from "@/tests/viewer-fixtures";

/**
 * What the editor's page canvas (Edit, Annotate, Sign PDF) RETAINS of what
 * pdf.js decoded, as the pages are drawn.
 *
 * History (PDF Viewer review, PR #310, 2026-11-10): the viewer was found
 * keeping the decoded images of its last ten pages with no pixel cap, and
 * fixed with a budget read from pdf.js's per-page store. The editor kept the
 * last EDITOR_KEPT_PAGES (6) the same way — six 25 MP scan pages held 150 MP
 * of decoded images, three times what one image may have on the raster path.
 * It now shares the viewer's rule (`../kept-pages`).
 *
 * The property is asserted on what each page still holds, read from a model
 * of pdf.js's per-page object store (a page holds its decoded images from
 * its draw until its `cleanup()`), counted by THIS file. The real pdf.js
 * store and the process's own memory are measured in a child process by
 * src/tests/hostile/pdfjs-guard-bounds.test.ts ("editor-retention").
 */

interface FakeImage {
  width: number;
  height: number;
}

/**
 * A pdf.js page as the editor uses it, holding `images` once drawn,
 * and `inline` images in its operator list as pdf.js keeps small inline ones
 * (decoded RGBA inside the operator's arguments, never in `objs`).
 */
function fakePage(
  images: readonly FakeImage[],
  inline: readonly FakeImage[] = [],
) {
  const objs = new Map<string, FakeImage>();
  const intents = new Map<string, { operatorList: { argsArray: unknown[] } }>();
  const page = {
    rotate: 0,
    _intentStates: intents,
    objs: {
      *[Symbol.iterator]() {
        yield* objs.entries();
      },
    },
    cleaned: 0,
    getViewport: ({ scale = 1 }: { scale?: number } = {}) => ({
      width: 100 * scale,
      height: 100 * scale,
    }),
    render: () => {
      images.forEach((img, i) => objs.set(`img_${i}`, img));
      intents.set("display", {
        operatorList: {
          argsArray: inline.map((img) => [
            {
              width: img.width,
              height: img.height,
              data: new Uint8ClampedArray(img.width * img.height * 4),
            },
          ]),
        },
      });
      return { promise: Promise.resolve(), cancel: () => {} };
    },
    cleanup: () => {
      page.cleaned += 1;
      objs.clear();
      intents.clear();
      return true;
    },
    /** What this page holds now, counted by the model, not by the editor. */
    held: () =>
      [...objs.values()].reduce((s, i) => s + i.width * i.height, 0) +
      (intents.size > 0
        ? inline.reduce((s, i) => s + i.width * i.height, 0)
        : 0),
  };
  return page;
}

type FakePage = ReturnType<typeof fakePage>;

async function openWith(pages: FakePage[]) {
  const real = editorPdfjs.load;
  editorPdfjs.load = (async () => ({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pages.length,
        getPage: (n: number) => Promise.resolve(pages[n - 1]),
      }),
      destroy: () => Promise.resolve(),
    }),
  })) as unknown as typeof real;
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0 }),
  });
  try {
    return await openEditorPdf(viewerProofPdf());
  } finally {
    editorPdfjs.load = real;
  }
}

const retained = (pages: FakePage[]) =>
  pages.reduce((sum, p) => sum + p.held(), 0);

afterEach(() => vi.unstubAllGlobals());

describe("the editor bounds what it retains, not only what it shows", () => {
  it("the pixel budget is one raster image's budget, and the viewer's", () => {
    expect(EDITOR_KEPT_IMAGE_PIXELS).toBe(RASTER_MAX_IMAGE_PIXELS);
    expect(EDITOR_KEPT_IMAGE_PIXELS).toBe(VIEWER_KEPT_IMAGE_PIXELS);
  });

  it("drawing a 20-page scan of 25 MP pages: what is retained never passes the budget", async () => {
    const pages = Array.from({ length: 20 }, () =>
      fakePage([{ width: 5_000, height: 5_000 }]),
    );
    const doc = await openWith(pages);
    const after: number[] = [];
    for (let i = 0; i < pages.length; i++) {
      expect(await doc.render(i, 1, 1)).not.toBeNull();
      after.push(retained(pages));
    }
    // Positive control: the meter is not blind — the first page is kept
    // (its 25 MP fit), so a zoom step redraws it from what was decoded.
    expect(after[0]).toBe(25_000_000);
    for (const [i, held] of after.entries()) {
      expect(held, `after page ${i + 1}`).toBeLessThanOrEqual(
        EDITOR_KEPT_IMAGE_PIXELS,
      );
    }
    // Second bound, independent of the budget's value: the page-count rule
    // alone (the last six pages) would have held 150 MP here.
    expect(Math.max(...after)).toBeLessThan(EDITOR_KEPT_PAGES * 25_000_000);
    await doc.destroy();
  });

  it("one page whose own images pass the budget is released as soon as it is drawn", async () => {
    const big = fakePage(
      Array.from({ length: 8 }, () => ({ width: 6_000, height: 6_000 })),
    );
    const doc = await openWith([big]);
    expect(await doc.render(0, 1, 1)).not.toBeNull();
    expect(big.cleaned).toBe(1);
    expect(retained([big])).toBe(0);
    await doc.destroy();
  });

  it(`small pages: zoom steps keep the page, and at most ${EDITOR_KEPT_PAGES} pages are kept`, async () => {
    const pages = Array.from({ length: 12 }, () =>
      fakePage([{ width: 100, height: 100 }]),
    );
    const doc = await openWith(pages);
    for (const scale of [1, 1.25, 1.5, 2]) await doc.render(0, scale, 1);
    expect(pages[0]!.cleaned).toBe(0);
    for (let i = 1; i < pages.length; i++) await doc.render(i, 1, 1);
    expect(pages.filter((p) => p.held() > 0).length).toBe(EDITOR_KEPT_PAGES);
    expect(pages[0]!.cleaned).toBe(1);
    expect(pages[pages.length - 1]!.cleaned).toBe(0);
    await doc.destroy();
  });

  it("the seam is restored: the next open loads the real pdf.js", async () => {
    const { loadPdfjs } = await import("../pdfjs");
    expect(editorPdfjs.load).toBe(loadPdfjs);
  });
});

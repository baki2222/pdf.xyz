// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { RASTER_MAX_IMAGE_PIXELS } from "./pdfjs-guard";
import {
  VIEWER_KEPT_IMAGE_PIXELS,
  VIEWER_KEPT_PAGES,
  decodedImagePixels,
  openViewerPdf,
  viewerPdfjs,
} from "./viewer";
import { viewerProofPdf } from "@/tests/viewer-fixtures";

/**
 * What the viewer RETAINS of what pdf.js decoded, as the reader scrolls.
 *
 * History (review, 2026-11-10): the viewer kept the last ten pages it drew
 * without `page.cleanup()`, "as the editor keeps" — and nothing capped the
 * image pixels on those pages (the raster budget is per image). A 20-page
 * scan of one 25 MP image a page grew the tab from 459 MB to a 1.2-1.4 GB
 * plateau while its canvases never passed 4.9 MP: every "bounded" test had
 * measured CANVAS pixels, a different set from what is retained.
 *
 * So the property is asserted here on what each page still holds, read
 * from a model of pdf.js's per-page object store (a page holds its decoded
 * images from its draw until its `cleanup()`), counted by THIS file — not
 * by `decodedImagePixels`, the viewer's own reading, which is checked
 * against the model separately. The real pdf.js store and the process's
 * own memory are measured in a child process by
 * src/tests/hostile/pdfjs-guard-bounds.test.ts ("viewer-retention").
 */

interface FakeImage {
  width: number;
  height: number;
}

/** A pdf.js page's shape as the viewer uses it, holding `images` once drawn. */
function fakePage(images: readonly FakeImage[]) {
  const objs = new Map<string, FakeImage>();
  const page = {
    rotate: 0,
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
      return { promise: Promise.resolve(), cancel: () => {} };
    },
    cleanup: () => {
      page.cleaned += 1;
      objs.clear();
      return true;
    },
    /** What this page holds now, counted by the model, not by the viewer. */
    held: () => [...objs.values()].reduce((s, i) => s + i.width * i.height, 0),
  };
  return page;
}

type FakePage = ReturnType<typeof fakePage>;

async function openWith(pages: FakePage[]) {
  const real = viewerPdfjs.loadPdfjs;
  viewerPdfjs.loadPdfjs = (async () => ({
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
    return await openViewerPdf(viewerProofPdf());
  } finally {
    viewerPdfjs.loadPdfjs = real;
  }
}

const retained = (pages: FakePage[]) =>
  pages.reduce((sum, p) => sum + p.held(), 0);

afterEach(() => vi.unstubAllGlobals());

describe("the viewer bounds what it retains, not only what it shows", () => {
  it("the pixel budget is one raster image's budget", () => {
    expect(VIEWER_KEPT_IMAGE_PIXELS).toBe(RASTER_MAX_IMAGE_PIXELS);
  });

  it("the viewer reads a page's holdings as the model counts them, and an unreadable store as never keepable", () => {
    const page = fakePage([
      { width: 5_000, height: 5_000 },
      { width: 10, height: 20 },
    ]);
    // Health: nothing decoded before a draw.
    expect(decodedImagePixels(page)).toBe(0);
    page.render();
    expect(decodedImagePixels(page)).toBe(page.held());
    expect(page.held()).toBe(25_000_200);
    // A store that is not iterable is unknown: Infinity, so it is released.
    expect(decodedImagePixels({ objs: 42 })).toBe(Number.POSITIVE_INFINITY);
    expect(decodedImagePixels({})).toBe(Number.POSITIVE_INFINITY);
  });

  it("scrolling a 20-page scan of 25 MP pages: what is retained never passes the budget", async () => {
    const pages = Array.from({ length: 20 }, () =>
      fakePage([{ width: 5_000, height: 5_000 }]),
    );
    const doc = await openWith(pages);
    const after: number[] = [];
    for (let i = 0; i < pages.length; i++) {
      expect((await doc.render(i, 1, 1, 0)).kind).toBe("drawn");
      after.push(retained(pages));
    }
    // Positive control: the meter is not blind — the first page is kept
    // (its 25 MP fit), so a zoom step redraws it from what was decoded.
    expect(after[0]).toBe(25_000_000);
    // The property: at every step of the scroll.
    for (const [i, held] of after.entries()) {
      expect(held, `after page ${i + 1}`).toBeLessThanOrEqual(
        VIEWER_KEPT_IMAGE_PIXELS,
      );
    }
    // Second bound, independent of the budget's value: the old rule (the
    // last ten pages) would have held 250 MP here.
    expect(Math.max(...after)).toBeLessThan(10 * 25_000_000);
    await doc.destroy();
  });

  it("one page whose own images pass the budget is released as soon as it is drawn", async () => {
    const big = fakePage(
      Array.from({ length: 8 }, () => ({ width: 6_000, height: 6_000 })),
    );
    const doc = await openWith([big]);
    expect((await doc.render(0, 1, 1, 0)).kind).toBe("drawn");
    expect(big.cleaned).toBe(1);
    expect(retained([big])).toBe(0);
    await doc.destroy();
  });

  it(`small pages: zoom steps keep the page, and at most ${VIEWER_KEPT_PAGES} pages are kept`, async () => {
    const pages = Array.from({ length: 12 }, () =>
      fakePage([{ width: 100, height: 100 }]),
    );
    const doc = await openWith(pages);
    // One page drawn again and again (zoom steps): nothing is released.
    for (const scale of [1, 1.25, 1.5, 2]) await doc.render(0, scale, 1, 0);
    expect(pages[0]!.cleaned).toBe(0);
    for (let i = 1; i < pages.length; i++) await doc.render(i, 1, 1, 0);
    const kept = pages.filter((p) => p.held() > 0).length;
    expect(kept).toBe(VIEWER_KEPT_PAGES);
    // The oldest went first.
    expect(pages[0]!.cleaned).toBe(1);
    expect(pages[pages.length - 1]!.cleaned).toBe(0);
    await doc.destroy();
  });

  it("the seam is restored: the next open loads the real pdf.js", async () => {
    const { loadPdfjs } = await import("./pdfjs");
    expect(viewerPdfjs.loadPdfjs).toBe(loadPdfjs);
  });
});

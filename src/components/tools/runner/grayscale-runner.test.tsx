// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PDFDocument, PDFName, PDFRawStream, rgb } from "pdf-lib";
import { getRunnerKind } from "@/lib/pdf/registry";
import { grayscaleTitle } from "@/lib/pdf/grayscale";
import { ToolRunner } from "./tool-runner";
import { runnerMounted } from "@/tests/runner-mounted";

/**
 * The Grayscale PDF tool, driven the way a visitor drives it, with the Title
 * read off the bytes the Download button hands the browser.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * Every output was titled "Grayscale PDF" — the same string in every browser
 * tab and window title, whatever was uploaded. The fix reads the source's
 * title and the uploaded file's name and marks the result as the grayscale
 * copy. That value crosses FIVE hops, and the first test written for it
 * checked none of them: it called `grayscaleTitle()` and the builder's
 * `save()` with a title the test supplied itself. Changing the one line in
 * `grayscalePdf` that joins them to `grayscaleTitle(null, undefined)` put
 * "Grayscale PDF" back on every output with the whole pdf suite green.
 *
 * So this runs the chain the visitor's file actually travels:
 *
 *   dropzone File → runner (`sourceName: pdf.file.name`)
 *     → `grayscalePdf` → `capturePdfPages` → pdf.js `getMetadata()`
 *     → `documentTitle` → `onDocument` → `grayscaleTitle` → `save()`
 *     → the Blob the Download button hands `URL.createObjectURL`
 *
 * and reads the Title back out of that Blob with an independent parser.
 *
 * ── WHAT IS REAL AND WHAT IS STUBBED ────────────────────────────────────────
 *
 * Real: the component tree, pdf.js (the same `pdfjs-dist` entry the browser
 * loads, parsing and rendering every page), the capture loop, the luminance
 * plane, the DeviceGray builder and the saved bytes.
 *
 * Stubbed, on globals and restored after each test (no `vi.mock`: the suite
 * shares one module cache, and a module evaluated under a mock stays bound to
 * the stub for every later file):
 *  - `document.createElement("canvas")` returns an `@napi-rs/canvas` canvas —
 *    pdf.js's own Node canvas — because jsdom's canvas has no 2D context;
 *  - `globalThis.pdfjsWorker` is pdf.js's worker module, which pdf.js runs on
 *    the main thread when it is present (there are no Web Workers here);
 *  - pdf.js's legacy build is imported once first, for the Node polyfills
 *    (DOMMatrix, Path2D, newer typed-array methods) the browser build assumes.
 */

const SLUG = "grayscale-pdf";
/**
 * What every output was titled before the fix. A literal of history, not a
 * call: `grayscaleTitle` did not exist then, and computing this at module load
 * would make the pre-fix code fail here on a missing import instead of on the
 * title — red, but for the wrong reason.
 */
const PRE_FIX_TITLE = "Grayscale PDF";

const router = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};

function Router({ children }: { children: ReactNode }) {
  return (
    <AppRouterContext.Provider value={router as never}>
      {children}
    </AppRouterContext.Provider>
  );
}

const requireHere = createRequire(import.meta.url);
const napi = createRequire(requireHere.resolve("pdfjs-dist/package.json"))(
  "@napi-rs/canvas",
) as { createCanvas(width: number, height: number): HTMLCanvasElement };

let downloads: Blob[] = [];
let canvasesMade = 0;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(async () => {
  downloads = [];
  canvasesMade = 0;
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    if (obj instanceof Blob) downloads.push(obj);
    return `blob:grayscale-runner-test/${downloads.length}`;
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker: unknown = await import(
    // @ts-expect-error -- pdfjs-dist ships no type declarations for its worker.
    "pdfjs-dist/legacy/build/pdf.worker.mjs"
  );
  vi.stubGlobal("pdfjsWorker", worker);
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((
    tag: string,
    options?: ElementCreationOptions,
  ) => {
    if (tag.toLowerCase() !== "canvas") return createElement(tag, options);
    canvasesMade++;
    return napi.createCanvas(1, 1);
  }) as typeof document.createElement);
});

afterEach(() => {
  cleanup();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * A two-page colour PDF. `title` goes in the Info dictionary; `xmpTitle` in an
 * XMP packet only (pdf.js reads that as `dc:title` when there is no /Title).
 */
async function makeSource({
  title,
  xmpTitle,
}: { title?: string; xmpTitle?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 2; i++) {
    const page = doc.addPage([144, 108]);
    page.drawRectangle({
      x: 12,
      y: 12,
      width: 60,
      height: 60,
      color: rgb(1, 0, 0),
    });
  }
  if (title !== undefined) doc.setTitle(title);
  if (xmpTitle !== undefined) {
    const xmp = [
      '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
      '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">',
      `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmpTitle}</rdf:li></rdf:Alt></dc:title>`,
      "</rdf:Description>",
      "</rdf:RDF>",
      "</x:xmpmeta>",
      '<?xpacket end="w"?>',
    ].join("\n");
    const stream = doc.context.stream(xmp, {
      Type: "Metadata",
      Subtype: "XML",
    });
    doc.catalog.set(PDFName.of("Metadata"), doc.context.register(stream));
  }
  return doc.save({ updateFieldAppearances: false });
}

/** The Title a PDF reader shows, read with pdf-lib (not the code under test). */
async function titleOf(pdf: Uint8Array): Promise<string | undefined> {
  return (await PDFDocument.load(pdf)).getTitle();
}

/**
 * And the output is the rasterized DeviceGray document, not an echo of the
 * input. Called AFTER each test's title assertions, so this file fails on the
 * title for a defect in the title.
 */
async function expectDeviceGrayPages(out: Uint8Array): Promise<void> {
  const doc = await PDFDocument.load(out);
  const spaces = doc.context
    .enumerateIndirectObjects()
    .map(([, obj]) => obj)
    .filter(
      (obj): obj is PDFRawStream =>
        obj instanceof PDFRawStream &&
        obj.dict.get(PDFName.of("Subtype"))?.toString() === "/Image",
    )
    .map((obj) => obj.dict.get(PDFName.of("ColorSpace"))?.toString());
  expect(spaces).toEqual(["/DeviceGray", "/DeviceGray"]);
}

/** Upload `bytes` as `fileName`, convert at the default preset, download. */
async function convertThroughTheUi(
  bytes: Uint8Array,
  fileName: string,
): Promise<Uint8Array> {
  const kind = getRunnerKind(SLUG);
  expect(kind, `the registry no longer maps ${SLUG} to a runner`).toBe(
    "grayscale",
  );
  const { container } = render(
    <Router>
      <ToolRunner kind={kind!} slug={SLUG} />
    </Router>,
  );
  await runnerMounted(container);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input, "the dropzone file input").not.toBeNull();
  const file = new File([bytes.slice()], fileName, {
    type: "application/pdf",
  });
  fireEvent.change(input!, { target: { files: [file] } });

  const run = await screen.findByRole("button", {
    name: /convert to grayscale/i,
  });
  await waitFor(() => expect(run).toBeEnabled());
  fireEvent.click(run);

  const download = await screen.findByRole(
    "button",
    { name: /download grayscale pdf/i },
    { timeout: 20_000 },
  );
  fireEvent.click(download);
  expect(
    downloads,
    "the Download button handed the browser no Blob",
  ).toHaveLength(1);
  const out = new Uint8Array(await downloads[0]!.arrayBuffer());

  // Health check: the chain really ran — every page went through a canvas —
  // so a right title here was not produced by skipping the work.
  expect(canvasesMade, "no page was rendered to a canvas").toBeGreaterThan(0);
  expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  return out;
}

describe("grayscale-pdf: the Title of the file the visitor downloads", () => {
  it("carries the source's own /Title, marked as the grayscale copy", async () => {
    const sourceTitle = "Quarterly Report — Draft 3";
    const source = await makeSource({ title: sourceTitle });
    // Health check on the fixture: an independent reader sees its title.
    expect(await titleOf(source)).toBe(sourceTitle);

    const out = await convertThroughTheUi(source, "q3-final.pdf");
    const title = await titleOf(out);
    expect(title).toContain(sourceTitle);
    expect(title).not.toBe(sourceTitle);
    expect(title).not.toBe(PRE_FIX_TITLE);
    expect(title).toBe(grayscaleTitle(sourceTitle, "q3-final.pdf"));
    await expectDeviceGrayPages(out);
  }, 30_000);

  it("carries an XMP-only dc:title the same way", async () => {
    const xmpTitle = "Site Survey Photos";
    const source = await makeSource({ xmpTitle });
    expect(await titleOf(source)).toBeUndefined();

    const out = await convertThroughTheUi(source, "survey.pdf");
    const title = await titleOf(out);
    expect(title).toContain(xmpTitle);
    expect(title).toBe(grayscaleTitle(xmpTitle, "survey.pdf"));
    await expectDeviceGrayPages(out);
  }, 30_000);

  it("falls back to the UPLOADED file's name when the source has no title", async () => {
    const source = await makeSource();
    expect(await titleOf(source)).toBeUndefined();

    const out = await convertThroughTheUi(source, "Invoice 2026-09.pdf");
    const title = await titleOf(out);
    // The stem of the name the visitor uploaded — which only the runner knows.
    expect(title).toContain("Invoice 2026-09");
    expect(title).not.toBe(PRE_FIX_TITLE);
    expect(title).toBe(grayscaleTitle(null, "Invoice 2026-09.pdf"));
    await expectDeviceGrayPages(out);
  }, 30_000);

  it("POSITIVE CONTROL: the pre-fix title fails every assertion above", () => {
    // "Grayscale PDF" is what every output carried before, and what the
    // pipeline yields when both inputs are dropped on the way. It must be
    // distinguishable from each expected value, or the three tests above
    // would pass on the defect.
    expect(grayscaleTitle(null, undefined)).toBe(PRE_FIX_TITLE);
    for (const [ownTitle, name, needle] of [
      ["Quarterly Report — Draft 3", "q3-final.pdf", "Quarterly Report"],
      ["Site Survey Photos", "survey.pdf", "Site Survey Photos"],
      [null, "Invoice 2026-09.pdf", "Invoice 2026-09"],
    ] as const) {
      expect(grayscaleTitle(ownTitle, name)).not.toBe(PRE_FIX_TITLE);
      // Each test's `toContain` needle is absent from the pre-fix title.
      expect(PRE_FIX_TITLE).not.toContain(needle);
    }
  });
});

// @vitest-environment jsdom
// @native-canvas
import { crc32, deflateSync } from "node:zlib";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import JSZip from "jszip";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PDFDocument } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import {
  DEFAULT_JPEG_QUALITY,
  JPEG_QUALITY_LABEL,
  RASTER_JPEG_QUALITIES,
  RASTER_RESOLUTIONS,
  pageImageName,
  zipOutputName,
} from "@/lib/pdf/pdf-to-image";
import { capturePdfPages, rasterizePdf } from "@/lib/pdf/render";
import { RASTER_MAX_DEVICE_PX } from "@/lib/pdf/render-utils";
import { PdfToImageRunner } from "./pdf-to-image-runner";

/**
 * PDF → PNG at "Print · 300 DPI", from the file a person drops to the file the
 * browser saves — through the REAL `rasterizePdf`.
 *
 * THE GAP THIS CLOSES. The DPI cap is decided in `rasterPageScale` and handed
 * across three statements in `rasterizePdf`: the viewport scale, the canvas
 * size taken from that viewport, and the `dpi`/`dpiCapped` copied onto the
 * page record. Every earlier test proved the helper, then built RasterPages BY
 * HAND "the way rasterizePdf builds them" — a comment standing in for the
 * seam. Review mutated the seam and all 568 tests stayed green:
 *
 *   M3  `dpiCapped: fit.dpiCapped` → `false`: the cap is silent again (the
 *       original defect).
 *   M5  `getViewport({ scale: fit.scale })` → `scale: dpi / 72`: the panel
 *       says "rendered at 213 DPI" over a 7015-px PNG at 300 DPI, past the cap.
 *
 * So these tests read what the reader receives: the note on screen, and the
 * pixel size of the PNG the Download button saves, each checked against the
 * other and against the source page's size in inches — a bound the engine
 * did not compute. The Print chip's own promise — the largest page it keeps
 * at full DPI — is read off the rendered chip on the way.
 *
 * WHAT IS STUBBED, and why it cannot hide either mutation:
 *  - pdfjs is its legacy build (the browser build constructs a DOMMatrix at
 *    module load, which jsdom lacks — see compare-pdf-runner.test.tsx). Same
 *    parser; it reads the real page size from the real bytes.
 *  - `PDFPageProxy.render` resolves without painting: jsdom has no 2D context.
 *    The canvas it would paint is still created and sized by `rasterizePdf`.
 *  - `HTMLCanvasElement.toBlob` encodes a real, valid PNG (blank, 1-bit) at
 *    the canvas's own width × height. The pixel CONTENT is not under test;
 *    the pixel COUNT is, and it is exactly what `rasterizePdf` sized.
 */

const PRINT = RASTER_RESOLUTIONS.find((r) => r.id === "print")!;

/** Paper sizes in PDF points (1/72 in). */
const PAPER = {
  Letter: [612, 792],
  A2: [1190.55, 1683.78],
  "ARCH D": [1728, 2592],
} as const;
type Paper = keyof typeof PAPER;

/* ------------------------------------------------------------------ *
 *  A tiny PNG writer and reader for the stubbed encoder.
 * ------------------------------------------------------------------ */

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

/** A white, 1-bit grayscale PNG of exactly `width` × `height` pixels. */
function blankPng(width: number, height: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 0; // grayscale
  const stride = Math.ceil(width / 8) + 1;
  const raw = Buffer.alloc(stride * height, 0xff);
  for (let y = 0; y < height; y++) raw[y * stride] = 0; // filter: none
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", new Uint8Array()),
    ]),
  );
}

/** The pixel size a PNG declares, read from the downloaded bytes. */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  sig.forEach((b, i) => expect(bytes[i], "not a PNG").toBe(b));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(String.fromCharCode(...bytes.subarray(12, 16))).toBe("IHDR");
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

// Positive control for the pair: what the writer writes, the reader reads.
it("the stub encoder's PNG declares the size it was given", () => {
  expect(pngSize(blankPng(37, 5))).toEqual({ width: 37, height: 5 });
});

/* ------------------------------------------------------------------ *
 *  Environment: legacy pdfjs, a render that does not paint, an encoder
 *  that writes the canvas's size, and a captured download.
 * ------------------------------------------------------------------ */

vi.mock("pdfjs-dist", async () => import("pdfjs-dist/legacy/build/pdf.mjs"));

type Legacy = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let legacy: Legacy;
let savedWorkerSrc: string;
let pageProto: { render: (...args: unknown[]) => unknown };
let docProto: { getPage: (pageNumber: number) => Promise<unknown> };

beforeAll(async () => {
  legacy = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // `rasterizePdf` points workerSrc at the bundled browser worker; in Node
  // pdfjs runs its worker in-thread from `globalThis.pdfjsWorker` instead.
  // Both are restored below — the legacy module is shared with other files.
  savedWorkerSrc = legacy.GlobalWorkerOptions.workerSrc;
  (globalThis as Record<string, unknown>).pdfjsWorker =
    // @ts-expect-error -- pdfjs-dist ships no .d.ts for its worker entry.
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const doc = await PDFDocument.create();
  doc.addPage([10, 10]);
  const task = legacy.getDocument({ data: await doc.save() });
  const loaded = await task.promise;
  docProto = Object.getPrototypeOf(loaded);
  const page = await loaded.getPage(1);
  pageProto = Object.getPrototypeOf(page);
  await task.destroy();
});

afterAll(() => {
  legacy.GlobalWorkerOptions.workerSrc = savedWorkerSrc;
  delete (globalThis as Record<string, unknown>).pdfjsWorker;
});

interface Download {
  name: string;
  blob: Blob | undefined;
}
let downloads: Download[];
/** Every canvas `rasterizePdf` encoded, in order. */
let encoded: { width: number; height: number }[];

beforeEach(() => {
  downloads = [];
  encoded = [];
  const blobs = new Map<string, Blob>();
  let n = 0;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:chain-${++n}`;
    blobs.set(url, blob);
    return url;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({
      name: this.download,
      blob: blobs.get(this.getAttribute("href") ?? ""),
    });
  });
  vi.spyOn(pageProto, "render").mockImplementation(() => ({
    promise: Promise.resolve(),
    cancel: () => {},
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
  ) {
    expect(type).toBe("image/png");
    encoded.push({ width: this.width, height: this.height });
    const png = blankPng(this.width, this.height);
    callback(new Blob([png.buffer as ArrayBuffer], { type: "image/png" }));
  });
});

afterEach(() => {
  cleanup();
  resetAnnouncer();
  vi.restoreAllMocks();
});

function readBlob(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * What the Print chip promises BEFORE anything renders: the longest page it
 * keeps at its full DPI. It used to round (5000 / 300 = 16.67 → "16.7 in"),
 * which named a 16.68 in page as safe when the cap lowers it. The number must
 * fit under the cap, and be the largest tenth of an inch that does.
 */
function expectChipNamesTheLargestFullDpiPage(chip: HTMLElement) {
  const title = chip.getAttribute("title") ?? "";
  const m = /up to (\d+(?:\.\d)?) in on a side/.exec(title);
  expect(m, `the chip does not name a page size: "${title}"`).not.toBeNull();
  const inches = Number(m![1]);
  expect(inches * PRINT.dpi).toBeLessThanOrEqual(RASTER_MAX_DEVICE_PX);
  expect((inches + 0.1) * PRINT.dpi).toBeGreaterThan(RASTER_MAX_DEVICE_PX);
  expect(title).toContain(`${PRINT.dpi} DPI`);
}

/**
 * Drop a PDF of these paper sizes on the real runner, choose Print, render,
 * press Download, and return what was saved — every PNG, in page order,
 * read from the downloaded file (unzipped when there are several) — and the
 * text of the cap note, if one is on screen.
 */
async function convertAtPrint(name: string, sizes: Paper[]) {
  const doc = await PDFDocument.create();
  for (const size of sizes) doc.addPage([...PAPER[size]]);
  const file = new File([new Uint8Array(await doc.save())], name, {
    type: "application/pdf",
  });

  // The runner's hand-off hook asks for the App Router; this page has none
  // to claim, so a router that is never navigated is all it needs.
  const router = {
    back: () => {},
    forward: () => {},
    refresh: () => {},
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    // Next 16.3's AppRouterInstance (the dependency bump merged beside this
    // test) added `bfcacheId`; a stub that omits it no longer type-checks.
    bfcacheId: "test",
  };
  const { container } = render(
    <AppRouterContext.Provider value={router}>
      <PdfToImageRunner format="png" />
    </AppRouterContext.Provider>,
  );
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input, "the runner has no file input").not.toBeNull();
  fireEvent.change(input!, { target: { files: [file] } });

  const renderButton = await screen.findByRole(
    "button",
    { name: new RegExp(`render ${sizes.length} page`, "i") },
    { timeout: 10_000 },
  );
  const chip = screen.getByRole("button", {
    name: new RegExp(`^${PRINT.label}\\s*${PRINT.dpi} DPI$`),
  });
  fireEvent.click(chip);
  expect(chip).toHaveAttribute("aria-pressed", "true");
  expectChipNamesTheLargestFullDpiPage(chip);
  fireEvent.click(renderButton);

  const download = await screen.findByRole(
    "button",
    { name: sizes.length > 1 ? /download zip/i : /download png/i },
    { timeout: 20_000 },
  );
  const note =
    screen.queryByText(new RegExp(`too large for ${PRINT.dpi} DPI`))
      ?.textContent ?? null;

  fireEvent.click(download);
  await waitFor(() => expect(downloads).toHaveLength(1));
  const saved = await readBlob(downloads[0]!.blob!);

  let pngs: Uint8Array[];
  if (sizes.length > 1) {
    expect(downloads[0]!.name).toBe(zipOutputName(name, "png"));
    const zip = await JSZip.loadAsync(saved);
    pngs = await Promise.all(
      sizes.map((_, i) =>
        zip
          .file(pageImageName(name, i, sizes.length, "png"))!
          .async("uint8array"),
      ),
    );
  } else {
    expect(downloads[0]!.name).toBe(pageImageName(name, 0, 1, "png"));
    pngs = [saved];
  }
  // Health: the chain ran through the stubbed encoder once per page, so the
  // sizes below are rasterizePdf's canvases and not some other bytes.
  expect(encoded).toHaveLength(sizes.length);
  return { note, sizes: pngs.map(pngSize) };
}

/** The paper's longest side, in inches — from the fixture, not the engine. */
const longestInches = (paper: Paper) => Math.max(...PAPER[paper]) / 72;

/** The DPI a delivered PNG really has, from its pixels and the paper's inches. */
function deliveredDpi(
  png: { width: number; height: number },
  paper: Paper,
): number {
  return Math.max(png.width, png.height) / longestInches(paper);
}

function noteDpi(note: string | null): number {
  const m = /rendered at (?:as low as )?(\d+) DPI/.exec(note ?? "");
  expect(m, `no DPI in the note: ${note}`).not.toBeNull();
  return Number(m![1]);
}

/**
 * A page too large for Print, as delivered: its longest side IS the cap (not
 * the 300-DPI size), and the note names exactly the DPI those pixels have.
 */
function expectCappedAndSaid(
  png: { width: number; height: number },
  paper: Paper,
  note: string | null,
) {
  // Health: this paper really is too large for Print, or nothing is tested.
  expect(Math.floor(longestInches(paper) * PRINT.dpi)).toBeGreaterThan(
    RASTER_MAX_DEVICE_PX,
  );
  expect(Math.max(png.width, png.height), `${paper}: longest side`).toBe(
    RASTER_MAX_DEVICE_PX,
  );
  // Orientation and aspect survive the cap: the short side is scaled too.
  const [w, h] = PAPER[paper];
  expect(png.width / png.height).toBeCloseTo(w / h, 3);
  expect(note, `${paper}: capped with no note`).not.toBeNull();
  expect(noteDpi(note), `${paper}: the note vs the pixels`).toBe(
    Math.floor(deliveredDpi(png, paper)),
  );
  expect(noteDpi(note)).toBeLessThan(PRINT.dpi);
}

describe("PDF to PNG at Print — the note and the downloaded pixels agree", () => {
  it("an A2 sheet: the PNG stops at 5,000 px, and the note says 213 DPI — what those pixels are", async () => {
    const { note, sizes } = await convertAtPrint("poster.pdf", ["A2"]);
    expect(sizes).toHaveLength(1);
    expectCappedAndSaid(sizes[0]!, "A2", note);
    expect(note).toMatch(/^This page is too large for 300 DPI/);
    // floor(5000 / 23.386 in) — the number review computed by hand.
    expect(noteDpi(note)).toBe(213);
  }, 30_000);

  it("control: a Letter page is 2550 x 3300 at 300 DPI, and nothing is said about a cap", async () => {
    const { note, sizes } = await convertAtPrint("letter.pdf", ["Letter"]);
    const [w, h] = PAPER.Letter;
    expect(sizes).toEqual([
      {
        width: Math.floor((w / 72) * PRINT.dpi),
        height: Math.floor((h / 72) * PRINT.dpi),
      },
    ]);
    expect(sizes[0]).toEqual({ width: 2550, height: 3300 });
    expect(note).toBeNull();
  }, 30_000);

  it("a Letter page and an ARCH D sheet in one ZIP: only the sheet is capped, and the note says which DPI it got", async () => {
    const { note, sizes } = await convertAtPrint("set.pdf", [
      "Letter",
      "ARCH D",
    ]);
    const [letter, arch] = sizes;
    expect(letter).toEqual({ width: 2550, height: 3300 });
    expectCappedAndSaid(arch!, "ARCH D", note);
    expect(note).toMatch(/^1 of 2 pages are too large for 300 DPI/);
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 *  Page selection, through the same chain
 * ------------------------------------------------------------------ */

describe("PDF to PNG — Select pages renders exactly those pages", () => {
  /**
   * Four pages of four different widths, so every delivered PNG names the
   * page it came from by its pixel width alone — a file holding the wrong
   * page cannot pass on its name. Rendered at the default (High, 150 DPI).
   */
  const WIDTHS = [100, 200, 300, 400] as const;
  const HIGH = RASTER_RESOLUTIONS.find((r) => r.id === "high")!;
  const pxFor = (points: number) => Math.floor((points / 72) * HIGH.dpi);
  // The tests above choose Print, and the runner remembers it (option
  // memory); these run at the default.
  beforeEach(() => window.localStorage.clear());

  async function convertPages(range: string | null) {
    const doc = await PDFDocument.create();
    for (const w of WIDTHS) doc.addPage([w, 100]);
    const name = "set.pdf";
    const file = new File([new Uint8Array(await doc.save())], name, {
      type: "application/pdf",
    });
    const router = {
      back: () => {},
      forward: () => {},
      refresh: () => {},
      push: () => {},
      replace: () => {},
      prefetch: () => {},
      bfcacheId: "test",
    };
    const { container } = render(
      <AppRouterContext.Provider value={router}>
        <PdfToImageRunner format="png" />
      </AppRouterContext.Provider>,
    );
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input!, { target: { files: [file] } });
    await screen.findByRole(
      "button",
      { name: /render 4 pages/i },
      { timeout: 10_000 },
    );
    if (range !== null) {
      fireEvent.click(screen.getByRole("button", { name: "Select pages" }));
      fireEvent.change(screen.getByPlaceholderText("e.g. 1-3, 5"), {
        target: { value: range },
      });
    }
    return { name, container };
  }

  async function renderAndSave(label: RegExp, zip: boolean) {
    fireEvent.click(screen.getByRole("button", { name: label }));
    const download = await screen.findByRole(
      "button",
      { name: zip ? /download zip/i : /download png/i },
      { timeout: 20_000 },
    );
    fireEvent.click(download);
    await waitFor(() => expect(downloads).toHaveLength(1));
    return readBlob(downloads[0]!.blob!);
  }

  it('"2, 4" of 4: a ZIP of page 2 and page 4, each its own page\'s pixels', async () => {
    const { name } = await convertPages("2, 4");
    const saved = await renderAndSave(/render 2 pages/i, true);
    expect(downloads[0]!.name).toBe(zipOutputName(name, "png"));
    const zip = await JSZip.loadAsync(saved);
    expect(Object.keys(zip.files).sort()).toEqual([
      pageImageName(name, 1, 4, "png"),
      pageImageName(name, 3, 4, "png"),
    ]);
    for (const index of [1, 3]) {
      const png = await zip
        .file(pageImageName(name, index, 4, "png"))!
        .async("uint8array");
      expect(pngSize(png).width, `page ${index + 1}`).toBe(
        pxFor(WIDTHS[index]!),
      );
    }
    // Health: exactly two canvases were encoded — the others never rendered.
    expect(encoded.map((e) => e.width)).toEqual([pxFor(200), pxFor(400)]);
  }, 30_000);

  it('"3" of 4: one PNG, still named as page 3 of the document', async () => {
    const { name } = await convertPages("3");
    const saved = await renderAndSave(/render 1 page/i, false);
    expect(downloads[0]!.name).toBe("set-page-3.png");
    expect(downloads[0]!.name).toBe(pageImageName(name, 2, 4, "png"));
    expect(pngSize(saved).width).toBe(pxFor(300));
  }, 30_000);

  it("a range the PDF cannot satisfy says why and renders nothing", async () => {
    await convertPages("2, 9");
    expect(
      await screen.findByText(/This PDF has 4 pages — "9" is out of range\./),
    ).toBeTruthy();
    const run = screen.getByRole("button", { name: /render 0 pages/i });
    fireEvent.click(run);
    expect(encoded).toEqual([]);
  }, 30_000);

  it("control: All pages renders all four", async () => {
    await convertPages(null);
    const saved = await renderAndSave(/render 4 pages/i, true);
    const zip = await JSZip.loadAsync(saved);
    expect(Object.keys(zip.files)).toHaveLength(4);
    expect(encoded.map((e) => e.width)).toEqual(WIDTHS.map(pxFor));
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 *  A page that fails, and a run the reader stops (audit #37)
 * ------------------------------------------------------------------ */

/**
 * HISTORY (audit #37, 2026-11-06): `capturePdfPages` turned any one page's
 * failure into `throw new Error("Page N could not be rendered.")` and dropped
 * the pages it had already rendered, so a 300-page run lost everything to one
 * bad page near the end; and there was no Cancel — the AbortController was
 * only aborted on unmount, and an abort was reported as an error.
 *
 * Through the REAL `rasterizePdf`, with only pdf.js's paint stubbed: page 3's
 * render rejects (or, for Cancel, never settles until it is cancelled).
 */
describe("PDF to PNG — one page failing, or Cancel, keeps the finished pages", () => {
  const WIDTHS = [100, 200, 300, 400] as const;
  const HIGH = RASTER_RESOLUTIONS.find((r) => r.id === "high")!;
  const pxFor = (points: number) => Math.floor((points / 72) * HIGH.dpi);
  beforeEach(() => window.localStorage.clear());

  /** Make page `n`'s render behave as `render(n)` says; the rest succeed. */
  function renderPages(
    behave: (n: number) => { promise: Promise<void>; cancel: () => void },
  ) {
    vi.spyOn(pageProto, "render").mockImplementation(function (this: {
      pageNumber: number;
    }) {
      return behave(this.pageNumber);
    });
  }

  async function loadFourPages() {
    const doc = await PDFDocument.create();
    for (const w of WIDTHS) doc.addPage([w, 100]);
    const name = "set.pdf";
    const file = new File([new Uint8Array(await doc.save())], name, {
      type: "application/pdf",
    });
    const router = {
      back: () => {},
      forward: () => {},
      refresh: () => {},
      push: () => {},
      replace: () => {},
      prefetch: () => {},
      bfcacheId: "test",
    };
    const { container } = render(
      <AppRouterContext.Provider value={router}>
        <PdfToImageRunner format="png" />
      </AppRouterContext.Provider>,
    );
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input!, { target: { files: [file] } });
    await screen.findByRole(
      "button",
      { name: /render 4 pages/i },
      { timeout: 10_000 },
    );
    return name;
  }

  async function savedZip(name: string) {
    const download = await screen.findByRole(
      "button",
      { name: /download zip/i },
      { timeout: 20_000 },
    );
    fireEvent.click(download);
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]!.name).toBe(zipOutputName(name, "png"));
    return JSZip.loadAsync(await readBlob(downloads[0]!.blob!));
  }

  const ok = () => ({ promise: Promise.resolve(), cancel: () => {} });

  it("page 3 fails to render: pages 1, 2 and 4 are delivered, and page 3 is named", async () => {
    renderPages((n) =>
      n === 3
        ? { promise: Promise.reject(new Error("bad stream")), cancel: () => {} }
        : ok(),
    );
    const name = await loadFourPages();
    fireEvent.click(screen.getByRole("button", { name: /render 4 pages/i }));
    const zip = await savedZip(name);
    expect(Object.keys(zip.files).sort()).toEqual(
      [0, 1, 3].map((i) => pageImageName(name, i, 4, "png")).sort(),
    );
    for (const index of [0, 1, 3]) {
      const png = await zip
        .file(pageImageName(name, index, 4, "png"))!
        .async("uint8array");
      expect(pngSize(png).width, `page ${index + 1}`).toBe(
        pxFor(WIDTHS[index]!),
      );
    }
    expect(screen.getByText(/3 PNG images ready/)).toBeTruthy();
    expect(
      screen.getByText(/Page 3 could not be rendered, so it was left out/),
    ).toBeTruthy();
  }, 30_000);

  it("control: when every page fails, it is still an error, and nothing downloads", async () => {
    renderPages(() => ({
      promise: Promise.reject(new Error("bad stream")),
      cancel: () => {},
    }));
    await loadFourPages();
    fireEvent.click(screen.getByRole("button", { name: /render 4 pages/i }));
    expect(
      await screen.findByText(
        /No pages could be rendered from this PDF/,
        {},
        {
          timeout: 20_000,
        },
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /download/i })).toBeNull();
  }, 30_000);

  it("Cancel stops a run and keeps the pages already finished", async () => {
    let started = false;
    renderPages((n) => {
      if (n !== 3) return ok();
      started = true;
      let cancel = () => {};
      const promise = new Promise<void>((_, reject) => {
        cancel = () =>
          reject(
            new legacy.RenderingCancelledException("Rendering cancelled."),
          );
      });
      return { promise, cancel };
    });
    const name = await loadFourPages();
    fireEvent.click(screen.getByRole("button", { name: /render 4 pages/i }));
    await waitFor(() => expect(started).toBe(true), { timeout: 20_000 });
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    const zip = await savedZip(name);
    expect(Object.keys(zip.files).sort()).toEqual(
      [0, 1].map((i) => pageImageName(name, i, 4, "png")).sort(),
    );
    expect(screen.getByText(/2 PNG images ready/)).toBeTruthy();
    expect(
      screen.getByText(/Rendering was stopped after 2 of 4 pages/),
    ).toBeTruthy();
    // Health: page 4 never rendered — Cancel stopped the run, not a failure.
    expect(encoded.map((e) => e.width)).toEqual([pxFor(100), pxFor(200)]);
  }, 30_000);
});

/**
 * The other half of audit #37's contract: WITHOUT `onPageFailed`, a failed
 * page still rejects the call. Redact (`rasterizePdf`) and Grayscale
 * (`capturePdfPages`) build one PDF that must hold every page, so a page that
 * is dropped there is a page missing from the output with nothing said.
 *
 * Review found nothing tested this: deleting the rejecting branch (and calling
 * `onPageFailed?.(...)`) left every test green, and the "every page fails"
 * control above cannot tell — the runner errors on zero pages either way. So
 * these go through the two exported entry points directly, with ONE page
 * failing and the rest fine, and each has a positive control in which the
 * same stub with `onPageFailed` resolves with the other pages.
 */
describe("a failed page without onPageFailed still rejects (Redact, Grayscale)", () => {
  async function fourPages(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    for (const w of [100, 200, 300, 400]) doc.addPage([w, 100]);
    return doc.save();
  }

  function failPageRender(n: number) {
    vi.spyOn(pageProto, "render").mockImplementation(function (this: {
      pageNumber: number;
    }) {
      return this.pageNumber === n
        ? { promise: Promise.reject(new Error("bad stream")), cancel: () => {} }
        : { promise: Promise.resolve(), cancel: () => {} };
    });
  }

  function failGetPage(n: number) {
    const real = docProto.getPage;
    vi.spyOn(docProto, "getPage").mockImplementation(function (
      this: unknown,
      pageNumber: number,
    ) {
      return pageNumber === n
        ? Promise.reject(new Error("broken page object"))
        : real.call(this, pageNumber);
    });
  }

  const captureWidth = (canvas: HTMLCanvasElement) => canvas.width;

  it("rasterizePdf (Redact's path) rejects when page 3 fails to render", async () => {
    failPageRender(3);
    await expect(
      rasterizePdf(await fourPages(), { format: "png", dpi: 72 }),
    ).rejects.toThrow("Page 3 could not be rendered.");
  }, 30_000);

  it("capturePdfPages (Grayscale's path) rejects when page 3 fails to render", async () => {
    failPageRender(3);
    await expect(
      capturePdfPages(await fourPages(), { dpi: 72, capture: captureWidth }),
    ).rejects.toThrow("Page 3 could not be rendered.");
  }, 30_000);

  it("capturePdfPages rejects when page 3's page object cannot be read", async () => {
    failGetPage(3);
    await expect(
      capturePdfPages(await fourPages(), { dpi: 72, capture: captureWidth }),
    ).rejects.toThrow("Page 3 could not be rendered.");
  }, 30_000);

  it("positive control: the same render stub WITH onPageFailed resolves with pages 1, 2 and 4, reporting index 2", async () => {
    failPageRender(3);
    const failed: { index: number; message: string }[] = [];
    const pages = await rasterizePdf(await fourPages(), {
      format: "png",
      dpi: 72,
      onPageFailed: (f) => failed.push(f),
    });
    expect(pages.map((p) => p.index)).toEqual([0, 1, 3]);
    expect(failed).toEqual([
      { index: 2, message: "Page 3 could not be rendered." },
    ]);
  }, 30_000);

  it("positive control: a broken page object WITH onPageFailed is skipped and named, and pages 1, 2 and 4 are captured", async () => {
    failGetPage(3);
    const failed: { index: number; message: string }[] = [];
    const pages = await capturePdfPages(await fourPages(), {
      dpi: 72,
      capture: captureWidth,
      onPageFailed: (f) => failed.push(f),
    });
    expect(pages.map((p) => [p.index, p.data])).toEqual([
      [0, 100],
      [1, 200],
      [3, 400],
    ]);
    expect(failed).toEqual([
      { index: 2, message: "Page 3 could not be rendered." },
    ]);
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 *  JPEG quality (audit pdf-to-jpg#3, 2026-11-07)
 * ------------------------------------------------------------------ */

/**
 * Every JPEG was encoded at DEFAULT_JPEG_QUALITY and the page said "There is
 * no quality slider". Now PDF to JPG offers RASTER_JPEG_QUALITIES; read here
 * at the encoder (the quality `toBlob` is called with) after a real run, and
 * PDF to PNG offers no such choice.
 */
describe("PDF to JPG — the Quality choice reaches the encoder", () => {
  beforeEach(() => window.localStorage.clear());

  async function mount(format: "jpg" | "png") {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const file = new File([new Uint8Array(await doc.save())], "q.pdf", {
      type: "application/pdf",
    });
    const router = {
      back: () => {},
      forward: () => {},
      refresh: () => {},
      push: () => {},
      replace: () => {},
      prefetch: () => {},
      bfcacheId: "test",
    };
    const { container } = render(
      <AppRouterContext.Provider value={router}>
        <PdfToImageRunner format={format} />
      </AppRouterContext.Provider>,
    );
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });
    await screen.findByRole(
      "button",
      { name: /render 1 page/i },
      { timeout: 10_000 },
    );
  }

  /** Render with the chip for `id` pressed (or none), return toBlob's quality. */
  async function qualityFor(id: string | null): Promise<unknown> {
    const seen: unknown[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (
        this: HTMLCanvasElement,
        callback: BlobCallback,
        type?: string,
        quality?: unknown,
      ) {
        expect(type).toBe("image/jpeg");
        seen.push(quality);
        callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])]));
      },
    );
    await mount("jpg");
    const group = screen.getByRole("group", { name: JPEG_QUALITY_LABEL });
    if (id !== null) {
      const preset = RASTER_JPEG_QUALITIES.find((q) => q.id === id)!;
      const chip = within(group).getByRole("button", {
        name: new RegExp(`^${preset.label}`),
      });
      fireEvent.click(chip);
      expect(chip).toHaveAttribute("aria-pressed", "true");
    }
    fireEvent.click(screen.getByRole("button", { name: /render 1 page/i }));
    await screen.findByRole(
      "button",
      { name: /download jpg/i },
      { timeout: 20_000 },
    );
    expect(seen).toHaveLength(1);
    return seen[0];
  }

  it("each preset encodes at its own quality", async () => {
    // Health: the presets are distinct, so one value cannot pass for another.
    const values = RASTER_JPEG_QUALITIES.map((q) => q.quality);
    expect(new Set(values).size).toBe(values.length);
    for (const preset of RASTER_JPEG_QUALITIES) {
      expect(await qualityFor(preset.id)).toBe(preset.quality);
      // Not restoreAllMocks: that would drop beforeEach's non-painting
      // render; the toBlob spy is re-pointed by the next qualityFor.
      cleanup();
    }
  }, 30_000);

  it("the default is the quality the page has always used", async () => {
    expect(await qualityFor(null)).toBe(DEFAULT_JPEG_QUALITY);
  });

  it("control: PDF to PNG has no Quality choice", async () => {
    await mount("png");
    expect(
      screen.queryByRole("group", { name: JPEG_QUALITY_LABEL }),
    ).toBeNull();
  });
});

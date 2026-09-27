// @vitest-environment jsdom
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
} from "@testing-library/react";
import JSZip from "jszip";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PDFDocument } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import {
  RASTER_RESOLUTIONS,
  pageImageName,
  zipOutputName,
} from "@/lib/pdf/pdf-to-image";
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
  const page = await (await task.promise).getPage(1);
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

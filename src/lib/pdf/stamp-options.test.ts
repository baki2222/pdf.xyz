// @native-canvas
/**
 * The watermark and page-number OPTIONS, read back from the saved file.
 *
 * Every assertion re-opens the output — pdfjs for what a reader's text layer
 * sees, pdf-lib plus a small content-stream interpreter for where an image is
 * painted and which ink and face a run uses — because an option the runner
 * passes and the engine ignores produces a perfectly valid PDF. Each property
 * has a positive control: the same run with the option left at its default
 * must FAIL the assertion, so a check that cannot see the option is caught
 * here rather than certified.
 */
import { deflateSync, inflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PageSizes,
  degrees,
  rgb,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PdfEngineError } from "./engine";
import { addPageNumbers, numberingPlan } from "./page-numbers";
import { STAMP_POSITIONS, resolveAlign, type StampPosition } from "./stamp";
import {
  WATERMARK_INSET,
  watermarkPdf,
  type WatermarkOptions,
} from "./watermark";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";

/* ------------------------------------------------------------------ *
 *  Fixtures and readers
 * ------------------------------------------------------------------ */

async function blankPdf(
  pages: number,
  size: [number, number] = [600, 800],
  rotate = 0,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    doc.addPage(size).setRotation(degrees(rotate));
  }
  return doc.save();
}

/** A PDF whose single page is painted with a full-page opaque rectangle. */
async function paintedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 600,
    height: 800,
    color: rgb(1, 1, 1),
  });
  return doc.save();
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A solid-colour truecolour PNG. */
function png(width: number, height: number): Uint8Array {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      raw[y * stride + 1 + x * 3] = 200;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

function streamText(stream: PDFRawStream): string {
  const raw = stream.contents;
  try {
    return inflateSync(Buffer.from(raw)).toString("latin1");
  } catch {
    return Buffer.from(raw).toString("latin1");
  }
}

/** Each content stream of each page, decoded, in `/Contents` order. */
async function contentStreams(bytes: Uint8Array): Promise<string[][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = doc.context.lookup(page.node.get(PDFName.of("Contents")));
    const refs =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref))
        : [contents];
    return refs
      .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
      .map(streamText);
  });
}

type Matrix = [number, number, number, number, number, number];

function multiply(m: Matrix, n: Matrix): Matrix {
  // m applied first, then n (PDF row-vector convention: m × n).
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

/** Where each image XObject is painted: the centre of its unit square. */
function imageCentres(content: string): { x: number; y: number }[] {
  const tokens = content.split(/\s+/).filter(Boolean);
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const op = tokens[i]!;
    if (op === "q") stack.push(ctm);
    else if (op === "Q") ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (op === "cm") {
      const m = tokens.slice(i - 6, i).map(Number) as Matrix;
      ctm = multiply(m, ctm);
    } else if (op === "Do" && tokens[i - 1]?.startsWith("/Image")) {
      out.push({
        x: 0.5 * ctm[0] + 0.5 * ctm[2] + ctm[4],
        y: 0.5 * ctm[1] + 0.5 * ctm[3] + ctm[5],
      });
    }
  }
  return out;
}

interface Run {
  str: string;
  /** Centre of the run's baseline, user space. */
  mid: [number, number];
  start: [number, number];
  end: [number, number];
}

async function textRuns(bytes: Uint8Array): Promise<Run[][]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    disableFontFace: true,
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  try {
    const doc = await task.promise;
    const pages: Run[][] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const runs: Run[] = [];
      for (const item of content.items) {
        if (!("str" in item) || item.str.trim() === "") continue;
        const [a, b, , , e, f] = item.transform as Matrix;
        const size = Math.hypot(a, b);
        const end: [number, number] = [
          e + (item.width * a) / size,
          f + (item.width * b) / size,
        ];
        runs.push({
          str: item.str,
          start: [e, f],
          end,
          mid: [(e + end[0]) / 2, (f + end[1]) / 2],
        });
      }
      pages.push(runs);
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/** Fonts a page's resources name, by BaseFont. */
async function baseFonts(bytes: Uint8Array): Promise<string[][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const resources = page.node.Resources();
    const fonts = resources?.lookupMaybe(PDFName.of("Font"), PDFDict);
    if (!fonts) return [];
    return fonts
      .keys()
      .map((key) => fonts.lookup(key, PDFDict))
      .map((font) => String(font.get(PDFName.of("BaseFont"))));
  });
}

/** Which third of a side a coordinate falls in. */
function third(value: number, length: number): "low" | "mid" | "high" {
  if (value < length / 3) return "low";
  if (value > (2 * length) / 3) return "high";
  return "mid";
}

/** The third each alignment must land in, in the reader's frame. */
const H_THIRD = { left: "low", center: "mid", right: "high" } as const;
const V_THIRD = { bottom: "low", middle: "mid", top: "high" } as const;

/* ------------------------------------------------------------------ *
 *  Watermark
 * ------------------------------------------------------------------ */

describe("watermark options, read back from the output", () => {
  it("an image watermark is an image XObject drawn on every page", async () => {
    const report = await watermarkPdf(await blankPdf(2), "", {
      image: { bytes: png(40, 20) },
    });
    const doc = await PDFDocument.load(report.bytes);
    for (const page of doc.getPages()) {
      const xobjects = page.node
        .Resources()
        ?.lookupMaybe(PDFName.of("XObject"), PDFDict);
      const subtypes = (xobjects?.keys() ?? []).map((key) =>
        String(
          (xobjects!.lookup(key) as PDFRawStream).dict.get(
            PDFName.of("Subtype"),
          ),
        ),
      );
      expect(subtypes).toContain("/Image");
    }
    expect(report.placements).toBe(2);
    // And no text was drawn: an image mark is not the text mark plus a picture.
    const runs = await textRuns(report.bytes);
    expect(runs.flat()).toEqual([]);
  });

  it("an image watermark lands in the grid cell asked for — all nine", async () => {
    const source = await blankPdf(1);
    for (const position of STAMP_POSITIONS) {
      const report = await watermarkPdf(source, "", {
        image: { bytes: png(40, 20), scale: 20 },
        position,
        rotation: 0,
      });
      const centres = (await contentStreams(report.bytes))[0]!.flatMap(
        imageCentres,
      );
      expect(centres, position).toHaveLength(1);
      const { h, v } = resolveAlign(position);
      expect(third(centres[0]!.x, 600), position).toBe(H_THIRD[h]);
      expect(third(centres[0]!.y, 800), position).toBe(V_THIRD[v]);
    }
  });

  it("the grid cell is in the READER's frame on a /Rotate 90 page", async () => {
    // Stored 600×800 portrait, shown 800×600 landscape. Viewer (vx, vy) maps
    // to content (600 - vy, vx); so the viewer's top-left (small vx, large vy)
    // is content (small x, small y).
    const report = await watermarkPdf(await blankPdf(1, [600, 800], 90), "", {
      image: { bytes: png(40, 20), scale: 20 },
      position: "top-left",
      rotation: 0,
    });
    const centres = (await contentStreams(report.bytes))[0]!.flatMap(
      imageCentres,
    );
    expect(centres).toHaveLength(1);
    const viewer = { x: centres[0]!.y, y: 600 - centres[0]!.x };
    expect(third(viewer.x, 800)).toBe("low");
    expect(third(viewer.y, 600)).toBe("high");
  });

  it("a text mark at a corner keeps the inset and stays whole on the page", async () => {
    const pages = await textRuns(
      (
        await watermarkPdf(await blankPdf(1), "DRAFT", {
          position: "top-right",
          rotation: 0,
          fontSize: 40,
        })
      ).bytes,
    );
    const run = pages[0]![0];
    expect(run!.str).toBe("DRAFT");
    expect(run!.end[0]).toBeLessThanOrEqual(600 - 600 * WATERMARK_INSET + 0.5);
    expect(third(run!.mid[0], 600)).toBe("high");
    expect(third(run!.mid[1], 800)).toBe("high");
  });

  it("tile repeats the text, every copy wholly on the page", async () => {
    const tiled = await watermarkPdf(await blankPdf(1), "CONFIDENTIAL", {
      position: "tile",
      fontSize: 24,
    });
    const [runs] = await textRuns(tiled.bytes);
    const copies = runs!.filter((r) => r.str === "CONFIDENTIAL");
    expect(copies.length).toBeGreaterThan(1);
    expect(tiled.placements).toBe(copies.length);
    for (const run of copies) {
      for (const [x, y] of [run.start, run.end]) {
        expect(x).toBeGreaterThanOrEqual(-0.5);
        expect(x).toBeLessThanOrEqual(600.5);
        expect(y).toBeGreaterThanOrEqual(-0.5);
        expect(y).toBeLessThanOrEqual(800.5);
      }
    }
    // Positive control: the same run without tile draws exactly one copy.
    const single = await watermarkPdf(await blankPdf(1), "CONFIDENTIAL", {
      fontSize: 24,
    });
    const [one] = await textRuns(single.bytes);
    expect(one!.filter((r) => r.str === "CONFIDENTIAL")).toHaveLength(1);
  });

  it("tile at the runner's defaults (60pt, 45°) repeats on A4 and Letter", async () => {
    // At the single-mark fit one 60pt CONFIDENTIAL filled A4, so ticking
    // Tile changed nothing; TILE_FIT holds each copy to half the page.
    for (const size of [PageSizes.A4, PageSizes.Letter]) {
      const report = await watermarkPdf(
        await blankPdf(1, size as [number, number]),
        "CONFIDENTIAL",
        { position: "tile" },
      );
      expect(report.placements).toBeGreaterThan(1);
      const [runs] = await textRuns(report.bytes);
      expect(runs!.filter((r) => r.str === "CONFIDENTIAL").length).toBe(
        report.placements,
      );
    }
  });

  it("tile repeats an image too, on a rotated and on a cropped page", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]).setRotation(degrees(90));
    doc.addPage([600, 800]).setCropBox(100, 100, 400, 500);
    const report = await watermarkPdf(await doc.save(), "", {
      image: { bytes: png(30, 30), scale: 15 },
      position: "tile",
    });
    const streams = await contentStreams(report.bytes);
    const perPage = streams.map((page) => page.flatMap(imageCentres));
    expect(perPage[0]!.length).toBeGreaterThan(1);
    expect(perPage[1]!.length).toBeGreaterThan(1);
    for (const c of perPage[1]!) {
      // Every centre inside the crop (100..500, 100..600).
      expect(c.x).toBeGreaterThan(100);
      expect(c.x).toBeLessThan(500);
      expect(c.y).toBeGreaterThan(100);
      expect(c.y).toBeLessThan(600);
    }
  });

  it("a page list stamps only the pages it names", async () => {
    const report = await watermarkPdf(await blankPdf(5), "SAMPLE", {
      pages: "2, 4-5",
    });
    const runs = await textRuns(report.bytes);
    expect(runs.map((page) => page.some((r) => r.str === "SAMPLE"))).toEqual([
      false,
      true,
      false,
      true,
      true,
    ]);
    expect(report.pages).toBe(3);
    expect(report.totalPages).toBe(5);
    // Positive control: no list means every page.
    const all = await textRuns(
      (await watermarkPdf(await blankPdf(5), "SAMPLE")).bytes,
    );
    expect(all.every((page) => page.some((r) => r.str === "SAMPLE"))).toBe(
      true,
    );
  });

  it("a bad page list is refused in the parser's words, before any work", async () => {
    await expect(
      watermarkPdf(await blankPdf(3), "X", { pages: "2-9" }),
    ).rejects.toThrow(PdfEngineError);
    await expect(
      watermarkPdf(await blankPdf(3), "X", { pages: "2-9" }),
    ).rejects.toThrow(/3 pages/);
  });

  it("the colour and the font family asked for are the ones drawn", async () => {
    const options: WatermarkOptions = {
      color: { r: 0.2, g: 0.6, b: 0.4 },
      font: "times",
    };
    const out = await watermarkPdf(await blankPdf(1), "DRAFT", options);
    const [streams] = await contentStreams(out.bytes);
    expect(streams!.join("\n")).toMatch(/\b0\.2 0\.6 0\.4 rg\b/);
    expect((await baseFonts(out.bytes))[0]).toEqual(["/Times-Bold"]);

    const courier = await watermarkPdf(await blankPdf(1), "DRAFT", {
      font: "courier",
    });
    expect((await baseFonts(courier.bytes))[0]).toEqual(["/Courier-Bold"]);

    // Positive control: the defaults are Helvetica Bold in the gray ink.
    const plain = await watermarkPdf(await blankPdf(1), "DRAFT");
    expect((await baseFonts(plain.bytes))[0]).toEqual(["/Helvetica-Bold"]);
    const [plainStreams] = await contentStreams(plain.bytes);
    expect(plainStreams!.join("\n")).not.toMatch(/\b0\.2 0\.6 0\.4 rg\b/);
  });

  it("behind content puts the mark in the first content stream; over puts it last", async () => {
    const source = await paintedPdf();
    const behind = (
      await contentStreams(
        (await watermarkPdf(source, "UNDER", { layer: "behind" })).bytes,
      )
    )[0]!;
    const over = (
      await contentStreams((await watermarkPdf(source, "UNDER")).bytes)
    )[0]!;
    // pdf-lib writes the rectangle as a path: `0 0 m … h` then `f`.
    const paints = (s: string) => /\bm\b/.test(s) && /^f$/m.test(s);
    const marks = (s: string) => /\bTj\b/.test(s);
    // Behind: the mark is painted before the opaque rectangle.
    expect(behind.findIndex(marks)).toBeLessThan(behind.findIndex(paints));
    // Over (default): after it.
    expect(over.findIndex(marks)).toBeGreaterThan(over.findIndex(paints));
    // Same streams either way — only the order differs.
    expect([...behind].sort()).toEqual([...over].sort());
  });

  it("default options draw exactly what the explicit centre position draws", async () => {
    const source = await blankPdf(2, PageSizes.A4);
    const a = await contentStreams(
      (await watermarkPdf(source, "CONFIDENTIAL")).bytes,
    );
    const b = await contentStreams(
      (
        await watermarkPdf(source, "CONFIDENTIAL", {
          position: "middle-center",
          layer: "over",
          font: "helvetica",
          pages: "",
        })
      ).bytes,
    );
    expect(a).toEqual(b);
  });

  it("refuses an image that is neither PNG nor JPEG", async () => {
    await expect(
      watermarkPdf(await blankPdf(1), "", {
        image: { bytes: new TextEncoder().encode("GIF89a....") },
      }),
    ).rejects.toThrow(/PNG or JPEG/);
  });
});

/* ------------------------------------------------------------------ *
 *  Page numbers
 * ------------------------------------------------------------------ */

async function labels(bytes: Uint8Array): Promise<string[]> {
  return (await textRuns(bytes)).map((page) =>
    page.map((r) => r.str).join(" "),
  );
}

describe("page-number options, read back from the output", () => {
  it("skip cover: page 1 is counted but carries no number", async () => {
    const out = await addPageNumbers(await blankPdf(4), { skipCover: true });
    expect(await labels(out)).toEqual([
      "",
      "Page 2 of 4",
      "Page 3 of 4",
      "Page 4 of 4",
    ]);
    // Positive control: without it page 1 is numbered.
    expect((await labels(await addPageNumbers(await blankPdf(4))))[0]).toBe(
      "Page 1 of 4",
    );
  });

  it("skip last N: the tail is unnumbered and {total} is the last number printed", async () => {
    const out = await addPageNumbers(await blankPdf(5), { skipLast: 2 });
    expect(await labels(out)).toEqual([
      "Page 1 of 3",
      "Page 2 of 3",
      "Page 3 of 3",
      "",
      "",
    ]);
  });

  it("start page, skip cover and skip last compose", async () => {
    const plan = numberingPlan(10, {
      startPage: 3,
      startAt: 1,
      skipLast: 1,
    });
    expect(plan.total).toBe(7);
    expect(plan.stamps.map((s) => s.index)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    // The cover is page 1 of the file; with numbering from page 3 it is
    // already unnumbered, so skipCover changes nothing.
    expect(
      numberingPlan(10, { startPage: 3, skipLast: 1, skipCover: true }),
    ).toEqual(plan);
  });

  it("the default plan is the old arithmetic", () => {
    for (const [count, startPage, startAt] of [
      [1, 1, 1],
      [10, 3, 1],
      [7, 2, 5],
    ] as const) {
      const plan = numberingPlan(count, { startPage, startAt });
      expect(plan.total).toBe(startAt + (count - (startPage - 1)) - 1);
      expect(plan.stamps).toEqual(
        Array.from({ length: count - startPage + 1 }, (_, k) => ({
          index: startPage - 1 + k,
          n: startAt + k,
        })),
      );
    }
  });

  it("settings that leave nothing to number draw nothing", async () => {
    expect(numberingPlan(2, { skipLast: 2 }).stamps).toEqual([]);
    const out = await addPageNumbers(await blankPdf(2), { skipLast: 2 });
    expect(await labels(out)).toEqual(["", ""]);
  });

  it("facing pages mirror left and right on even pages", async () => {
    const position: StampPosition = "bottom-right";
    const out = await addPageNumbers(await blankPdf(4), {
      position,
      facing: true,
      format: "{n}",
    });
    const runs = await textRuns(out);
    const sides = runs.map((page) => third(page[0]!.mid[0], 600));
    expect(sides).toEqual(["high", "low", "high", "low"]);
    // Mirrored exactly: the left run's start sits at the margin, the right
    // run's end at width − margin.
    expect(runs[1]![0]!.start[0]).toBeCloseTo(36, 1);
    expect(runs[0]![0]!.end[0]).toBeCloseTo(600 - 36, 1);
    // Positive control: without facing, every page is on the right.
    const plain = await textRuns(
      await addPageNumbers(await blankPdf(4), { position, format: "{n}" }),
    );
    expect(plain.map((page) => third(page[0]!.mid[0], 600))).toEqual([
      "high",
      "high",
      "high",
      "high",
    ]);
  });

  it("facing pages mirror in the reader's frame on a rotated page", async () => {
    const out = await addPageNumbers(await blankPdf(2, [600, 800], 90), {
      position: "bottom-left",
      facing: true,
      format: "{n}",
    });
    const runs = await textRuns(out);
    // Viewer x = content y on a /Rotate 90 page.
    expect(third(runs[0]![0]!.mid[1], 800)).toBe("low");
    expect(third(runs[1]![0]!.mid[1], 800)).toBe("high");
  });

  it("font family, colour and margin are the ones drawn", async () => {
    const out = await addPageNumbers(await blankPdf(1), {
      font: "courier",
      color: { r: 0.8, g: 0.1, b: 0.3 },
      margin: 60,
      format: "{n}",
    });
    expect((await baseFonts(out))[0]).toEqual(["/Courier"]);
    const [streams] = await contentStreams(out);
    expect(streams!.join("\n")).toMatch(/\b0\.8 0\.1 0\.3 rg\b/);
    const run = (await textRuns(out))[0]![0];
    expect(run!.start[1]).toBeCloseTo(60, 1);

    const times = await addPageNumbers(await blankPdf(1), { font: "times" });
    expect((await baseFonts(times))[0]).toEqual(["/Times-Roman"]);
    // Positive control: defaults are Helvetica at the 36pt margin.
    const plain = await addPageNumbers(await blankPdf(1), { format: "{n}" });
    expect((await baseFonts(plain))[0]).toEqual(["/Helvetica"]);
    expect((await textRuns(plain))[0]![0]!.start[1]).toBeCloseTo(36, 1);
  });
});

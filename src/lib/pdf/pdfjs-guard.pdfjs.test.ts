// @vitest-environment node
// @native-canvas
/**
 * The hostile matrix's findings on pdf.js consumers that are about WORDS and
 * COUNTS (the resource ones run in child processes, in
 * src/tests/hostile/pdfjs-guard-bounds.test.ts). Each is driven through the
 * entry point a tool calls — extractPdfText (PDF to Text, Markdown, Compare),
 * pdfHasSelectableText (the AI preflights), readPagesWithPdfjs (the upload
 * board of the pdf.js tools), countPagesWithPdfjs (Compare's file cards) —
 * and the user-facing outcome is read the way the runner reads it
 * (errorMessage, failureCode).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  errorMessage,
  failureCode,
} from "@/components/tools/runner/runner-kit";
import { unknownHandlerObjectStreamPdf } from "@/tests/encrypted-pdf-fixture";
import {
  CONTROL,
  MARKER,
  countNegativePdf,
  kidsSelfPdf,
  rawPdf,
} from "@/tests/hostile/conversion-out.fixtures";
import {
  chainedFlateStream,
  formRepeatPdf,
  indirectSubtypePdf,
  inlineCyclesPdf,
  labelledContentPdf,
  unclosedQContent,
  nestedFormsPdf,
  qCycle,
  repeatedContentsPdf,
} from "@/tests/hostile/pdfjs-work.fixtures";
import { unsupportedEncryptionPdf } from "@/tests/unsupported-encryption";
import {
  PdfEncryptedError,
  PdfEngineError,
  UNREADABLE_PDF_MESSAGE,
  pdfjsLoadError,
} from "./engine-errors";
import { DictMatcher, dictEntries } from "./pdf-scan-bytes";
import { ContentsRefs, objectHeaderNumber } from "./pdf-scan-objects";
import { readPagesWithPdfjs } from "./pdfjs";
import {
  GRAPHICS_STATE_WORK_FLOOR,
  MAX_DECODED_STREAM_BYTES,
  MAX_GRAPHICS_STATE_DEPTH,
  MAX_GRAPHICS_STATE_WORK,
  RASTER_MAX_BILEVEL_PIXELS,
  RASTER_MAX_IMAGE_PIXELS,
  pdfjsPageCount,
  pdfjsPageError,
  preflightPdfjsBytes,
  scanPdfStreams,
} from "./pdfjs-guard";
import { countPagesWithPdfjs } from "./pdfjs-page-count";
import { MAX_DECODED_PIXELS } from "./pixel-ceiling";
import { extractPdfText, pdfHasSelectableText } from "./text";
import { MAX_TIFF_PAGE_BYTES } from "./tiff";

const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pick<
    typeof import("pdfjs-dist"),
    "getDocument"
  >;

const thrown = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

/**
 * A page tree that names object 3 in its inherited resources: pdf.js paints
 * an image only through a reference, so an image fixture at object 3 is one
 * pdf.js may paint (see `judgeImages`; an orphan is not counted).
 */
const PAGES_PAINT_3 =
  "<< /Type /Pages /Kids [] /Count 0 /Resources << /XObject << /Im 3 0 R >> >> >>";

const HELVETICA = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
/** One real page that draws MARKER, under a root /Pages whose /Count lies. */
const countPdf = (count: string) =>
  rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [3 0 R] /Count ${count} >>`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    { dict: "", stream: `BT /F1 14 Tf 20 100 Td (${MARKER}) Tj ET` },
    HELVETICA,
  ]);

/** The refusal a runner shows for an unreadable file, by its own readers. */
function expectUnreadable(err: unknown) {
  expect(err).toBeInstanceOf(PdfEngineError);
  expect(err).not.toBeInstanceOf(PdfEncryptedError);
  expect(errorMessage(err)).toBe(UNREADABLE_PDF_MESSAGE);
  expect(failureCode(err)).toBe("unreadable_input");
}

describe("CO-03 / PS-11: pdf.js's numPages is never trusted below 1", () => {
  it("fixture health: pdf.js really reports -1 and 0 for these files", async () => {
    const pdfjs = await legacy();
    for (const [count, want] of [
      ["-1", -1],
      ["0", 0],
      ["1", 1],
    ] as const) {
      const task = pdfjs.getDocument({ data: countPdf(count), verbosity: 0 });
      const doc = await task.promise;
      expect(doc.numPages, `/Count ${count}`).toBe(want);
      await task.destroy();
    }
  });

  it("CO-03: text extraction refuses /Count -1 and 0 typed, never '-1 pages, no text'", async () => {
    for (const bytes of [countNegativePdf(), countPdf("0")]) {
      expectUnreadable(await thrown(extractPdfText(bytes, legacy)));
    }
  });

  it("CO-03: pdfHasSelectableText refuses rather than answering 'no text'", async () => {
    expectUnreadable(await thrown(pdfHasSelectableText(countNegativePdf())));
    expectUnreadable(await thrown(pdfHasSelectableText(countPdf("0"))));
  });

  it("CO-03: the pdf.js tools' upload board refuses rather than reading -1 pages", async () => {
    expectUnreadable(await thrown(readPagesWithPdfjs(countNegativePdf())));
  });

  it("PS-11: Compare's card count refuses /Count -1 and 0", async () => {
    for (const bytes of [countPdf("-1"), countPdf("0")]) {
      expectUnreadable(await thrown(countPagesWithPdfjs(bytes)));
    }
  });

  it("positive controls: /Count 1 and /Count 2147483647 (which pdf.js caps) still read", async () => {
    expect(await countPagesWithPdfjs(countPdf("1"))).toBe(1);
    expect(await countPagesWithPdfjs(countPdf("2147483647"))).toBe(1);
    const read = await extractPdfText(countPdf("1"), legacy);
    expect(read.pageCount).toBe(1);
    expect(read.text).toContain(MARKER);
    expect(await pdfHasSelectableText(CONTROL())).toBe(true);
    expect((await readPagesWithPdfjs(CONTROL())).pageCount).toBe(1);
  });

  it("the predicate itself: integers >= 1 pass, everything else is refused", () => {
    expect(pdfjsPageCount(1)).toBe(1);
    expect(pdfjsPageCount(5000)).toBe(5000);
    for (const bad of [0, -1, 1.5, Number.NaN, undefined, "3"]) {
      expect(() => pdfjsPageCount(bad), String(bad)).toThrow(PdfEngineError);
    }
  });
});

describe("PS-13 / CO-12: an unknown security handler is refused as encrypted, like pdf-lib", () => {
  it("fixture health: raw pdf.js really says 'unknown encryption method'", async () => {
    const pdfjs = await legacy();
    const task = pdfjs.getDocument({
      data: await unsupportedEncryptionPdf(),
      verbosity: 0,
    });
    const err = await thrown(task.promise);
    expect(err).toMatchObject({
      name: "UnknownErrorException",
      message: "unknown encryption method",
    });
    await task.destroy();
  });

  it("PS-13: Compare's card count refuses both fixtures as PdfEncryptedError", async () => {
    for (const bytes of [
      await unsupportedEncryptionPdf(),
      unknownHandlerObjectStreamPdf(),
    ]) {
      const err = await thrown(countPagesWithPdfjs(bytes));
      expect(err).toBeInstanceOf(PdfEncryptedError);
      expect((err as PdfEncryptedError).verdict).toBeNull();
      expect(failureCode(err)).toBe("encrypted_input");
    }
  });

  it("CO-12: text extraction refuses both fixtures as PdfEncryptedError", async () => {
    for (const bytes of [
      await unsupportedEncryptionPdf(),
      unknownHandlerObjectStreamPdf(),
    ]) {
      const err = await thrown(extractPdfText(bytes, legacy));
      expect(err).toBeInstanceOf(PdfEncryptedError);
      expect(errorMessage(err)).not.toBe("unknown encryption method");
      expect(failureCode(err)).toBe("encrypted_input");
    }
  });

  it("an UnknownErrorException that is not about encryption still passes through the open's translation", () => {
    const other = Object.assign(new Error("Worker was terminated"), {
      name: "UnknownErrorException",
    });
    expect(pdfjsLoadError(other)).toBe(other);
  });
});

describe("CO-11: a page-walk failure gets the unreadable copy, not raw pdf.js text", () => {
  it("fixture health: raw pdf.js opens the file and fails at getPage", async () => {
    const pdfjs = await legacy();
    const task = pdfjs.getDocument({ data: kidsSelfPdf(), verbosity: 0 });
    const doc = await task.promise;
    const err = await thrown(doc.getPage(1));
    expect(err).toMatchObject({ name: "UnknownErrorException" });
    expect((err as Error).message).toMatch(/circular reference/);
    await task.destroy();
  });

  it("CO-11: extractPdfText, pdfHasSelectableText and the upload board all refuse it typed", async () => {
    expectUnreadable(await thrown(extractPdfText(kidsSelfPdf(), legacy)));
    expectUnreadable(await thrown(pdfHasSelectableText(kidsSelfPdf())));
    expectUnreadable(await thrown(readPagesWithPdfjs(kidsSelfPdf())));
  });

  it("the page-walk translation keeps its cause and leaves non-file failures alone", () => {
    const walk = Object.assign(
      new Error("Pages tree contains circular reference."),
      {
        name: "UnknownErrorException",
      },
    );
    const mapped = pdfjsPageError(walk) as PdfEngineError;
    expectUnreadable(mapped);
    expect(mapped.cause).toBe(walk);
    expectUnreadable(pdfjsPageError(new Error("Invalid page request.")));
    const cancelled = Object.assign(new Error("Rendering cancelled"), {
      name: "RenderingCancelledException",
    });
    expect(pdfjsPageError(cancelled)).toBe(cancelled);
    const typed = new PdfEngineError("already typed");
    expect(pdfjsPageError(typed)).toBe(typed);
  });
});

describe("the stream preflight: thresholds against real files and a second bound", () => {
  const DIR = path.join(process.cwd(), "src/tests/fixtures/legit-corpus");
  const files = readdirSync(DIR).filter((f) => f.endsWith(".pdf"));

  it("health: the corpus is not empty, and the scan sees streams, inflates and q in it", async () => {
    expect(files.length).toBeGreaterThanOrEqual(14);
    let streams = 0;
    let inflated = 0;
    let deepest = 0;
    for (const f of files) {
      const scan = await scanPdfStreams(
        new Uint8Array(readFileSync(path.join(DIR, f))),
      );
      expect(scan.exceeded, f).toBeNull();
      streams += scan.streams;
      inflated += scan.inflated;
      deepest = Math.max(deepest, scan.maxQDepth);
      // Measured headroom (2026-11-08): largest decoded stream 40,176 B,
      // deepest q 2, largest image 0.35 MP.
      expect(scan.maxStreamBytes, f).toBeLessThan(
        MAX_DECODED_STREAM_BYTES / 1000,
      );
      expect(scan.maxQDepth, f).toBeLessThan(MAX_GRAPHICS_STATE_DEPTH / 100);
      expect(scan.maxImagePixels, f).toBeLessThan(
        RASTER_MAX_IMAGE_PIXELS / 100,
      );
      // Second review: every real file sits under the work floor (so its
      // forms may be painted any number of times), and every image's size
      // is read.
      expect(scan.maxQReach, f).toBeLessThanOrEqual(GRAPHICS_STATE_WORK_FLOOR);
      expect(scan.qWork, f).toBe(0);
      expect(scan.unknownSizeImages, f).toBe(0);
    }
    expect(streams).toBeGreaterThan(100);
    expect(inflated).toBeGreaterThan(100);
    expect(deepest).toBeGreaterThan(0);
  });

  it("positive control for the q counter: a balanced deep page and an exact boundary", async () => {
    const page = (ops: string) =>
      rawPdf([
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R >>",
        { dict: "", stream: ops },
      ]);
    const at = await scanPdfStreams(
      page("q\n".repeat(MAX_GRAPHICS_STATE_DEPTH)),
    );
    expect(at).toMatchObject({
      maxQDepth: MAX_GRAPHICS_STATE_DEPTH,
      exceeded: null,
    });
    const over = await scanPdfStreams(
      page("q\n".repeat(MAX_GRAPHICS_STATE_DEPTH + 1)),
    );
    expect(over.exceeded).toBe("q-depth");
    // 100,000 balanced pairs never nest past 1, and a name is not an op. (A
    // `q` inside a string literal IS counted: the counter does not parse
    // strings, which can only err high, and a real page would need 16,384 of
    // them before it mattered.)
    const balanced = await scanPdfStreams(
      page("q Q\n".repeat(100_000) + "/q /Q0 q0 Tj"),
    );
    expect(balanced).toMatchObject({ maxQDepth: 1, exceeded: null });
  });

  it("STAMP-14, split: 100 content streams of 1,000 unclosed q on ONE page are refused; 2,000 pages leaking one q each are not", async () => {
    const streams = Array.from({ length: 100 }, () => ({
      dict: "",
      stream: "q\n".repeat(1_000),
    }));
    const split = rawPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents [${streams.map((_, i) => `${i + 4} 0 R`).join(" ")}] >>`,
      ...streams,
    ]);
    const s = await scanPdfStreams(split);
    expect(s.maxQDepth).toBeLessThanOrEqual(MAX_GRAPHICS_STATE_DEPTH);
    expect(s.exceeded).toBe("q-depth");
    const leaky = await scanPdfStreams(
      rawPdf(
        Array.from({ length: 2_000 }, () => ({
          dict: "",
          stream: "q BT ET\n",
        })),
      ),
    );
    expect(leaky).toMatchObject({
      streams: 2_000,
      unclosedQ: 2_000,
      exceeded: null,
    });
  });

  it("STAMP-14, the first fix's bounds were inverted: one stream 5,000 deep (1.5 s on base) now passes; 32 streams x 1,020 on one page (66 s) are refused", async () => {
    const onePage = (streams: string[]) =>
      rawPdf([
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents [${streams.map((_, i) => `${i + 4} 0 R`).join(" ")}] >>`,
        ...streams.map((stream) => ({ dict: "", stream })),
      ]);
    // History: a per-stream bound of 4,096 refused this file, and a file-wide
    // sum of 32,768 admitted the next one, which read for 66 s.
    const deep = await scanPdfStreams(onePage(["q\n".repeat(5_000)]));
    expect(deep).toMatchObject({ maxQReach: 5_000, exceeded: null });
    const split = await scanPdfStreams(
      onePage(Array.from({ length: 32 }, () => "q\n".repeat(1_020))),
    );
    // The scan stops at the first stream past the bound (the 17th: 17,340).
    expect(split.exceeded).toBe("q-depth");
    expect(split.maxQReach).toBeGreaterThan(MAX_GRAPHICS_STATE_DEPTH);
    // The reach is (what the others leave open) + (a stream's deepest): a
    // balanced stream 3,000 deep after 14,000 leaked q reaches 17,000.
    const stacked = await scanPdfStreams(
      onePage([
        "q\n".repeat(14_000),
        "q\n".repeat(3_000) + "Q\n".repeat(3_000),
      ]),
    );
    expect(stacked).toMatchObject({ maxQReach: 17_000, exceeded: "q-depth" });
  });

  it("CO-08: the raster budget is per decode cost, so a bilevel scan is not held to the colour bound", async () => {
    const image = (dict: string) =>
      scanPdfStreams(
        rawPdf([
          "<< /Type /Catalog /Pages 2 0 R >>",
          PAGES_PAINT_3,
          { dict: `/Type /XObject /Subtype /Image ${dict}`, stream: "x" },
        ]),
      );
    const A3_600 = "/Width 7016 /Height 9921"; // 69.6 MP
    const over = (s: { smallestOverBudgetImage: number | null }) =>
      s.smallestOverBudgetImage;
    // History: the first fix held every image to 50 MP and refused this scan,
    // which base renders in 0.4 s.
    expect(
      over(
        await image(
          `${A3_600} /BitsPerComponent 1 /ColorSpace /DeviceGray /Filter /FlateDecode`,
        ),
      ),
    ).toBeNull();
    expect(
      over(await image(`${A3_600} /ImageMask true /BitsPerComponent 1`)),
    ).toBeNull();
    // History: the first repair counted `/ColorSpace /CalGray` (a name, which
    // is not valid PDF: CalGray is an array) as bilevel, and this test pinned
    // it. pdf.js takes its 1-bit path only for the name DeviceGray, so the
    // property was untrue; inverted in the second repair.
    expect(
      over(
        await image(
          `${A3_600} /BitsPerComponent 1 /ColorSpace /CalGray /Filter /CCITTFaxDecode`,
        ),
      ),
    ).toBe(7016 * 9921);
    expect(
      over(await image(`${A3_600} /BPC 1 /CS /G /Filter /CCITTFaxDecode`)),
    ).toBeNull();
    // Expanded to RGB by pdf.js like any colour image: the colour budget.
    expect(
      over(
        await image(
          `${A3_600} /BitsPerComponent 1 /ColorSpace [/Indexed /DeviceRGB 1 <000000FFFFFF>]`,
        ),
      ),
    ).toBe(7016 * 9921);
    expect(
      over(
        await image(
          `${A3_600} /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /FlateDecode`,
        ),
      ),
    ).toBe(7016 * 9921);
    expect(
      over(
        await image(
          `${A3_600} /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode`,
        ),
      ),
    ).toBe(7016 * 9921);
    // Each budget's own boundary.
    const h = RASTER_MAX_IMAGE_PIXELS / 5_000;
    expect(
      over(
        await image(
          `/Width 5000 /Height ${h} /BitsPerComponent 8 /ColorSpace /DeviceRGB`,
        ),
      ),
    ).toBeNull();
    expect(
      over(
        await image(
          `/Width 5000 /Height ${h + 1} /BitsPerComponent 8 /ColorSpace /DeviceRGB`,
        ),
      ),
    ).toBe(5_000 * (h + 1));
    expect(
      over(
        await image(
          `/Width 20000 /Height 20000 /BitsPerComponent 1 /ColorSpace /DeviceGray`,
        ),
      ),
    ).toBeNull();
    expect(
      over(
        await image(
          `/Width 20000 /Height 20001 /BitsPerComponent 1 /ColorSpace /DeviceGray`,
        ),
      ),
    ).toBe(20000 * 20001);
  });

  it("second bound: the per-stream ceiling is the product's TIFF page ceiling, and the raster pixel ceiling sits between a 600-dpi A4 scan and MAX_DECODED_PIXELS", () => {
    expect(MAX_DECODED_STREAM_BYTES).toBe(MAX_TIFF_PAGE_BYTES);
    // From paper and dots alone: A4 = 8.27 x 11.69 in.
    const a4At600 = Math.round(8.27 * 600) * Math.round(11.69 * 600);
    expect(a4At600).toBeGreaterThan(30_000_000);
    expect(RASTER_MAX_IMAGE_PIXELS).toBeGreaterThan(a4At600);
    expect(RASTER_MAX_IMAGE_PIXELS).toBeLessThan(MAX_DECODED_PIXELS);
    // A0 = 33.11 x 46.81 in; a 400-dpi A0 bilevel scan rendered in 1.2-2.8 s.
    const a0At400 = Math.round(33.11 * 400) * Math.round(46.81 * 400);
    expect(RASTER_MAX_BILEVEL_PIXELS).toBeGreaterThan(a0At400);
    expect(RASTER_MAX_BILEVEL_PIXELS).toBeGreaterThan(RASTER_MAX_IMAGE_PIXELS);
    // ISO 32000-1 Annex C: Acrobat nests q at most 28 deep.
    expect(MAX_GRAPHICS_STATE_DEPTH).toBeGreaterThan(28 * 100);
    // Measured on base: 24,576 deep read in 5.7-5.9 s and 32,640 in 66 s, so
    // the bound stays below the last depth measured as cheap.
    expect(MAX_GRAPHICS_STATE_DEPTH).toBeLessThan(24_576);
  });
});

describe("second review: q work and multiplicity, top-level image entries, a linear scan", () => {
  const triangle = (d: number) => (d * (d + 1)) / 2;

  it("STAMP-14 work: one form 16,000 deep painted 30 times is refused by its work; painted once it passes", async () => {
    // History: the first repair held DEPTH only. This page never passes
    // 16,000, so it passed, and read for 157 s (30 climbs of ~3-5 s each).
    const many = await scanPdfStreams(formRepeatPdf(30, 16_000));
    expect(many).toMatchObject({ maxQReach: 16_000, exceeded: "q-work" });
    const once = await scanPdfStreams(formRepeatPdf(1, 16_000));
    expect(once).toMatchObject({ maxQReach: 16_000, exceeded: null });
    // Counted twice (as possible page content, and once per Do): the budget
    // is set so that a form at the depth bound, painted once, still reads.
    const atBound = await scanPdfStreams(
      formRepeatPdf(1, MAX_GRAPHICS_STATE_DEPTH),
    );
    expect(atBound).toMatchObject({
      qWork: 2 * triangle(MAX_GRAPHICS_STATE_DEPTH),
      exceeded: null,
    });
    expect(2 * triangle(MAX_GRAPHICS_STATE_DEPTH)).toBe(
      MAX_GRAPHICS_STATE_WORK,
    );
  });

  it("STAMP-14 work: the same climb repeated inline is held to the same budget, at its exact boundary", async () => {
    // 15 inline climbs read for 52 s on the first repair.
    expect((await scanPdfStreams(inlineCyclesPdf(15, 16_000))).exceeded).toBe(
      "q-work",
    );
    const two = await scanPdfStreams(
      inlineCyclesPdf(2, MAX_GRAPHICS_STATE_DEPTH),
    );
    expect(two).toMatchObject({
      qWork: MAX_GRAPHICS_STATE_WORK,
      exceeded: null,
    });
    const twoAndOne = await scanPdfStreams(
      rawPdf([
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [] /Count 0 >>",
        {
          dict: "",
          stream: qCycle(MAX_GRAPHICS_STATE_DEPTH).repeat(2) + "q Q\n",
        },
      ]),
    );
    // One more q at depth 1 is one unit over.
    expect(twoAndOne).toMatchObject({
      qWork: MAX_GRAPHICS_STATE_WORK + 1,
      exceeded: "q-work",
    });
  });

  it("STAMP-14 depth: forms painting each other stack their depths; one stream listed 24 times stacks its leak", async () => {
    // Measured on base: 3 nested forms of 12,000 read in 11.9 s; the first
    // repair saw a reach of 12,000.
    expect(await scanPdfStreams(nestedFormsPdf(3, 12_000))).toMatchObject({
      maxQReach: 36_000,
      exceeded: "q-depth",
    });
    expect(await scanPdfStreams(nestedFormsPdf(1, 12_000))).toMatchObject({
      maxQReach: 12_000,
      exceeded: null,
    });
    // 24 x 1,000 read in 4.6 s on base, and 32 listings pass the cliff.
    expect(await scanPdfStreams(repeatedContentsPdf(24, 1_000))).toMatchObject({
      unclosedQ: 24_000,
      exceeded: "q-depth",
    });
    expect(await scanPdfStreams(repeatedContentsPdf(1, 1_000))).toMatchObject({
      unclosedQ: 1_000,
      exceeded: null,
    });
  });

  it("references inside a decoded object stream count: a /Contents array kept in an ObjStm is seen", async () => {
    const page = `<< /Type /Page /Parent 2 0 R /Contents [${"5 0 R ".repeat(20)}] >>`;
    const objStm = deflateSync(Buffer.from(`3 0 ${page}`, "latin1"));
    const file = (filter: string, data: Uint8Array | string) =>
      rawPdf([
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        null,
        { dict: `/Type /ObjStm /N 1 /First 4 ${filter}`, stream: data },
        { dict: "", stream: "q\n".repeat(1_000) },
      ]);
    expect(
      await scanPdfStreams(file("/Filter /FlateDecode", objStm)),
    ).toMatchObject({ unclosedQ: 20_000, exceeded: "q-depth" });
    // An object stream the scan cannot decode could name the stream any
    // number of times: past the floor, the work has no bound.
    const opaque = rawPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [] /Count 0 >>",
      { dict: "/Type /ObjStm /N 1 /First 4 /Filter /LZWDecode", stream: "x" },
      { dict: "", stream: qCycle(300) },
    ]);
    expect(await scanPdfStreams(opaque)).toMatchObject({
      maxQReach: 300,
      qWork: Infinity,
      exceeded: "q-work",
    });
  });

  it("positive control for the floor: a shallow file with nested, repeated forms has no q work to judge", async () => {
    const s = await scanPdfStreams(nestedFormsPdf(4, 20));
    expect(s.maxQReach).toBe(80);
    expect(s.maxQReach).toBeLessThanOrEqual(GRAPHICS_STATE_WORK_FLOOR);
    expect(s).toMatchObject({ qWork: 0, exceeded: null });
    // Past the floor the same shape is judged.
    const deep = await scanPdfStreams(nestedFormsPdf(4, 100));
    expect(deep.maxQReach).toBe(400);
    expect(deep.qWork).toBeGreaterThan(0);
  });

  it("CO-08: image entries are read from the top level, with abbreviations, name escapes and references", async () => {
    const image = (dict: string, extra: string[] = []) =>
      scanPdfStreams(
        rawPdf([
          "<< /Type /Catalog /Pages 2 0 R >>",
          PAGES_PAINT_3,
          { dict: `/Type /XObject /Subtype /Image ${dict}`, stream: "x" },
          ...extra,
        ]),
      );
    // History: the first repair read the first `/BitsPerComponent` anywhere
    // in the text, so this 8-bit image counted as bilevel (400 MP budget).
    expect(
      (
        await image(
          "/DecodeParms << /BitsPerComponent 1 >> /Width 12000 /Height 12000 /BitsPerComponent 8 /ColorSpace /DeviceGray",
        )
      ).smallestOverBudgetImage,
    ).toBe(144_000_000);
    // History: `/Width 4 0 R` read as no width, 0 pixels.
    expect(
      await image("/Width 4 0 R /Height 10000 /BitsPerComponent 8", ["10000"]),
    ).toMatchObject({ smallestOverBudgetImage: 100_000_000 });
    // pdf.js reads /W before /Width; a real number is a number.
    expect(
      (await image("/Width 10 /Height 10 /W 10000 /H 10000.0"))
        .smallestOverBudgetImage,
    ).toBe(100_000_000);
    expect(
      (await image("/Wid#74h 10000 /Height 10000")).smallestOverBudgetImage,
    ).toBe(100_000_000);
    // A reference the scan cannot resolve: size unknown, held to the colour
    // budget by the preflight.
    const unresolved = rawPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      PAGES_PAINT_3,
      {
        dict: "/Type /XObject /Subtype /Image /Width 99 0 R /Height 10",
        stream: "x",
      },
    ]);
    expect(await scanPdfStreams(unresolved)).toMatchObject({
      unknownSizeImages: 1,
      smallestOverBudgetImage: null,
    });
    expect(await preflightPdfjsBytes(unresolved)).toEqual({
      previewOptions: { maxImageSize: RASTER_MAX_IMAGE_PIXELS },
      overBudgetImage: true,
    });
    // Positive controls: a direct small image and a resolved small one pass.
    expect(
      await image("/Width 4 0 R /Height 100 /BitsPerComponent 8", ["100"]),
    ).toMatchObject({ smallestOverBudgetImage: null, unknownSizeImages: 0 });
  });

  it("dictEntries: nested values never supply top-level keys", () => {
    const e = dictEntries(
      "<< /DecodeParms << /BitsPerComponent 1 /Columns (a >> b) >> /A [/B << /C 1 >>] /BitsPerComponent 8 /W 3 0 R /IM true >>",
    );
    expect(e.get("BitsPerComponent")).toEqual([{ kind: "number", value: 8 }]);
    expect(e.has("Columns")).toBe(false);
    expect(e.has("C")).toBe(false);
    expect(e.get("W")).toEqual([{ kind: "ref", num: 3 }]);
    expect(e.get("IM")).toEqual([{ kind: "word", word: "true" }]);
  });

  it("the dictionary matcher returns exactly what the first fix's 64 KB backward walk returned", () => {
    // The first fix's walk, kept here as the reference.
    const walkBack = (bytes: Uint8Array, end: number): number | null => {
      let depth = 0;
      const floor = Math.max(0, end - 65_536);
      for (let i = end - 1; i > floor; i -= 1) {
        if (bytes[i] === 0x3e && bytes[i - 1] === 0x3e) {
          depth += 1;
          i -= 1;
        } else if (bytes[i] === 0x3c && bytes[i - 1] === 0x3c) {
          depth -= 1;
          i -= 1;
          if (depth === 0) return i;
        }
      }
      return null;
    };
    let seed = 7;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const alphabet = "<<>> s";
    let queries = 0;
    let matched = 0;
    for (let trial = 0; trial < 300; trial += 1) {
      const len = 10 + Math.floor(rand() * 400);
      const bytes = Uint8Array.from({ length: len }, () =>
        alphabet.charCodeAt(Math.floor(rand() * alphabet.length)),
      );
      const m = new DictMatcher(bytes);
      for (let end = 2; end < len; end += 1) {
        // The scan's contract: a `>>` ends at `end`, and `end` is not `>`.
        if (bytes[end - 1] !== 0x3e || bytes[end - 2] !== 0x3e) continue;
        if (bytes[end] === 0x3e) continue;
        const want = walkBack(bytes, end);
        expect(m.startBefore(end), `trial ${trial} end ${end}`).toBe(want);
        queries += 1;
        if (want !== null) matched += 1;
      }
    }
    // The window: a `<<` 64 KB back is too far for both; just inside is not.
    for (const gap of [65_000, 66_000]) {
      const far = new Uint8Array(gap + 5).fill(0x20);
      far.set([0x3c, 0x3c], 0);
      far.set([0x3e, 0x3e], gap + 2);
      const want = walkBack(far, gap + 4);
      expect(want).toBe(gap < 65_536 ? 0 : null);
      expect(new DictMatcher(far).startBefore(gap + 4)).toBe(want);
    }
    // Health: the property was asked many times, both ways.
    expect(queries).toBeGreaterThan(1_000);
    expect(matched).toBeGreaterThan(200);
    expect(queries - matched).toBeGreaterThan(200);
  });
});

describe("third review: no dictionary label, string or reference hides a stream from the scan", () => {
  const deepQ = unclosedQContent(100_000);
  const deflatedDeepQ = new Uint8Array(deflateSync(Buffer.from(deepQ)));

  it("STAMP-14: a page's content stream is q-counted whatever its dictionary says", async () => {
    // History: the scan skipped q counting for any stream labelled as an
    // image, a font program (/Length1), XRef, ObjStm, Metadata, EmbeddedFile,
    // or a /Subtype other than /Form. pdf.js's Page.getContentStream reads
    // /Contents without looking at any of them: /Subtype /Image read for
    // 90 s, /Length1 0 for 60 s.
    const labels = [
      "",
      "/Subtype /Image /Width 1 /Height 1",
      "/Length1 0",
      "/Length2 0 /Length3 0",
      "/Type /Metadata /Subtype /XML",
      "/Type /EmbeddedFile",
      "/Type /XRef",
      "/Subtype /PS",
      "/Type /ObjStm /N 0 /First 0",
    ];
    for (const label of labels) {
      const plain = await scanPdfStreams(labelledContentPdf(label, deepQ));
      expect(plain, label).toMatchObject({ exceeded: "q-depth" });
      const flate = await scanPdfStreams(
        labelledContentPdf(`${label} /Filter /FlateDecode`, deflatedDeepQ),
      );
      expect(flate, `${label} (Flate)`).toMatchObject({ exceeded: "q-depth" });
    }
    // An image label behind a reference (object 6 is /Image).
    expect(
      await scanPdfStreams(
        labelledContentPdf("/Subtype 6 0 R /Width 1 /Height 1", deepQ, [
          "/Image",
        ]),
      ),
    ).toMatchObject({ exceeded: "q-depth" });
  });

  it("CO-06: a content stream labelled /Subtype /Image is inflated and bounded like any other", async () => {
    // History: 2.4 KB of [/FlateDecode /FlateDecode] labelled as a 1x1 image
    // was never inflated (totalBytes 0), and extractPdfText held 2,350 MB.
    const bomb = await chainedFlateStream(MAX_DECODED_STREAM_BYTES + 2 ** 20);
    const s = await scanPdfStreams(
      labelledContentPdf(
        "/Subtype /Image /Width 1 /Height 1 /Filter [/FlateDecode /FlateDecode]",
        bomb,
      ),
    );
    expect(s.exceeded).toBe("stream-bytes");
    // Positive control: an image painted only by `Do` is still read from its
    // dictionary, never inflated, so a real file's images cost the scan
    // nothing (the image is 3,000 x 3,000 RGB, 27 MB decoded).
    const ops = "q 100 0 0 100 0 0 cm /Im1 Do Q";
    const painted = await scanPdfStreams(
      labelledContentPdf("", ops, [
        {
          dict: "/Type /XObject /Subtype /Image /Width 3000 /Height 3000 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode",
          stream: deflateSync(Buffer.alloc(3000 * 3000 * 3)),
        },
      ]),
    );
    expect(painted).toMatchObject({
      inflated: 0,
      totalBytes: ops.length,
      maxImagePixels: 9_000_000,
      exceeded: null,
    });
    // Builds and scans a 401 MB bomb: ~2 s alone, more under a full run.
  }, 60_000);

  it("an image-labelled stream named through an indirect /Contents array is content too; an array the scan cannot see makes every image content", async () => {
    const file = (contents: string, extra: Parameters<typeof rawPdf>[0]) =>
      rawPdf([
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${contents} >>`,
        { dict: "/Subtype /Image /Width 1 /Height 1", stream: deepQ },
        ...extra,
      ]);
    expect(await scanPdfStreams(file("5 0 R", ["[4 0 R]"]))).toMatchObject({
      exceeded: "q-depth",
    });
    expect(await scanPdfStreams(file("[4 0 R]", []))).toMatchObject({
      exceeded: "q-depth",
    });
    expect(
      await scanPdfStreams(file("% a comment\n[4 0 R]", [])),
    ).toMatchObject({ exceeded: "q-depth" });
    expect(await scanPdfStreams(file("4 0 R", []))).toMatchObject({
      exceeded: "q-depth",
    });
    // Object 5 sits in an object stream: the array is not visible as text.
    const objStm = deflateSync(Buffer.from("5 0 [4 0 R]", "latin1"));
    expect(
      await scanPdfStreams(
        file("5 0 R", [
          null,
          {
            dict: "/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode",
            stream: objStm,
          },
        ]),
      ),
    ).toMatchObject({ exceeded: "q-depth" });
    // The page itself in an object stream, with no /Type label (pdf.js reads
    // an object stream by its /First and /N alone).
    const pageStm = deflateSync(
      Buffer.from(
        "3 0 << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Cont#65nts [4 0 R] >>",
        "latin1",
      ),
    );
    expect(
      await scanPdfStreams(
        rawPdf([
          "<< /Type /Catalog /Pages 2 0 R >>",
          "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
          null,
          { dict: "/Subtype /Image /Width 1 /Height 1", stream: deepQ },
          { dict: "/N 1 /First 4 /Filter /FlateDecode", stream: pageStm },
        ]),
      ),
    ).toMatchObject({ exceeded: "q-depth" });
    // Positive control: the same image named by nothing is an image.
    expect(await scanPdfStreams(file("[]", []))).toMatchObject({
      exceeded: null,
      maxQDepth: 0,
    });
  });

  it("a string or comment in a stream dictionary does not end it: the dictionary is parsed as pdf.js parses it", async () => {
    // History: '/X (>>stream)' ended the dictionary at the string, so the
    // /Filter after it was lost and the q counter read compressed bytes;
    // extractPdfText read the page for over 60 s.
    const dicts = [
      "/X (>>stream) /Filter /FlateDecode",
      "/Filter /FlateDecode /X (>>stream)",
      "/Filter /FlateDecode /T (<<)",
      "/T (<<) /Filter /FlateDecode",
      "/X (a \\) >>stream) /Filter /FlateDecode",
      "/X (>>stream 9 0 obj << >>stream) /Filter /FlateDecode",
      "/X <3e3e> /Filter /FlateDecode %>>stream\n",
    ];
    for (const d of dicts) {
      expect(
        await scanPdfStreams(labelledContentPdf(d, deflatedDeepQ)),
        d,
      ).toMatchObject({ exceeded: "q-depth" });
    }
    const bomb = await chainedFlateStream(MAX_DECODED_STREAM_BYTES + 2 ** 20);
    expect(
      await scanPdfStreams(
        labelledContentPdf(
          "/X (>>stream) /Filter [/FlateDecode /FlateDecode]",
          bomb,
        ),
      ),
    ).toMatchObject({ exceeded: "stream-bytes" });
    // A comment between the dictionary and `stream`, which pdf.js skips.
    const plain = Buffer.from(
      labelledContentPdf("/Filter /FlateDecode", deflatedDeepQ),
    );
    const at = plain.indexOf(">>\nstream\n");
    const withComment = Buffer.concat([
      plain.subarray(0, at + 2),
      Buffer.from(" % a comment >>\n", "latin1"),
      plain.subarray(at + 2),
    ]);
    expect(await scanPdfStreams(new Uint8Array(withComment))).toMatchObject({
      exceeded: "q-depth",
    });
    // Positive control: the same string over a shallow page passes.
    expect(
      await scanPdfStreams(
        labelledContentPdf(
          "/X (>>stream) /Filter /FlateDecode",
          deflateSync(Buffer.from(unclosedQContent(10))),
        ),
      ),
    ).toMatchObject({ exceeded: null, maxQDepth: 10 });
    // Builds and scans a 401 MB bomb: ~2 s alone, more under a full run.
  }, 60_000);

  it("CO-08: an image whose /Subtype is a reference is held to the image budget", async () => {
    // History: '/Subtype 7 0 R' (object 7 is /Image) read as no subtype, so
    // the image's pixels were never checked; rasterizePdf decoded it, 36.5 s
    // and 1.5 GB.
    const image = (dict: string, extra: string[] = []) =>
      scanPdfStreams(
        rawPdf([
          "<< /Type /Catalog /Pages 2 0 R >>",
          PAGES_PAINT_3,
          { dict, stream: "x" },
          ...extra,
        ]),
      );
    expect(
      await image("/Subtype 4 0 R /Width 10000 /Height 10000", ["/Image"]),
    ).toMatchObject({ smallestOverBudgetImage: 100_000_000 });
    // A reference the scan cannot resolve may be /Image too.
    expect(
      await image("/Subtype 99 0 R /Width 10000 /Height 10000"),
    ).toMatchObject({ smallestOverBudgetImage: 100_000_000 });
    expect(
      (await scanPdfStreams(await indirectSubtypePdf(10_000)))
        .smallestOverBudgetImage,
    ).toBe(100_000_000);
    // Positive controls: a reference to /Form, and a small indirect image.
    expect(
      await image("/Subtype 4 0 R /BBox [0 0 1 1]", ["/Form"]),
    ).toMatchObject({ smallestOverBudgetImage: null, maxImagePixels: 0 });
    expect(
      await image("/Subtype 4 0 R /Width 100 /Height 100", ["/Image"]),
    ).toMatchObject({ smallestOverBudgetImage: null, maxImagePixels: 10_000 });
  });
});

describe("third review: what the label-blind scan still holds back, and its readers", () => {
  it("a font program no /Contents names keeps its q out of the bounds; a form or pattern with the same labels is counted", async () => {
    const file = (dict: string, paint = "") =>
      scanPdfStreams(
        rawPdf([
          "<< /Type /Catalog /Pages 2 0 R >>",
          "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /XObject << /Fm1 6 0 R >> >> /Contents 4 0 R >>",
          { dict: "", stream: `0 0 m ${paint}` },
          null,
          { dict, stream: "q\n".repeat(20_000) },
        ]),
      );
    // Font programs are binary and hold `q` bytes (the legit corpus: up to
    // 14 unclosed per file); summed over a document's fonts they must not
    // refuse it.
    expect(await file("/Length1 40000")).toMatchObject({
      exceeded: null,
      maxQDepth: 0,
    });
    expect(await file("/Subtype /Type1C")).toMatchObject({ exceeded: null });
    // pdf.js paints a form by its /Subtype alone, and a tiling pattern by its
    // /PatternType, whatever else the dictionary says.
    expect(
      await file("/Type /Metadata /Subtype /Form /Length1 1", "/Fm1 Do"),
    ).toMatchObject({ exceeded: "q-depth" });
    expect(await file("/Length1 1 /PatternType 1 /PaintType 1")).toMatchObject({
      exceeded: "q-depth",
    });
  });

  it("objectHeaderNumber reads a header as pdf.js's lexer does", () => {
    const at = (s: string) => {
      const b = Uint8Array.from(s, (c) => c.charCodeAt(0));
      return objectHeaderNumber(b, s.lastIndexOf("obj"));
    };
    expect(at("\n12 0 obj")).toBe(12);
    expect(at("\n12 0 % note\n obj")).toBe(12);
    expect(at("\n12 % a\n 0 %b\nobj<<")).toBe(12);
    expect(at("\n12 0obj")).toBe(12);
    expect(at("\n+12 0 obj")).toBe(12);
    expect(at("\n12.5 0 obj")).toBeNaN();
    // Not headers: the end of an object, a keyword glued to a word.
    expect(at("\n12 0 endobj")).toBeNull();
    expect(at("\n12 0 objx")).toBeNull();
    expect(at("\n0 obj")).toBeNull();
  });

  it("ContentsRefs finds the same references however its text is cut into chunks", () => {
    const text =
      "<< /Type /Page /Contents [4 0 R 5 0 R] >> << /Cont#65nts 6 0 R >> " +
      "<< /Contents % c\n 7 0 R /Annots [8 0 R] >> << /Contents (not a ref) >> " +
      "<< /Contents\n[ 9 0 R\n% c ]\n10 0 R ] /Contents 11 0 R";
    const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
    const whole = new ContentsRefs();
    whole.feed(bytes);
    whole.reset();
    // Health: both kinds are found, and what is not /Contents is not.
    expect([...whole.arrays].sort((a, b) => a - b)).toEqual([4, 5, 9, 10]);
    expect([...whole.direct].sort((a, b) => a - b)).toEqual([6, 7, 11]);
    for (const size of [1, 2, 3, 7, 13]) {
      const cut = new ContentsRefs();
      for (let i = 0; i < bytes.length; i += size) {
        cut.feed(bytes.subarray(i, i + size));
      }
      cut.reset();
      expect([...cut.arrays].sort(), `chunks of ${size}`).toEqual(
        [...whole.arrays].sort(),
      );
      expect([...cut.direct].sort(), `chunks of ${size}`).toEqual(
        [...whole.direct].sort(),
      );
    }
  });
});

describe("hostile review (2026-11-09): the images pdf.js may paint, at what they cost", () => {
  /** A one-page file (page content is object 4) drawing `content`, objects 6.. after. */
  const file = (
    content: string,
    extra: (string | { dict: string; stream: string })[] = [],
    resources = "",
  ) =>
    rawPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << ${resources} >> /Contents 4 0 R >>`,
      { dict: "", stream: content },
      HELVETICA,
      ...extra,
    ]);
  const page = (...args: Parameters<typeof file>) =>
    scanPdfStreams(file(...args));
  /** The size a preview of `content` skips images at (pdf.js skips w x h > it). */
  const skipsAbove = async (content: string) =>
    (await preflightPdfjsBytes(file(content))).previewOptions.maxImageSize;
  const inlineImage = (dict: string) =>
    `q 100 0 0 100 50 50 cm BI ${dict} ID xyz\nEI Q\n`;

  it("an inline image is sized from its own dictionary, as pdf.js reads it", async () => {
    // History: the scan sized only image STREAMS, so this one drew in
    // 32.6 s in the editor, with no notice.
    expect(
      (await page(inlineImage("/W 10000 /H 10000 /CS /RGB /BPC 8 /F /Fl")))
        .smallestOverBudgetImage,
    ).toBe(100_000_000);
    // Full names, a name escape, and a dictionary glued to BI.
    expect(
      (await page(inlineImage("/Width 9000 /Height 9000 /BPC 8")))
        .smallestOverBudgetImage,
    ).toBe(81_000_000);
    expect(
      (await page(inlineImage("/#57 10000 /H 10000 /BPC 8")))
        .smallestOverBudgetImage,
    ).toBe(100_000_000);
    expect(
      (await page("BI/W 10000/H 10000/BPC 8 ID xyz\nEI"))
        .smallestOverBudgetImage,
    ).toBe(100_000_000);
    // A bilevel inline image keeps the bilevel budget; with a colour-key
    // /Mask pdf.js expands it to RGBA, so it does not.
    expect(
      (await page(inlineImage("/W 12000 /H 12000 /BPC 1 /CS /G")))
        .smallestOverBudgetImage,
    ).toBeNull();
    expect(
      (await page(inlineImage("/W 12000 /H 12000 /BPC 1 /CS /G /Mask [1 1]")))
        .smallestOverBudgetImage,
    ).toBe(144_000_000);
    // Positive control: a 1,000 x 1,000 inline image is within budget.
    expect(
      await page(inlineImage("/W 1000 /H 1000 /CS /RGB /BPC 8")),
    ).toMatchObject({ smallestOverBudgetImage: null, unknownSizeImages: 0 });
  });

  it("an inline image after the first EI is bounded by the loose reading, which no comment or padding hides, and skipped at the budget", async () => {
    const small = inlineImage("/W 2 /H 2 /BPC 8");
    // The second image sits where the reading is loose: its size is bounded,
    // not known, so a preview skips every image past the colour budget.
    const loose = async (content: string) => {
      expect(await page(content)).toMatchObject({ unknownSizeImages: 1 });
      expect(await skipsAbove(content)).toBe(RASTER_MAX_IMAGE_PIXELS);
    };
    await loose(small + inlineImage("/W 10000 /H 10000 /BPC 8"));
    // pdf.js skips the comment; a reader that ended the dictionary at its
    // `ID` would see no /W.
    await loose(`${small}BI /BPC 8 %ID\n /W 10000 /H 10000 ID xyz\nEI\n`);
    await loose(
      `${small}BI /BPC 8 ${" ".repeat(70_000)}/W 10000 /H 10000 ID xyz\nEI\n`,
    );
    // The bound is not the skip size: a 20,000 x 100 strip beside an
    // 8,000 x 8,000 image bounds both at 160 MP, and a preview set below
    // THAT would decode the 64 MP image. It is skipped at the budget.
    const strip =
      small +
      inlineImage("/W 20000 /H 100 /BPC 8") +
      inlineImage("/W 8000 /H 8000 /BPC 8");
    await loose(strip);
    expect(await skipsAbove(strip)).toBeLessThan(8000 * 8000);
    // An exact dictionary too long to read is of unknown size.
    expect(
      (await page(`BI /BPC 8 ${" ".repeat(70_000)}/W 10 /H 10 ID xyz\nEI\n`))
        .unknownSizeImages,
    ).toBe(1);
    // Positive control: small inline images, loose ones included, are
    // within budget and set nothing.
    const two = small + inlineImage("/W 300 /H 200 /BPC 8");
    expect(await page(two)).toMatchObject({
      smallestOverBudgetImage: null,
      unknownSizeImages: 0,
    });
    expect(await skipsAbove(two)).toBeUndefined();
  });

  it("an image nothing references is never painted, so it is not counted; a referenced one is, wherever the reference sits", async () => {
    const big = {
      dict: "/Type /XObject /Subtype /Image /Width 8000 /Height 8000 /BitsPerComponent 8 /ColorSpace /DeviceRGB",
      stream: "x",
    };
    // History: an orphan 64 MP object set maxImageSize to 63,999,999 and the
    // page's own 144 MP bilevel scan vanished with it.
    expect(await page("0 0 m\n", [big])).toMatchObject({
      smallestOverBudgetImage: null,
      maxImagePixels: 64_000_000,
    });
    // Positive controls: named by the page's resources, or only inside
    // another stream's data (a reference the scan may misread as data).
    expect(
      (await page("0 0 m\n", [big], "/XObject << /Im1 6 0 R >>"))
        .smallestOverBudgetImage,
    ).toBe(64_000_000);
    expect(
      (await page("0 0 m\n", [big, { dict: "/Length1 9", stream: "6 0 R" }]))
        .smallestOverBudgetImage,
    ).toBe(64_000_000);
  });

  it("an image's soft mask and mask are charged to it, at their own size, and it is recorded by its own size", async () => {
    const parent = (masks: string) => ({
      dict: `/Type /XObject /Subtype /Image /Width 10 /Height 10 /BitsPerComponent 8 /ColorSpace /DeviceRGB ${masks}`,
      stream: "x",
    });
    const mask = (dict: string) => ({
      dict: `/Width 10000 /Height 10000 /BitsPerComponent 8 /ColorSpace /DeviceGray ${dict}`,
      stream: "x",
    });
    const res = "/XObject << /Im1 6 0 R >>";
    // History: an /SMask with no /Subtype was not seen (a 380 MP one drew
    // in 7.9 s at ~4.7 GB); one WITH /Subtype /Image set maxImageSize to its
    // own size, which the 100-pixel image passes, so pdf.js decoded it.
    // pdf.js compares maxImageSize with the painted image's own size, so the
    // image is recorded by that: a preview below it skips the image, masks
    // and all.
    expect(
      (await page("0 0 m\n", [parent("/SMask 7 0 R"), mask("")], res))
        .smallestOverBudgetImage,
    ).toBe(100);
    expect(
      (
        await page(
          "0 0 m\n",
          [parent("/SMask 7 0 R"), mask("/Type /XObject /Subtype /Image")],
          res,
        )
      ).smallestOverBudgetImage,
    ).toBe(100);
    expect(
      (await page("0 0 m\n", [parent("/Mask 7 0 R"), mask("")], res))
        .smallestOverBudgetImage,
    ).toBe(100);
    // A mask whose size cannot be read: the image is held as over budget.
    expect(
      (
        await page(
          "0 0 m\n",
          [
            parent("/SMask 7 0 R"),
            { dict: "/Width 99 0 R /Height 10", stream: "x" },
          ],
          res,
        )
      ).smallestOverBudgetImage,
    ).toBe(100);
    // Positive controls: a small mask, and a mask that names no stream
    // (pdf.js ignores it).
    expect(
      (
        await page(
          "0 0 m\n",
          [
            parent("/SMask 7 0 R"),
            { dict: "/Width 10 /Height 10", stream: "x" },
          ],
          res,
        )
      ).smallestOverBudgetImage,
    ).toBeNull();
    expect(
      (await page("0 0 m\n", [parent("/SMask 99 0 R")], res))
        .smallestOverBudgetImage,
    ).toBeNull();
  });

  it("a 1-bit gray image with a /Mask or an /SMask is not bilevel: pdf.js expands it to RGBA", async () => {
    const scan = (masks: string) =>
      page(
        "0 0 m\n",
        [
          {
            dict: `/Type /XObject /Subtype /Image /Width 19500 /Height 19500 /BitsPerComponent 1 /ColorSpace /DeviceGray ${masks}`,
            stream: "x",
          },
          { dict: "/Width 1 /Height 1", stream: "x" },
        ],
        "/XObject << /Im1 6 0 R >>",
      );
    // History: held to the 400 MP bilevel budget; drew in 6.9 s at ~4.7 GB.
    expect((await scan("/Mask [1 1]")).smallestOverBudgetImage).toBe(
      19500 * 19500,
    );
    expect((await scan("/SMask 7 0 R")).smallestOverBudgetImage).toBe(
      19500 * 19500,
    );
    // Positive control: without a mask it is bilevel, and within budget.
    expect((await scan("")).smallestOverBudgetImage).toBeNull();
    expect(19500 * 19500).toBeLessThan(RASTER_MAX_BILEVEL_PIXELS);
  });
});

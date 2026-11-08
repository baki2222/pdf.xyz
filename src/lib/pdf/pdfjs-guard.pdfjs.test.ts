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
import { unsupportedEncryptionPdf } from "@/tests/unsupported-encryption";
import {
  PdfEncryptedError,
  PdfEngineError,
  UNREADABLE_PDF_MESSAGE,
  pdfjsLoadError,
} from "./engine-errors";
import { readPagesWithPdfjs } from "./pdfjs";
import {
  MAX_DECODED_STREAM_BYTES,
  MAX_GRAPHICS_STATE_DEPTH,
  RASTER_MAX_BILEVEL_PIXELS,
  RASTER_MAX_IMAGE_PIXELS,
  pdfjsPageCount,
  pdfjsPageError,
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
          "<< /Type /Pages /Kids [] /Count 0 >>",
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
    expect(
      over(
        await image(
          `${A3_600} /BitsPerComponent 1 /ColorSpace /CalGray /Filter /CCITTFaxDecode`,
        ),
      ),
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

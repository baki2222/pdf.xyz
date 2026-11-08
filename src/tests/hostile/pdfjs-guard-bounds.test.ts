import { describe, expect, test } from "vitest";
import {
  PDF_EXPANDS_TOO_FAR_MESSAGE,
  PDF_IMAGE_TOO_LARGE_MESSAGE,
  PDF_NESTED_TOO_DEEPLY_MESSAGE,
} from "@/lib/pdf/pdfjs-guard";
import { runBounded, type BoundedOutcome } from "./bounded";

// The hostile matrix's resource findings on pdf.js consumers, each run at the
// entry point a tool calls (extractPdfText, rasterizePdf) in a child process
// with a hard kill: before the fix STAMP-14 ran for 493 s, and CO-06 inflated
// 1 GiB, which no in-process timeout can interrupt.
const CHILD = "src/tests/hostile/pdfjs-guard.child.ts";

/** The value a settled child reported; fails loudly on a hang or crash. */
function settled(r: BoundedOutcome): Record<string, unknown> {
  expect(r, JSON.stringify(r)).toMatchObject({ kind: "settled" });
  return (r as { value: Record<string, unknown> }).value;
}

describe("pdf.js consumers stay bounded on hostile streams", () => {
  test("CO-06: a 2.5 KB chained-Flate content bomb is refused, typed, without inflating 1 GiB", async () => {
    const v = settled(
      await runBounded(CHILD, ["co06-text"], 60_000, { maxOldSpaceMb: 1024 }),
    );
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_EXPANDS_TOO_FAR_MESSAGE,
    });
    // Second, independent bound: the process never held the gigabyte. The
    // unfixed run peaked at 1.2-3.6 GB; the refusal streams and keeps nothing.
    expect(v.maxRssMb as number).toBeLessThan(900);
  }, 90_000);

  test("CO-06 positive control: the same reader on a plain file reads its text", async () => {
    const v = settled(await runBounded(CHILD, ["co06-control-text"], 60_000));
    expect(v).toMatchObject({ ok: true, pageCount: 1 });
    expect(v.text).toContain("HOSTILE MARKER");
  }, 90_000);

  test("STAMP-14: 100,000 unclosed q is refused in seconds, not read for 8 minutes", async () => {
    const v = settled(await runBounded(CHILD, ["stamp14-text"], 30_000));
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_NESTED_TOO_DEEPLY_MESSAGE,
    });
  }, 60_000);

  test("STAMP-14 boundary: nesting exactly MAX_GRAPHICS_STATE_DEPTH still reads", async () => {
    const v = settled(
      await runBounded(CHILD, ["stamp14-at-bound-text"], 30_000),
    );
    expect(v).toMatchObject({ ok: true, pageCount: 1 });
    expect(v.text).toContain("Hostile control");
  }, 60_000);

  test("STAMP-14, split: one page of 32 streams x 1,020 unclosed q (32,640 deep) is refused, not read for 66 s", async () => {
    const v = settled(await runBounded(CHILD, ["stamp14-split-text"], 30_000));
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_NESTED_TOO_DEEPLY_MESSAGE,
    });
  }, 60_000);

  test("STAMP-14 control: one stream 5,000 deep (1.45-1.55 s on base) still reads", async () => {
    const v = settled(await runBounded(CHILD, ["stamp14-5k-text"], 30_000));
    expect(v).toMatchObject({ ok: true, pageCount: 1 });
    expect(v.text).toContain("END");
  }, 60_000);

  test("STAMP-14, work: one form 16,000 deep painted 30 times (157 s on the first repair) is refused in seconds", async () => {
    // History: the first repair bounded DEPTH only. This page never goes past
    // 16,000, so it passed, and pdf.js climbed the nest 30 times.
    const v = settled(
      await runBounded(CHILD, ["stamp14-form-repeat-text"], 30_000),
    );
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_NESTED_TOO_DEEPLY_MESSAGE,
    });
  }, 60_000);

  test("STAMP-14, work control: the same form painted once still reads", async () => {
    const v = settled(
      await runBounded(CHILD, ["stamp14-form-once-text"], 30_000),
    );
    expect(v).toMatchObject({ ok: true, pageCount: 1 });
    expect(v.text).toContain("MARK");
  }, 60_000);

  test("CO-08: a 100 MP image whose /Width is an indirect reference is refused like a direct one", async () => {
    // History: the scan read `/Width 7 0 R` as no width (0 pixels) and pdf.js
    // resolved it and decoded the whole image: 29.8 s, 1.5 GB.
    const v = settled(
      await runBounded(CHILD, ["co08-indirect-width-raster"], 20_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_IMAGE_TOO_LARGE_MESSAGE,
    });
    expect(v.maxRssMb as number).toBeLessThan(900);
  }, 60_000);

  test("the scan is linear: 4.5 MB of `>>stream` with no `<<` is scanned in seconds, not 18 s", async () => {
    // History: each keyword walked back 64 KB looking for `<<`, synchronously,
    // in the tab's own thread (the preflight runs before pdf.js's worker).
    const v = settled(
      await runBounded(CHILD, ["scan-unmatched-dict-preflight"], 20_000),
    );
    expect(v).toMatchObject({ ok: true, bytes: 4_500_015 });
    expect(v.preflightMs as number).toBeLessThan(3_000);
  }, 60_000);

  test("the scan is linear: 4 MB of `<</Length 0>>stream` with no endstream is scanned in seconds", async () => {
    // History: each keyword searched forward to the end of the file for an
    // `endstream` that is not there: 400 KB took 7.5 s, 1.6 MB did not finish
    // in 2 minutes.
    const v = settled(
      await runBounded(CHILD, ["scan-no-endstream-preflight"], 20_000),
    );
    expect(v).toMatchObject({ ok: true, bytes: 4_000_015 });
    expect(v.preflightMs as number).toBeLessThan(3_000);
  }, 60_000);

  test("CO-08: a 100 MP image is refused by name before pdf.js decodes it", async () => {
    const v = settled(
      await runBounded(CHILD, ["co08-raster"], 30_000, { maxOldSpaceMb: 2048 }),
    );
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_IMAGE_TOO_LARGE_MESSAGE,
    });
    // Second bound: refused before the decode (42 s and 1.5 GB unfixed).
    expect(v.maxRssMb as number).toBeLessThan(900);
  }, 60_000);

  test("CO-08 bilevel: a 600-dpi A3 1-bit scan (69.6 MP, 0.38-0.45 s on base) still rasterizes", async () => {
    const v = settled(
      await runBounded(CHILD, ["co08-bilevel-a3-raster"], 60_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v).toMatchObject({ ok: true, pages: 1 });
  }, 90_000);

  test("CO-08 output path: a file whose page 2 holds the 100 MP image is refused by name, even under onPageFailed", async () => {
    // A page written without its image would be a wrong document, and pdf.js
    // 6 cannot say which page skipped one (see preflightPdfjsBytes), so the
    // output paths refuse the file.
    const v = settled(
      await runBounded(CHILD, ["co08-per-page-raster"], 30_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_IMAGE_TOO_LARGE_MESSAGE,
    });
  }, 60_000);

  test("CO-08 previews: both pages get a thumbnail, in seconds; pdf.js skips only the 100 MP image", async () => {
    // History: the first fix refused the whole file at createThumbnailRenderer,
    // and every caller swallows that (`catch {}`), so a file with one huge
    // image silently had no previews at all.
    const v = settled(
      await runBounded(CHILD, ["co08-per-page-thumbs"], 30_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v).toMatchObject({ ok: true, previews: [true, true] });
    expect(v.maxRssMb as number).toBeLessThan(900);
  }, 60_000);

  test("CO-08 positive control: a 9 MP image page still rasterizes", async () => {
    const v = settled(
      await runBounded(CHILD, ["co08-control-raster"], 60_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v).toMatchObject({ ok: true, pages: 1 });
  }, 90_000);
});

describe("third review: labels, strings and references that hid a stream", () => {
  const nested = {
    name: "PdfEngineError",
    message: PDF_NESTED_TOO_DEEPLY_MESSAGE,
  };

  test("STAMP-14: page content labelled /Subtype /Image (90 s hang before) is refused in seconds", async () => {
    const v = settled(await runBounded(CHILD, ["label-image-q-text"], 30_000));
    expect(v.error).toMatchObject(nested);
  }, 60_000);

  test("positive control: pdf.js reads an image-labelled /Contents stream as page content", async () => {
    // Without this, the refusal above could be of a file pdf.js never reads.
    const v = settled(
      await runBounded(CHILD, ["label-image-control-text"], 30_000),
    );
    expect(v).toMatchObject({ ok: true, pageCount: 1 });
    expect(v.text).toContain("MARK");
  }, 60_000);

  test("STAMP-14: page content labelled /Length1 0 (60 s hang before) is refused in seconds", async () => {
    const v = settled(
      await runBounded(CHILD, ["label-length1-q-text"], 30_000),
    );
    expect(v.error).toMatchObject(nested);
  }, 60_000);

  test("CO-06: a 1 GiB chained-Flate bomb labelled as a 1x1 image (2,350 MB before) is refused without inflating it", async () => {
    const v = settled(
      await runBounded(CHILD, ["label-image-bomb-text"], 60_000, {
        maxOldSpaceMb: 1024,
      }),
    );
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_EXPANDS_TOO_FAR_MESSAGE,
    });
    expect(v.maxRssMb as number).toBeLessThan(900);
  }, 90_000);

  test("STAMP-14: '(>>stream)' in the content dictionary (60 s hang before) does not hide its /Filter", async () => {
    const v = settled(
      await runBounded(CHILD, ["dict-string-flate-q-text"], 30_000),
    );
    expect(v.error).toMatchObject(nested);
  }, 60_000);

  test("positive control: the same dictionary string over a shallow page still reads", async () => {
    const v = settled(
      await runBounded(CHILD, ["dict-string-control-text"], 30_000),
    );
    expect(v).toMatchObject({ ok: true, pageCount: 1 });
    expect(v.text).toContain("MARK");
  }, 60_000);

  test("CO-08: a 100 MP image whose /Subtype is a reference (36.5 s, 1.5 GB before) is refused by name", async () => {
    const v = settled(
      await runBounded(CHILD, ["co08-indirect-subtype-raster"], 20_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_IMAGE_TOO_LARGE_MESSAGE,
    });
    expect(v.maxRssMb as number).toBeLessThan(900);
  }, 60_000);
});

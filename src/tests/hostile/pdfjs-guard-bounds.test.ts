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

import { describe, expect, test } from "vitest";
import {
  PDF_EXPANDS_TOO_FAR_MESSAGE,
  PDF_IMAGE_TOO_LARGE_MESSAGE,
  PDF_NESTED_TOO_DEEPLY_MESSAGE,
} from "@/lib/pdf/pdfjs-guard";
import { UNREADABLE_PDF_MESSAGE } from "@/lib/pdf/engine-errors";
import { runBounded, type BoundedOutcome } from "./bounded";

// The hostile matrix's resource findings on pdf.js consumers, each run at the
// entry point a tool calls (extractPdfText, rasterizePdf) in a child process
// with a hard kill: before the fix STAMP-14 ran for 493 s, and CO-06 inflated
// 1 GiB, which no in-process timeout can interrupt.
/**
 * What one hostile case may ADD to the child's resident memory, MB, read by
 * ./memory.ts after pdf.js and the canvas are warmed on a clean file (see
 * `warm` in ./pdfjs-guard.child.ts). The unfixed cases inflated 1.2-3.6 GB;
 * measured after the fix, on Linux / Node 22: 10-11 MB.
 *
 * WAS an absolute `maxRssMb < 900`, which counted pdf.js's own load (about
 * 500 MB on Linux) against the file. It read 933 on CI for PR #299 with
 * nothing wrong.
 */
const GROWTH_MB = 300;
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
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
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
    // Positive controls: content AT the bound must be read, not refused, so
    // they get time. Measured 2026-11-09: 2.6-3.2 s on Windows / Node 24,
    // 17 s (this one) and 25 s (the work control) on Linux / Node 22 in the
    // worker image. CI runs Node 22 under load, where 30 s was a "hang".
    const v = settled(
      await runBounded(CHILD, ["stamp14-at-bound-text"], 120_000),
    );
    expect(v).toMatchObject({ ok: true, pageCount: 1 });
    expect(v.text).toContain("Hostile control");
  }, 150_000);

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
    // See the boundary control above for the measured times (25 s here on
    // Linux / Node 22).
    const v = settled(
      await runBounded(CHILD, ["stamp14-form-once-text"], 120_000),
    );
    expect(v).toMatchObject({ ok: true, pageCount: 1 });
    expect(v.text).toContain("MARK");
  }, 150_000);

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
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
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
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
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
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 60_000);

  test("CO-08 editor canvas: Edit/Annotate/Sign PDF draw page 1 in seconds, without the 100 MP image, and say so", async () => {
    // History (2026-11-09): `openEditorPdf` ran the preflight but dropped its
    // previewOptions, so the editor decoded the image the thumbnails skip:
    // killed at this bound, where the thumbnails of the same file took
    // seconds. A preview, not an output: the page is drawn without the image
    // and the editor says so in the output paths' own sentence.
    const v = settled(
      await runBounded(CHILD, ["co08-editor-render"], 30_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v).toMatchObject({ ok: true, drawn: true, size: [300, 200] });
    // The image's place is the white sheet: skipped, not decoded.
    expect(v.ink).toEqual([765, 765]);
    expect(v.notice as string).toContain(PDF_IMAGE_TOO_LARGE_MESSAGE);
    expect(v.renderMs as number).toBeLessThan(10_000);
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 60_000);

  test("CO-08 editor canvas positive control: a 9 MP image is drawn, and nothing is said", async () => {
    const v = settled(
      await runBounded(CHILD, ["co08-control-editor-render"], 60_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v).toMatchObject({ ok: true, drawn: true, size: [300, 200] });
    // The image of zeros, painted: black where the skipped one left white.
    expect(v.ink).toEqual([0, 0]);
    expect(v.notice).toBeNull();
  }, 90_000);

  test("the editor canvas at its deepest zoom on an A0 page stays within MAX_CANVAS_PIXELS at every device ratio", async () => {
    // History (2026-11-09): `cappedPixelRatio` floored the ratio at 0.5, so a
    // page whose CSS area passed 64 MP (A0 at 400%: 228 MP) was allocated
    // past the cap it is named for (57 MP here).
    const { MAX_CANVAS_PIXELS } = await import("@/lib/pdf/editor/page-render");
    const v = settled(
      await runBounded(CHILD, ["editor-zoom-a0"], 60_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    const renders = v.renders as { ratio: number; pixels: number | null }[];
    // Health: three renders, each drawn (a null would pass any bound).
    expect(renders.map((r) => r.ratio)).toEqual([1, 2, 3]);
    for (const r of renders) {
      expect(r.pixels, `ratio ${r.ratio}`).not.toBeNull();
      expect(r.pixels!, `ratio ${r.ratio}`).toBeLessThanOrEqual(
        MAX_CANVAS_PIXELS,
      );
      // And not starved: the cap is reached, not undershot by a factor.
      expect(r.pixels!, `ratio ${r.ratio}`).toBeGreaterThan(
        MAX_CANVAS_PIXELS * 0.99,
      );
    }
  }, 90_000);

  test("an inline 100 MP image: the editor draws page 1 in seconds, without it, and says so", async () => {
    // History (hostile review, 2026-11-09): the scan sized image STREAMS
    // only, so `BI /W 10000 /H 10000 ... ID` passed with no options and the
    // editor decoded it: 32,649 ms on page 1, no notice.
    const v = settled(
      await runBounded(CHILD, ["inline-editor-render"], 30_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v).toMatchObject({ ok: true, drawn: true, size: [300, 200] });
    expect(v.ink).toEqual([765, 765]);
    expect(v.notice as string).toContain(PDF_IMAGE_TOO_LARGE_MESSAGE);
    expect(v.renderMs as number).toBeLessThan(10_000);
  }, 60_000);

  test("an inline image positive control: 1,000 x 1,000 is drawn, and nothing is said", async () => {
    const v = settled(
      await runBounded(CHILD, ["inline-control-editor-render"], 30_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v).toMatchObject({ ok: true, drawn: true, notice: null });
    expect(v.ink).toEqual([0, 0]);
  }, 60_000);

  test("an orphan over-budget image hides nothing: the page's own 144 MP bilevel scan is drawn, and nothing is said", async () => {
    // History (hostile review, 2026-11-09): an 8,000 x 8,000 image object
    // nothing references set maxImageSize to 63,999,999, so the page's own
    // scan, within its budget, was skipped: blank page 1 in 5 ms, and a
    // notice about an image that was never on the page.
    const v = settled(
      await runBounded(CHILD, ["orphan-bilevel-editor-render"], 60_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    expect(v).toMatchObject({ ok: true, drawn: true, notice: null });
    expect(v.ink).toEqual([0, 0]);
  }, 90_000);

  for (const [name, typed] of [
    ["softmask-editor-render", "with"],
    ["softmask-untyped-editor-render", "without"],
  ] as const) {
    test(`a 10 x 10 image with a 100 MP soft mask ${typed} /Subtype: skipped before its mask is decoded, and the notice is true`, async () => {
      // History (hostile review, 2026-11-09): masks were not charged. With
      // /Subtype the mask set maxImageSize to ITS size, which the 100-pixel
      // image passes, so pdf.js decoded the mask (2.0 s) under a notice
      // that said the image was left out; without it nothing was seen.
      const v = settled(
        await runBounded(CHILD, [name], 30_000, { maxOldSpaceMb: 2048 }),
      );
      expect(v).toMatchObject({ ok: true, drawn: true, size: [300, 200] });
      expect(v.ink).toEqual([765, 765]);
      expect(v.notice as string).toContain(PDF_IMAGE_TOO_LARGE_MESSAGE);
      expect(v.renderMs as number).toBeLessThan(500);
    }, 60_000);
  }

  test("the editor draws a page again (zoom, rail, canvas) without decoding its images again", async () => {
    // History (hostile review, 2026-11-09): every draw ended in
    // `page.cleanup()`, which drops the page's operator list and decoded
    // images, so each zoom step asked the worker again and decoded afresh
    // (asks 1, 2, 3 here; a 25 MP image took ~4 s per draw).
    const v = settled(
      await runBounded(CHILD, ["editor-redraw"], 60_000, {
        maxOldSpaceMb: 2048,
      }),
    );
    // Health: every draw drew, and the instrument saw the first draw ask
    // (a hook that saw nothing would read [0, 0, 0]).
    expect(v.asks).toEqual([1, 1, 1]);
  }, 90_000);

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
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
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
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 60_000);
});

describe("lane res1: every pdf.js open goes through the preflight", () => {
  // History: only the text and raster readers ran the stream preflight, and
  // only the access probe ran the xref pre-scan. These four readers opened
  // pdf.js with neither: measured on origin/main 2026-11-09 (Windows, Node
  // 24), the object-stream bomb opened and walked in 10.6-11.7 s, the
  // zero-width xref ran the child out of memory in 3 s, the q-split page was
  // read by the page board as if nothing were wrong and drawn by Auto-crop
  // in 9.3 s.
  const READERS = ["read-pages", "count-pages", "auto-crop", "editor-render"];
  const expanded = {
    name: "PdfEngineError",
    message: PDF_EXPANDS_TOO_FAR_MESSAGE,
  };
  const FILES: Record<string, object> = {
    "objstm-bomb": expanded,
    "zero-width-xref": {
      name: "PdfEngineError",
      message: UNREADABLE_PDF_MESSAGE,
      kind: "unreadable",
    },
    "q-split": {
      name: "PdfEngineError",
      message: PDF_NESTED_TOO_DEEPLY_MESSAGE,
    },
  };
  for (const reader of READERS) {
    test(`${reader}: each hostile file is refused, typed, and a plain file still opens`, async () => {
      for (const [file, error] of Object.entries(FILES)) {
        const v = settled(
          await runBounded(CHILD, [`open:${file}:${reader}`], 90_000, {
            maxOldSpaceMb: 1024,
          }),
        );
        expect(v.error, `${file} via ${reader}`).toMatchObject(error);
        // Second bound: refused in seconds, before pdf.js parsed anything.
        // Measured 2026-11-09 (Windows, Node 24): the object-stream bomb
        // 2.5-4 s (the preflight inflates up to its 1.6 GB budget), the
        // others under 0.5 s.
        const { ms, mb } = v.growth as { ms: number; mb: number };
        expect(ms, `${file} via ${reader}`).toBeLessThan(30_000);
        // Third bound, memory: the bomb's refusal comes from a preflight that
        // streams up to 1.6 GB through inflate, so what it KEEPS is the bound
        // worth pinning (added after review; the child always reported it).
        // Read from the fixture's end, after the warm-up (GROWTH_MB above).
        expect(mb, `${file} via ${reader}`).toBeLessThan(GROWTH_MB);
      }
      const control = settled(
        await runBounded(CHILD, [`open:control:${reader}`], 60_000),
      );
      expect(control, `control via ${reader}`).toMatchObject({ ok: true });
    }, 400_000);
  }
});

describe("lane res1: the access probe's open goes through the preflight too", () => {
  // History (review of lane res1, 2026-11-09): classifyPdfAccess ran the xref
  // pre-scan and a 30 s deadline but not the stream preflight, and the
  // open-preflight guard EXEMPTED it while the opener's docblock said every
  // open was preflighted. The probe runs on file arrival on the batch
  // runners, Compress, Protect/Unlock, Request Signatures and the single-file
  // look, so it is where a hostile file actually lands first: on d44ca719 the
  // object-stream bomb was opened and walked, verdict "unencrypted", in
  // 11.3 s at 621 MB peak RSS.
  for (const file of ["objstm-bomb", "zero-width-xref", "q-split"]) {
    test(`${file}: "unreadable", in seconds and bounded memory`, async () => {
      const v = settled(
        await runBounded(CHILD, [`open:${file}:access`], 90_000, {
          maxOldSpaceMb: 1024,
        }),
      );
      expect(v, file).toMatchObject({ ok: true, access: "unreadable" });
      const { ms, mb } = v.growth as { ms: number; mb: number };
      expect(ms, file).toBeLessThan(30_000);
      expect(mb, file).toBeLessThan(GROWTH_MB);
    }, 120_000);
  }

  test("positive control: a plain file is still unencrypted", async () => {
    const v = settled(await runBounded(CHILD, ["open:control:access"], 60_000));
    expect(v).toMatchObject({ ok: true, access: "unencrypted" });
  }, 90_000);
});

describe("lane res1: pdf.js's numPages is never looped over unchecked", () => {
  // /Count -1 over three real kids: pdf-lib's repair reads three pages,
  // pdf.js reports -1. Before: Auto-crop analysed 0 pages against 3 sizes
  // and planned "nothing to crop"; the editor opened with numPages -1.
  const unreadable = {
    name: "PdfEngineError",
    message: UNREADABLE_PDF_MESSAGE,
    kind: "unreadable",
  };
  test("Auto-crop refuses /Count -1 as unreadable, never a plan from 0 analysed pages", async () => {
    const v = settled(
      await runBounded(CHILD, ["open:count-minus-one:auto-crop"], 60_000),
    );
    expect(v.error).toMatchObject(unreadable);
  }, 90_000);

  test("the editor canvas refuses /Count -1 as unreadable", async () => {
    const v = settled(
      await runBounded(CHILD, ["open:count-minus-one:editor-render"], 60_000),
    );
    expect(v.error).toMatchObject(unreadable);
  }, 90_000);

  test("the same refusal the page board already gave (the reference behaviour)", async () => {
    const v = settled(
      await runBounded(CHILD, ["open:count-minus-one:read-pages"], 60_000),
    );
    expect(v.error).toMatchObject(unreadable);
  }, 90_000);
});

describe("lane res1: a Flate stage behind ASCIIHex is counted on the raster paths", () => {
  test("thumbnails refuse a page whose content is AHx over 1 GiB of Flate, without inflating it", async () => {
    const v = settled(
      await runBounded(CHILD, ["ahx-bomb-thumbs"], 60_000, {
        maxOldSpaceMb: 1024,
      }),
    );
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_EXPANDS_TOO_FAR_MESSAGE,
    });
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 90_000);

  test("PDF to JPG refuses it too", async () => {
    const v = settled(
      await runBounded(CHILD, ["ahx-bomb-raster"], 60_000, {
        maxOldSpaceMb: 1024,
      }),
    );
    expect(v.error).toMatchObject({
      name: "PdfEngineError",
      message: PDF_EXPANDS_TOO_FAR_MESSAGE,
    });
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 90_000);

  test("positive control: a small AHx+Flate content stream still renders", async () => {
    const v = settled(await runBounded(CHILD, ["ahx-control-raster"], 60_000));
    expect(v).toMatchObject({ ok: true, pages: 1 });
  }, 90_000);
});

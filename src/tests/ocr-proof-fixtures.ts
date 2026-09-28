/**
 * The OCR deployment proof's mixed document and the verdict that reads its
 * text sidecar — here rather than in `scripts/worker-prove-tools.ts` so the
 * verdict is tested (both directions) and run through the real text chain in
 * `src/lib/workers/ocr-native.test.ts`, not only on the day someone runs the
 * proof against a deployment.
 */
import { PDFDocument } from "pdf-lib";
import { encodePng } from "@/lib/pdf/extract-images";
import { embedRasterImage } from "@/lib/pdf/pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { skippedSidecarPages } from "@/lib/workers/ocr-sidecar";

/** The typed page's words in {@link mixedScanPdf}, read back from the .txt. */
export const MIXED_TYPED_LINE = "Typed cover page for the pdf.xyz OCR proof";

/**
 * A PDF whose first page already carries text and whose second is a scan — a
 * scanner app's "searchable PDF", or a scan behind a typed cover page.
 *
 * OCRmyPDF refuses such a file outright unless it is told what to do with the
 * page that has text, and until 2026-09-27 it was told nothing: every one of
 * these failed, three attempts each, while the only PDF proof was a pure scan
 * that can never hit it.
 */
export async function mixedScanPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, [MIXED_TYPED_LINE]);
  doc
    .addPage([595, 842])
    .drawText(MIXED_TYPED_LINE, { x: 60, y: 770, size: 16, font });
  const scan = doc.addPage([595, 842]);
  const size = 64;
  const samples = new Uint8Array(size * size * 3);
  for (let i = 0; i < samples.length; i++) samples[i] = (i * 7919) % 251;
  const img = await embedRasterImage(
    doc,
    encodePng(size, size, "rgb8", samples),
    "png",
  );
  scan.drawImage(img, { x: 60, y: 400, width: 400, height: 400 });
  return doc.save();
}

/**
 * The .txt of {@link mixedScanPdf}: the typed page must arrive as its own words.
 * OCRmyPDF's `--sidecar` writes `[OCR skipped on page 1]` for a page it kept, so
 * a sidecar can be non-empty and still hold none of that page's text.
 */
export async function mixedSidecarVerdict(
  bytes: Uint8Array,
): Promise<{ ok: boolean; detail: string }> {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const skipped = skippedSidecarPages(text);
  if (skipped.length > 0) {
    return {
      ok: false,
      detail: `the .txt holds OCRmyPDF's skip placeholder for page(s) ${skipped.join(", ")} instead of their text`,
    };
  }
  if (!text.includes(MIXED_TYPED_LINE)) {
    return {
      ok: false,
      detail: `the typed page's words are missing from the ${text.length}-character .txt`,
    };
  }
  return {
    ok: true,
    detail: `the typed page kept its own words (${text.length} characters)`,
  };
}

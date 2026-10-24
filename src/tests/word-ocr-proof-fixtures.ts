/**
 * PDF to Word's OCR deployment proof: a REAL scan (an image-only page of a
 * known sentence, no text layer) and the verdict that reads the DOCX for it.
 * Here rather than in `scripts/worker-prove-tools.ts` so both directions of
 * the verdict, and the fixture's own claim to be a scan, are tested.
 *
 * The scan is the typed sentence drawn by pdf.js — what a viewer paints —
 * rasterised and placed back as the page's only content. So it has no
 * selectable text at all (the export alone refuses it: `no_text`), and the
 * only way its words reach a DOCX is OCR reading the picture.
 */
import { PDFDocument } from "pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { encodePng } from "@/lib/pdf/extract-images";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import { readDocxParagraphs } from "@/lib/workers/pdf-office-export/docx-text";
import { renderPdfPages } from "./pdf-render";

/** The words printed on the scan, read back out of the DOCX. */
export const SCANNED_LINE = "Scanned invoice number 4718 paid in full";

const PAGE: [number, number] = [595, 842];

/** One A4 page, the sentence large and black on white, then rasterised. */
export async function scannedTextPdf(): Promise<Uint8Array> {
  const typed = await PDFDocument.create();
  const font = await embedDrawingFont(typed, [SCANNED_LINE]);
  typed.addPage(PAGE).drawText(SCANNED_LINE, { x: 40, y: 700, size: 26, font });
  // ~200 DPI on A4's long side: what a desk scanner's default produces.
  const [page] = await renderPdfPages(await typed.save(), 2339);
  if (!page) throw new Error("the typed page did not render");
  const gray = new Uint8Array(page.width * page.height);
  for (let i = 0; i < gray.length; i++) {
    const r = page.data[i * 4]!;
    const g = page.data[i * 4 + 1]!;
    const b = page.data[i * 4 + 2]!;
    const a = page.data[i * 4 + 3]! / 255;
    // Composite over white: a transparent canvas pixel is paper, not ink.
    gray[i] = Math.round(
      255 * (1 - a) + a * (0.299 * r + 0.587 * g + 0.114 * b),
    );
  }
  const scan = await PDFDocument.create();
  const img = await embedRasterImage(
    scan,
    encodePng(page.width, page.height, "gray8", gray),
    "png",
  );
  await drawRasterImage(scan.addPage(PAGE), img, {
    x: 0,
    y: 0,
    width: PAGE[0],
    height: PAGE[1],
  });
  return scan.save();
}

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * The DOCX carries the scan's words as TEXT. Every word of the sentence must
 * be there (OCR may break the line, not drop a word); a DOCX with the picture
 * alone has none of them.
 */
export async function scannedDocxVerdict(
  bytes: Uint8Array,
): Promise<{ ok: boolean; detail: string }> {
  let text: string;
  try {
    text = (await readDocxParagraphs(bytes)).join(" ");
  } catch {
    return { ok: false, detail: "the artifact is not a readable DOCX" };
  }
  const have = new Set(words(text));
  const missing = words(SCANNED_LINE).filter((w) => !have.has(w));
  return missing.length === 0
    ? {
        ok: true,
        detail: `every word of the scanned line is text in the DOCX (${text.length} characters)`,
      }
    : {
        ok: false,
        detail: `the DOCX is missing ${missing.length} of the scanned line's words (${missing.join(", ")}), out of ${text.length} characters of text`,
      };
}

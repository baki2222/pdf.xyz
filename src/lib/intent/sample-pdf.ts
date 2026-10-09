/**
 * A PDF to try the desk with, for a visitor who has no file to hand: built
 * in this tab with the same engine the tools use, so nothing is fetched and
 * nothing about it is staged. Three pages — text on the first two, a form
 * with two empty text fields on the third — so the ticket has real facts to
 * measure and say: pages counted, fields found.
 *
 * Loaded on demand (the "Try a sample PDF" button imports it), and it takes
 * pdf-lib through the one dynamic boundary, so a visitor who never presses
 * the button downloads neither. Its text goes through the font chooser like
 * every other page this codebase writes (`text-drawing-call-sites.test.ts`).
 */
import { loadPdfLib } from "@/lib/pdf/pdf-lib";
import {
  assertFormFieldTextDrawable,
  embedDrawingFont,
  formTextsDrawnOnRegeneration,
} from "@/lib/pdf/unicode-font";

/** The sample's file name — what the ticket's row shows. */
export const SAMPLE_PDF_NAME = "pdfxyz-sample.pdf";

/** The form fields the third page carries, by name and label. */
export const SAMPLE_FIELDS = [
  { name: "sample.name", label: "Name" },
  { name: "sample.date", label: "Date" },
] as const;

const PAGES = 3;
const SIZE: [number, number] = [612, 792];

/** Each page's lines, top to bottom. */
function linesFor(page: number): string[] {
  const head = `pdf.xyz sample · page ${page} of ${PAGES}`;
  switch (page) {
    case 1:
      return [
        head,
        "A sample document",
        "Made in this browser tab a moment ago, so the tools have",
        "something to work on. Every word on this page is real text.",
      ];
    case 2:
      return [
        head,
        "A second page of text",
        "Merge it, split it, rotate it, number it or sign it.",
      ];
    default:
      return [head, "A form with two fields", "Fill them in with Fill forms."];
  }
}

/** Build the sample. Never stored; the visitor's own copy is the download. */
export async function buildSamplePdf(): Promise<File> {
  const lib = await loadPdfLib();
  const { PDFDocument, rgb } = lib;
  const doc = await PDFDocument.create();
  doc.setTitle("pdf.xyz sample");
  doc.setProducer("pdf.xyz");
  doc.setCreator("pdf.xyz");

  const pages = Array.from({ length: PAGES }, (_, i) => linesFor(i + 1));
  const labels = SAMPLE_FIELDS.map((field) => field.label);
  const font = await embedDrawingFont(doc, [...pages.flat(), ...labels]);
  const ink = rgb(0.08, 0.1, 0.13);
  const muted = rgb(0.38, 0.42, 0.47);

  pages.forEach((lines, i) => {
    const page = doc.addPage(SIZE);
    const [head, title, ...body] = lines as [string, string, ...string[]];
    page.drawText(head, { x: 72, y: 720, size: 9, font, color: muted });
    page.drawText(title, { x: 72, y: 672, size: 24, font, color: ink });
    body.forEach((line, n) =>
      page.drawText(line, {
        x: 72,
        y: 632 - n * 18,
        size: 12,
        font,
        color: ink,
      }),
    );
    if (i === PAGES - 1) {
      const form = doc.getForm();
      SAMPLE_FIELDS.forEach((spec, n) => {
        const y = 560 - n * 56;
        page.drawText(spec.label, {
          x: 72,
          y: y + 30,
          size: 10,
          font,
          color: muted,
        });
        form.createTextField(spec.name).addToPage(page, {
          x: 72,
          y,
          width: 280,
          height: 24,
        });
      });
    }
  });

  // `save()` draws every field's appearance with the form's own font, like
  // every AcroForm writer here; the same check guards it (the fields are
  // empty, so it has nothing to refuse — and would say so in words if it did).
  assertFormFieldTextDrawable(
    formTextsDrawnOnRegeneration(doc.getForm().getFields(), lib),
  );
  const bytes = await doc.save();
  return new File([bytes as BlobPart], SAMPLE_PDF_NAME, {
    type: "application/pdf",
    lastModified: Date.now(),
  });
}

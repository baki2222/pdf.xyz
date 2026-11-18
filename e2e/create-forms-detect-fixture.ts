import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFPage,
} from "pdf-lib";

/**
 * Create Fillable Forms' Find fields (backlog #17, S2): the flat form the
 * e2e specs open, generated here with pdf-lib (never a downloaded file).
 *
 *  - page 1: three labelled lines ("Full name:", "Email:", "Phone:") and two
 *    small squares labelled to their right;
 *  - page 2: the same three labelled lines on a page turned `/Rotate 90`
 *    with an inset CropBox, so every suggestion there goes through the
 *    displayed-frame mapping;
 *  - page 3: NEGATIVES only: a full-width divider, a signature line, and an
 *    underlined heading. Find fields must suggest nothing on it.
 *
 * {@link PRINTED} is where each line and square is, in the frame a reader
 * sees (points from the displayed page's bottom-left), computed here from
 * the drawing and the turn, never read from the finder.
 */
export const LETTER: [number, number] = [612, 792];
export const PAGE2_CROP = { x: 36, y: 48, width: 540, height: 696 };
const SIZE = 12;
const LABELS = ["Full name:", "Email:", "Phone:"];
const YS = [650, 610, 570];
const RULE_END = 450;
const SQUARES = [
  { y: 500, label: "Contact me by email" },
  { y: 480, label: "Send the newsletter" },
];

export interface Printed {
  page: number;
  kind: "line" | "square";
  /** Displayed frame: a line's ends and height, or a square's box. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Where each printed line or square sits, in the displayed frame. */
export const PRINTED: Printed[] = [];

async function labelledLines(page: PDFPage, n: number) {
  const font = await page.doc.embedFont(StandardFonts.Helvetica);
  for (const [i, label] of LABELS.entries()) {
    const y = YS[i]!;
    page.drawText(label, { x: 72, y, size: SIZE, font, color: rgb(0, 0, 0) });
    const x0 = 72 + font.widthOfTextAtSize(label, SIZE) + 6;
    page.drawLine({
      start: { x: x0, y },
      end: { x: RULE_END, y },
      thickness: 0.75,
      color: rgb(0, 0, 0),
    });
    PRINTED.push(
      n === 1
        ? { page: 1, kind: "line", x0, x1: RULE_END, y0: y, y1: y }
        : turned({ page: 2, kind: "line", x0, x1: RULE_END, y0: y, y1: y }),
    );
  }
}

/**
 * A /Rotate 90 page's content point in the displayed frame: a clockwise
 * quarter turn of the crop box (displayed x = y - crop.y, displayed y =
 * crop.x + crop.width - x). Written out here, not read from the app.
 */
function turned(p: Printed): Printed {
  const c = PAGE2_CROP;
  return {
    ...p,
    x0: p.y0 - c.y,
    x1: p.y1 - c.y,
    y0: c.x + c.width - p.x1,
    y1: c.x + c.width - p.x0,
  };
}

export async function flatForm(): Promise<Buffer> {
  PRINTED.length = 0;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const one = doc.addPage(LETTER);
  await labelledLines(one, 1);
  for (const { y, label } of SQUARES) {
    one.drawRectangle({
      x: 72,
      y,
      width: 12,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    one.drawText(label, { x: 90, y: y + 2, size: 11, font });
    PRINTED.push({
      page: 1,
      kind: "square",
      x0: 72,
      x1: 84,
      y0: y,
      y1: y + 12,
    });
  }

  const two = doc.addPage(LETTER);
  two.setCropBox(
    PAGE2_CROP.x,
    PAGE2_CROP.y,
    PAGE2_CROP.width,
    PAGE2_CROP.height,
  );
  two.setRotation(degrees(90));
  await labelledLines(two, 2);

  // Page 3: nothing here is a field.
  const three = doc.addPage(LETTER);
  three.drawText("Terms and conditions", { x: 72, y: 720, size: 14, font });
  // An underline under that heading.
  three.drawLine({
    start: { x: 72, y: 717 },
    end: { x: 72 + font.widthOfTextAtSize("Terms and conditions", 14), y: 717 },
    thickness: 0.75,
  });
  // A divider across the page.
  three.drawLine({ start: { x: 20, y: 690 }, end: { x: 592, y: 690 } });
  three.drawText("By signing below you agree to the terms above.", {
    x: 72,
    y: 660,
    size: 11,
    font,
  });
  // A signature line: never suggested.
  three.drawText("Signature:", { x: 72, y: 600, size: SIZE, font });
  three.drawLine({
    start: { x: 72 + font.widthOfTextAtSize("Signature:", SIZE) + 6, y: 600 },
    end: { x: 400, y: 600 },
    thickness: 0.75,
  });

  return Buffer.from(await doc.save());
}

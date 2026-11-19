import {
  PDFDocument,
  StandardFonts,
  concatTransformationMatrix,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFPage,
} from "pdf-lib";

/**
 * Create Fillable Forms' Find fields (backlog #17, S2): the flat form the
 * e2e specs open, generated here with pdf-lib (never a downloaded file).
 *
 *  - page 1: three labelled lines ("Full name:", "Email:", "Phone:") and two
 *    small squares labelled to their right;
 *  - page 2: the same three labelled lines on a LANDSCAPE page made the
 *    common way (`/Rotate 90`, an inset CropBox, and the content counter-
 *    turned with `cm`), so the reader sees it upright and every suggestion
 *    there goes through the displayed-frame mapping;
 *  - page 3: NEGATIVES only: a full-width divider, a signature line, and an
 *    underlined heading. Find fields must suggest nothing on it;
 *  - page 4: the same labelled lines on a `/Rotate 90` page drawn upright
 *    in the FILE, so the reader sees them sideways. Find fields must
 *    suggest nothing there and say why (review round 7, 2026-11-19: until
 *    then page 2 was this page, and the spec counted its fields, whose typed
 *    text ran across the printed line, as a pass).
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
/** Page 2 shows 696 x 540: its lines sit lower. */
const YS2 = [450, 410, 370];
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

/** Labelled lines at `ys`, drawn in the page's current frame. */
async function labelledLines(
  page: PDFPage,
  ys: number[],
  printed: (line: Printed) => Printed | null,
) {
  const font = await page.doc.embedFont(StandardFonts.Helvetica);
  for (const [i, label] of LABELS.entries()) {
    const y = ys[i]!;
    page.drawText(label, { x: 72, y, size: SIZE, font, color: rgb(0, 0, 0) });
    const x0 = 72 + font.widthOfTextAtSize(label, SIZE) + 6;
    page.drawLine({
      start: { x: x0, y },
      end: { x: RULE_END, y },
      thickness: 0.75,
      color: rgb(0, 0, 0),
    });
    const at = printed({
      page: page.doc.getPageIndices().length,
      kind: "line",
      x0,
      x1: RULE_END,
      y0: y,
      y1: y,
    });
    if (at) PRINTED.push(at);
  }
}

/**
 * A /Rotate 90 page whose visible box is PAGE2_CROP, counter-turned so what
 * is drawn after this at (x, y) shows at displayed (x, y): content x =
 * crop.x + crop.width - y, content y = crop.y + x, and the viewer's
 * clockwise quarter turn (displayed x = content y - crop.y, displayed y =
 * crop.x + crop.width - content x) brings it back. Written out here, not
 * read from the app.
 */
function counterTurn(page: PDFPage) {
  const c = PAGE2_CROP;
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(0, 1, -1, 0, c.x + c.width, c.y),
  );
}

function turnedPage(doc: PDFDocument): PDFPage {
  const page = doc.addPage(LETTER);
  page.setCropBox(
    PAGE2_CROP.x,
    PAGE2_CROP.y,
    PAGE2_CROP.width,
    PAGE2_CROP.height,
  );
  page.setRotation(degrees(90));
  return page;
}

export async function flatForm(): Promise<Buffer> {
  PRINTED.length = 0;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const one = doc.addPage(LETTER);
  await labelledLines(one, YS, (p) => p);
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

  // Page 2: landscape, upright on screen; drawn coordinates are displayed.
  const two = turnedPage(doc);
  counterTurn(two);
  await labelledLines(two, YS2, (p) => p);
  two.pushOperators(popGraphicsState());

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

  // Page 4: upright in the file, sideways on screen. Nothing is printed
  // where a field belongs as the reader sees it, so nothing is PRINTED.
  const four = turnedPage(doc);
  await labelledLines(four, YS, () => null);

  return Buffer.from(await doc.save());
}

/**
 * A one-page form whose first labelled line sits right under the builder's
 * untouched starter card (x 72..272, y 700..724 on page 1, makeDraft), and
 * a second line well clear of it (review round 7's "starter card shadow").
 */
export async function starterShadowForm(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(LETTER);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [label, y] of [
    ["Full name:", 704],
    ["Email:", 600],
  ] as const) {
    page.drawText(label, { x: 72, y, size: SIZE, font, color: rgb(0, 0, 0) });
    page.drawLine({
      start: { x: 72 + font.widthOfTextAtSize(label, SIZE) + 6, y },
      end: { x: RULE_END, y },
      thickness: 0.75,
      color: rgb(0, 0, 0),
    });
  }
  return Buffer.from(await doc.save());
}

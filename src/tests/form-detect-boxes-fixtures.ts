import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { Box } from "@/lib/pdf/form-detect";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import type { DetectCase, Expect } from "./form-detect-fixtures";

/**
 * TEST ONLY. Slice S4's corpus cases (entry boxes and stacked lines), joined
 * onto DETECT_CASES by src/tests/form-detect-fixtures.ts so the corpus run
 * both ways (form-detect.corpus.test.ts) and the real reader
 * (form-detect.pdfjs.test.ts) discover them like every other case.
 *
 * Self-contained on purpose, as form-detect-precision-fixtures.ts is: the
 * main fixtures file imports this one, so this one imports only types from
 * it. Expected boxes are computed from what each case draws and from
 * numbers typed here (a 1 pt inset inside a box; a line's field from 1 pt
 * over its lowest rule to 1.4 em, clamped to 14..22, over its highest, cut
 * 1 pt under the caption's baseline), never read back from DETECT or
 * DETECT_BOXES. `multiline` is typed per case from the box's height
 * against max(36, 2.2 x the label's size), worked out by hand in each note.
 *
 * {@link PRINTED_BOXES} is where each case's entry box or stack is drawn
 * (page 1, PDF points, unturned pages), for the composed chain in
 * form-detect-boxes.test.ts: the saved widget must lie inside it.
 */

const LETTER: [number, number] = [612, 792];

const save = (d: PDFDocument) => d.save({ useObjectStreams: false });

/** Helvetica, measured and drawn by pdf-lib (the corpus's "sans"). */
let helvetica: PDFFont | undefined;
const measure = async () =>
  (helvetica ??= await (
    await PDFDocument.create()
  ).embedFont(StandardFonts.Helvetica));

/** pdf-lib's own width of `s` in Helvetica at `size`. */
export async function width(s: string, size: number): Promise<number> {
  return (await measure()).widthOfTextAtSize(s, size);
}

async function text(
  page: PDFPage,
  s: string,
  x: number,
  y: number,
  size = 10,
): Promise<void> {
  page.drawText(s, {
    x,
    y,
    size,
    font: await page.doc.embedFont(StandardFonts.Helvetica),
    color: rgb(0, 0, 0),
  });
}

function box(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  fill?: number,
): void {
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.75,
    ...(fill === undefined ? {} : { color: rgb(fill, fill, fill) }),
  });
}

function rule(page: PDFPage, x0: number, x1: number, y: number): void {
  page.drawLine({
    start: { x: x0, y },
    end: { x: x1, y },
    thickness: 0.75,
    color: rgb(0, 0, 0),
  });
}

function raw(page: PDFPage, content: string): void {
  const ctx = page.doc.context;
  page.node.addContentStream(ctx.register(ctx.stream(content)));
}

function rounded(x0: number, y0: number, x1: number, y1: number): Box {
  const x = Math.round(x0);
  const y = Math.round(y0);
  return { x, y, width: Math.round(x1) - x, height: Math.round(y1) - y };
}

/** The field filling a box drawn at (x, y), w x h: inset 1 pt. */
export function innerBox(x: number, y: number, w: number, h: number): Box {
  return rounded(x + 1, y + 1, x + w - 1, y + h - 1);
}

/** The field under a line from x0 to x1 at y, labelled in `size` text. */
function stripBox(x0: number, x1: number, y: number, size: number): Box {
  const bottom = y + 1;
  const h = Math.min(22, Math.max(14, 1.4 * size));
  return rounded(x0 + 1, bottom, x1 - 1, bottom + h);
}

const entry = (
  label: string,
  [x, y, w, h]: readonly number[],
  multiline: boolean,
): Expect => ({
  rule: "entry-box",
  type: "text",
  label,
  page: 1,
  box: innerBox(x!, y!, w!, h!),
  multiline,
});

/** A caption 4 pt over a box's top: its baseline (the corpus's P43 idiom). */
const over = ([, y, , h]: readonly number[]) => y! + h! + 4;

/* ------------------------------------------------------------------ *
 *  Geometry, shared with the composed chain
 * ------------------------------------------------------------------ */

/** [x, y, w, h] of each case's boxes. */
export const S4 = {
  P60: [72, 500, 400, 80],
  P61: [140, 600, 200, 20],
  P62: { remarks: [140, 600, 300, 35], details: [140, 520, 300, 36] },
  P63: { name: [140, 600, 300, 43], town: [140, 500, 300, 44] },
  P64: { four: [72, 600, 300, 50], closed: [72, 480, 300, 50] },
  /** Comments over three lines 20 pt apart, 72..540. */
  P65: { x0: 72, x1: 540, ys: [600, 620, 640], caption: 646 },
  P66: { x0: 125, x1: 450, ys: [600, 620, 640] },
  P67: [72, 40, 468, 60],
  P68: {
    narrow: [140, 650, 40, 20],
    wide: [31, 560, 550, 30],
    low: [140, 520, 200, 12],
    tall: [72, 360, 300, 120],
  },
  P69: {
    narrow: [140, 650, 39, 20],
    wide: [55, 560, 551, 30],
    low: [140, 520, 200, 11],
    tall: [72, 360, 300, 121],
  },
} as const;

/** Where each composed-chain case drew its box or stack (page 1). */
export const PRINTED_BOXES: Record<
  string,
  { x0: number; y0: number; x1: number; y1: number }[]
> = Object.fromEntries(
  Object.entries({
    P60: [S4.P60],
    P61: [S4.P61],
    P62: [S4.P62.remarks, S4.P62.details],
    P64: [S4.P64.four, S4.P64.closed],
    // The stack: from its lowest line up to the caption over its highest.
    P65: [[S4.P65.x0, 600, S4.P65.x1 - S4.P65.x0, S4.P65.caption - 600]],
  } as Record<string, (readonly number[])[]>).map(([id, boxes]) => [
    id,
    boxes.map(([x, y, w, h]) => ({
      x0: x!,
      y0: y!,
      x1: x! + w!,
      y1: y! + h!,
    })),
  ]),
);

/** A 1 x 1 grey PNG (the corpus's own). */
const PNG_1PX = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

/** A page with `draw` on it, saved. */
async function onePage(
  draw: (page: PDFPage, d: PDFDocument) => Promise<void> | void,
  size: [number, number] = LETTER,
): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  await draw(d.addPage(size), d);
  return save(d);
}

/** A label `s` ending `gap` pt left of x, its baseline at y. */
async function leftLabel(
  page: PDFPage,
  s: string,
  x: number,
  y: number,
  size = 10,
  gap = 12,
) {
  await text(page, s, x - gap - (await width(s, size)), y, size);
}

export const BOX_CASES: readonly DetectCase[] = [
  {
    id: "P60",
    kind: "positive",
    note: 'an empty 400 x 80 box captioned "Comments" just over its top: one field filling the box, multiline (80 >= max(36, 22))',
    build: () =>
      onePage(async (page) => {
        await text(page, "Comments", 72, over(S4.P60));
        const [x, y, w, h] = S4.P60;
        box(page, x, y, w, h);
      }),
    expect: [entry("Comments", S4.P60, true)],
  },
  {
    id: "P61",
    kind: "positive",
    note: 'an empty 200 x 20 box with "Reference:" beside it: a field filling the box, one line (20 < 36)',
    build: () =>
      onePage(async (page) => {
        const [x, y, w, h] = S4.P61;
        await leftLabel(page, "Reference:", x, y + 6);
        box(page, x, y, w, h);
      }),
    expect: [entry("Reference", S4.P61, false)],
  },
  {
    id: "P62",
    kind: "positive",
    note: "the multiline floor, both sides: a 35 pt box (one line) and a 36 pt box (multiline), each labelled beside it in 10 pt text (2.2 x 10 = 22 < 36)",
    build: () =>
      onePage(async (page) => {
        for (const [label, b] of [
          ["Remarks:", S4.P62.remarks],
          ["Details:", S4.P62.details],
        ] as const) {
          await leftLabel(page, label, b[0], b[1] + b[3] / 2 - 3.5);
          box(page, b[0], b[1], b[2], b[3]);
        }
      }),
    expect: [
      entry("Remarks", S4.P62.remarks, false),
      entry("Details", S4.P62.details, true),
    ],
  },
  {
    id: "P63",
    kind: "positive",
    note: "the multiline factor, both sides: 20 pt labels, so the line is 2.2 x 20 = 44 pt: a 43 pt box (one line) and a 44 pt box (multiline)",
    build: () =>
      onePage(async (page) => {
        for (const [label, b] of [
          ["Name:", S4.P63.name],
          ["Town:", S4.P63.town],
        ] as const) {
          await leftLabel(page, label, b[0], b[1] + 10, 20);
          box(page, b[0], b[1], b[2], b[3]);
        }
      }),
    expect: [
      entry("Name", S4.P63.name, false),
      entry("Town", S4.P63.town, true),
    ],
  },
  {
    id: "P64",
    kind: "positive",
    note: 'entry boxes drawn two other ways: four separate lines meeting at their corners ("Address"), and one closed m-l-l-l-h path ("Directions"): each a field filling its box, multiline (50 >= 36)',
    build: () =>
      onePage(async (page) => {
        const [x, y, w, h] = S4.P64.four;
        await text(page, "Address", x, over(S4.P64.four));
        rule(page, x, x + w, y);
        rule(page, x, x + w, y + h);
        page.drawLine({
          start: { x, y },
          end: { x, y: y + h },
          thickness: 0.75,
          color: rgb(0, 0, 0),
        });
        page.drawLine({
          start: { x: x + w, y },
          end: { x: x + w, y: y + h },
          thickness: 0.75,
          color: rgb(0, 0, 0),
        });
        const [cx, cy, cw, ch] = S4.P64.closed;
        await text(page, "Directions", cx, over(S4.P64.closed));
        raw(
          page,
          `q 0 G 0.75 w ${cx} ${cy} m ${cx + cw} ${cy} l ${cx + cw} ${cy + ch} l ${cx} ${cy + ch} l h S Q`,
        );
      }),
    expect: [
      entry("Address", S4.P64.four, true),
      entry("Directions", S4.P64.closed, true),
    ],
  },
  {
    id: "P65",
    kind: "positive",
    note: 'three equal blank lines 20 pt apart under the caption "Comments:": ONE multiline field from the lowest line up to under the caption',
    build: () =>
      onePage(async (page) => {
        const { x0, x1, ys, caption } = S4.P65;
        await text(page, "Comments:", x0, caption);
        for (const y of ys) rule(page, x0, x1, y);
      }),
    expect: [
      {
        rule: "labelled-rule",
        type: "text",
        label: "Comments",
        page: 1,
        // From 1 pt over the lowest line to 1.4 x 10 = 14 pt over 1 pt
        // over the highest (655), cut 1 pt under the caption (645).
        box: rounded(73, 601, 539, Math.min(640 + 1 + 14, 646 - 1)),
        multiline: true,
      },
    ],
  },
  {
    id: "P66",
    kind: "positive",
    note: 'the same three equal lines 20 pt apart, each labelled at its left ("Name:", "Address:", "City:"), under a heading 14 pt over the top line that the stack search would take as its caption: three one-line fields, no stack',
    build: () =>
      onePage(async (page) => {
        const { x0, x1, ys } = S4.P66;
        await text(page, "Your details", 72, 654, 12);
        for (const [i, label] of ["City:", "Address:", "Name:"].entries()) {
          await text(page, label, 72, ys[i]!);
          rule(page, x0, x1, ys[i]!);
        }
      }),
    expect: ["City", "Address", "Name"].map((label, i) => ({
      rule: "labelled-rule" as const,
      type: "text" as const,
      label,
      page: 1,
      // The top line's field is cut 1 pt under the heading's baseline.
      box:
        i === 2
          ? rounded(S4.P66.x0 + 1, 641, S4.P66.x1 - 1, 654 - 1)
          : stripBox(S4.P66.x0, S4.P66.x1, S4.P66.ys[i]!, 10),
    })),
  },
  {
    id: "P67",
    kind: "positive",
    note: 'an empty captioned box near the page foot ("Additional notes", bottom edge at 40 pt, in the bottom 8%, top at 100, above it): proposed, as only part of it is in the band',
    build: () =>
      onePage(async (page) => {
        const [x, y, w, h] = S4.P67;
        await text(page, "Additional notes", x, over(S4.P67));
        box(page, x, y, w, h);
      }),
    expect: [entry("Additional notes", S4.P67, true)],
  },
  {
    id: "P68",
    kind: "positive",
    note: "entry boxes at each size bound, inside it: 40 pt wide, 550 pt wide (0.9 x 612 = 550.8), 12 pt tall and 120 pt tall (multiline): each a field filling its box",
    build: () =>
      onePage(async (page) => {
        const { narrow, wide, low, tall } = S4.P68;
        await leftLabel(page, "Age:", narrow[0], narrow[1] + 6);
        box(page, narrow[0], narrow[1], narrow[2], narrow[3]);
        await text(page, "Full address", wide[0], over(wide));
        box(page, wide[0], wide[1], wide[2], wide[3]);
        await leftLabel(page, "Code:", low[0], low[1] + 2);
        box(page, low[0], low[1], low[2], low[3]);
        await text(page, "Description", tall[0], over(tall));
        box(page, tall[0], tall[1], tall[2], tall[3]);
      }),
    expect: [
      entry("Age", S4.P68.narrow, false),
      entry("Full address", S4.P68.wide, false),
      entry("Code", S4.P68.low, false),
      entry("Description", S4.P68.tall, true),
    ],
  },
  {
    id: "P69",
    kind: "positive",
    note: "the same boxes just past each bound (39 wide, 551 wide, 11 tall, 121 tall): no entry box, so each keeps the field along its bottom edge it had before slice S4",
    build: () =>
      onePage(async (page) => {
        const { narrow, wide, low, tall } = S4.P69;
        await leftLabel(page, "Age:", narrow[0], narrow[1] + 6);
        box(page, narrow[0], narrow[1], narrow[2], narrow[3]);
        // Wider than 0.85 of the page, so labelled at its LEFT: a caption
        // alone would make its bottom edge a full-width divider.
        await leftLabel(page, "No.", wide[0], wide[1] + 10, 10, 6);
        box(page, wide[0], wide[1], wide[2], wide[3]);
        await leftLabel(page, "Code:", low[0], low[1] + 2);
        box(page, low[0], low[1], low[2], low[3]);
        await text(page, "Description", tall[0], over(tall));
        box(page, tall[0], tall[1], tall[2], tall[3]);
      }),
    expect: (
      [
        ["Age", S4.P69.narrow],
        ["No", S4.P69.wide],
        ["Code", S4.P69.low],
        ["Description", S4.P69.tall],
      ] as const
    ).map(([label, [x, y, w]]) => ({
      rule: "labelled-rule" as const,
      type: "text" as const,
      label,
      page: 1,
      box: stripBox(x, x + w, y, 10),
    })),
  },
  {
    id: "N58",
    kind: "negative",
    note: 'a boxed paragraph captioned "Notes": three lines of text inside the box, so no field',
    build: () =>
      onePage(async (page) => {
        await text(page, "Notes", 72, 564);
        box(page, 72, 500, 468, 60);
        for (const [i, s] of [
          "Deliveries are made on weekdays between nine and five.",
          "Please allow three working days for your order to arrive.",
          "Returns are accepted within thirty days of delivery.",
        ].entries())
          await text(page, s, 78, 545 - 15 * i);
      }),
    expect: "none",
    decidedBy: "unlabelled",
    at: { page: 1, x: 300, y: 503 },
    seamAlsoDisable: ["overlaps-text", "no-clearance"],
  },
  {
    id: "N59",
    kind: "negative",
    note: "a framed heading: a 24 pt box drawn tight round one heading line: no field",
    build: () =>
      onePage(async (page) => {
        box(page, 72, 700, 300, 24);
        await text(page, "Section 2: Your details", 78, 707, 14);
      }),
    expect: "none",
    decidedBy: "unlabelled",
    at: { page: 1, x: 300, y: 702 },
    seamAlsoDisable: ["overlaps-text", "no-clearance"],
  },
  {
    id: "N60",
    kind: "negative",
    note: "a page border 20 pt in from every edge (572 wide, over 0.9 of the page) round a title: no field",
    build: () =>
      onePage(async (page) => {
        box(page, 20, 20, 572, 752);
        await text(page, "Application form", 72, 740, 16);
      }),
    expect: "none",
    decidedBy: "full-width-divider",
    at: { page: 1, x: 300, y: 22 },
    seamAlsoDisable: ["unlabelled", "page-band"],
  },
  {
    id: "N61",
    kind: "negative",
    note: 'an empty grid of 3 x 3 cells drawn as separate boxes under the heading "Schedule": no field (a table: slice S5)',
    build: () =>
      onePage(async (page) => {
        await text(page, "Schedule", 72, 664);
        for (let r = 0; r < 3; r++)
          for (let k = 0; k < 3; k++)
            box(page, 72 + 100 * k, 600 + 20 * r, 100, 20);
      }),
    expect: "none",
    decidedBy: "table-grid",
    at: { page: 1, x: 150, y: 602 },
    seamAlsoDisable: ["unlabelled"],
  },
  {
    id: "N62",
    kind: "negative",
    note: 'a box captioned "Payment" that holds an unlabelled checkbox square: not an empty box, so no field',
    build: () =>
      onePage(async (page) => {
        await text(page, "Payment", 72, 644);
        box(page, 72, 600, 300, 40);
        box(page, 80, 615, 10, 10);
      }),
    expect: "none",
    decidedBy: "filled-box",
    at: { page: 1, x: 300, y: 605 },
  },
  {
    id: "N63",
    kind: "negative",
    note: 'a box captioned "Account number" that holds a comb of six character boxes: no field for the box (and none for the comb)',
    build: () =>
      onePage(async (page) => {
        await text(page, "Account number", 72, 644);
        box(page, 72, 600, 300, 40);
        for (let k = 0; k < 6; k++) box(page, 80 + 14 * k, 613, 14, 14);
      }),
    expect: "none",
    decidedBy: "filled-box",
    at: { page: 1, x: 300, y: 605 },
  },
  {
    id: "N64",
    kind: "negative",
    note: 'an image frame: a 120 x 120 box captioned "Photo" with a picture painted inside it: no field',
    build: () =>
      onePage(async (page, d) => {
        await text(page, "Photo", 72, 724);
        box(page, 72, 600, 120, 120);
        const img = await embedRasterImage(d, PNG_1PX, "png");
        await drawRasterImage(page, img, {
          x: 74,
          y: 602,
          width: 116,
          height: 116,
        });
      }),
    expect: "none",
    decidedBy: "filled-box",
    at: { page: 1, x: 100, y: 605 },
  },
  {
    id: "N65",
    kind: "negative",
    note: 'a grey shaded box (fill 0.85) with a black outline, captioned "Notes": no field',
    build: () =>
      onePage(async (page) => {
        await text(page, "Notes", 72, 644);
        box(page, 72, 600, 300, 40, 0.85);
      }),
    expect: "none",
    decidedBy: "filled-box",
    at: { page: 1, x: 300, y: 605 },
  },
  {
    id: "N66",
    kind: "negative",
    note: 'an empty box labelled "Notes:" whose bottom edge a line of text crosses (its baseline 3 pt under the box, its letters reaching into it): no field',
    build: () =>
      onePage(async (page) => {
        await leftLabel(page, "Notes:", 140, 612);
        box(page, 140, 600, 200, 30);
        await text(page, "Continued from the previous page", 150, 597, 12);
      }),
    expect: "none",
    decidedBy: "overlaps-text",
    at: { page: 1, x: 300, y: 615 },
  },
  {
    id: "N67",
    kind: "negative",
    note: 'only TWO equal blank lines 20 pt apart under "Comments:": two lines show no pitch, so no stack, and each line is unlabelled',
    build: () =>
      onePage(async (page) => {
        await text(page, "Comments:", 72, 626);
        for (const y of [600, 620]) rule(page, 72, 540, y);
      }),
    expect: "none",
    decidedBy: "unlabelled",
    at: { page: 1, x: 300, y: 602 },
  },
  {
    id: "N68",
    kind: "negative",
    note: 'three equal blank lines 30 pt apart (the pitch bound, not under it) under "Comments:": no stack, each line unlabelled',
    build: () =>
      onePage(async (page) => {
        await text(page, "Comments:", 72, 666);
        for (const y of [600, 630, 660]) rule(page, 72, 540, y);
      }),
    expect: "none",
    decidedBy: "unlabelled",
    at: { page: 1, x: 300, y: 602 },
  },
  {
    id: "N69",
    kind: "negative",
    note: 'an empty box captioned "Notes" wholly in the bottom 8% of the page (10 to 50 pt up): a footer, no field',
    build: () =>
      onePage(async (page) => {
        await text(page, "Notes", 72, 54);
        box(page, 72, 10, 300, 40);
      }),
    expect: "none",
    decidedBy: "page-band",
    at: { page: 1, x: 200, y: 20 },
  },
];

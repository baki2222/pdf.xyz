// @native-canvas
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";
import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import { extractedTextToMarkdown } from "./pdf-to-markdown";
import { loadPdfjs } from "./pdfjs";
import {
  extractPdfLines,
  extractPdfText,
  MAX_ORDERED_BLOCKS,
  normalizeExtractedText,
  pdfHasSelectableText,
  textItemsToPlainText,
  type ExtractedPdfText,
} from "./text";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;

/**
 * PDF to Text returns a page's text in READING order, not in the order its
 * content stream happens to draw it.
 *
 * pdfjs hands over text items in content-stream order. Generators draw out of
 * visual order constantly — a title placed after the body, a running header
 * written last, a footer written first — and the TXT came out fluent,
 * complete and in the wrong order, with nothing to warn. The same file read
 * correctly through the worker's `pdftotext -layout`.
 *
 * The fix must NOT be a global sort by y then x: a two-column page is drawn a
 * column at a time, stream order is already right for it, and a y-sort would
 * interleave the columns line by line. So both directions are pinned here:
 * out-of-order pages are put right, and pages whose stream order is already
 * the reading order come out byte-identical to stream order.
 *
 * Every fixture is a real PDF read through EVERY route a page's text takes to
 * a user ({@link ROUTES}): `extractPdfText` (PDF to Text, Compare, and the
 * summarize, translate and chat clients) and `extractPdfLines` into
 * `extractedTextToMarkdown` (PDF to Markdown), whose lines and Markdown must
 * read in the same order as the text. Which routes exist is not typed here:
 * "every consumer reads through a route" walks the importers of `./text`.
 *
 * CHANGED 2026-10-06 (history kept): this sentence used to say every fixture
 * went through "the extractor PDF to Text, PDF to Markdown, Compare and the
 * translate panel all call" while it called `extractPdfText` alone. PDF to
 * Markdown had moved to `extractPdfLines`, whose `lines` were still in
 * content-stream order, and its Markdown put "Second paragraph of body."
 * before "## Document Title" while every test here was green.
 */

interface Line {
  text: string;
  x: number;
  y: number;
  size?: number;
  rotate?: number;
}

interface Fixture {
  /** Lines in DRAW (content-stream) order. */
  draw: Line[];
  /** The same lines' texts in reading order. */
  read: string[];
}

const col = (prefix: string, x: number, top: number, n: number): Line[] =>
  Array.from({ length: n }, (_, i) => ({
    text: `${prefix} line ${i + 1}`,
    x,
    y: top - i * 14,
  }));

const texts = (lines: Line[]) => lines.map((line) => line.text);

const LEFT = col("Left column", 72, 700, 4);
const RIGHT = col("Right column", 330, 700, 4);
const RIGHT_LOW = col("Right column", 330, 680, 4);
const FOOTNOTE =
  "1. A footnote set the full width of the page, well into the right column.";
const PROSE = [
  ...col("Opening paragraph", 72, 700, 3),
  ...col("Middle paragraph", 72, 640, 3),
  ...col("Closing paragraph", 72, 580, 3),
];

/**
 * Two columns whose lines FILL their width (72–297 and 320–552 at 10 pt), so
 * a page number under either one overlaps it — the narrow LEFT/RIGHT above
 * leave most of the page empty, which is how a footer drawn first slipped
 * past every fixture. `the page furniture is where it claims` measures it.
 */
const wideCol = (
  side: "Left" | "Right",
  x: number,
  top: number,
  n: number,
  { from = 1, lead = 14 }: { from?: number; lead?: number } = {},
) =>
  Array.from({ length: n }, (_, i) => ({
    text: `${side} column line ${from + i} set wide enough to fill its column`,
    x,
    y: top - i * lead,
    size: 10,
  }));
const WIDE_LEFT = wideCol("Left", 72, 700, 4);
const WIDE_RIGHT = wideCol("Right", 320, 700, 4);
const WIDE = [...WIDE_LEFT, ...WIDE_RIGHT];

type Column = "left" | "right";

/**
 * Running headers and footers — page FURNITURE. Generators emit it outside
 * the body's flow: a footer or page number is often drawn FIRST, a running
 * header LAST. `spans` is which of the WIDE columns it overlaps horizontally;
 * the health check below measures that from the PDF rather than trusting it.
 */
interface Furniture {
  kind: "header" | "footer";
  line: Line;
  spans: Column[];
}

const FURNITURE: Record<string, Furniture> = {
  "a page number under the right column": {
    kind: "footer",
    line: { text: "Page 3", x: 509, y: 24, size: 10 },
    spans: ["right"],
  },
  "a page number under the left column": {
    kind: "footer",
    line: { text: "Page 3", x: 72, y: 24, size: 10 },
    spans: ["left"],
  },
  "a page number centred in the gutter": {
    kind: "footer",
    line: { text: "3", x: 306, y: 24, size: 10 },
    spans: [],
  },
  "a footer across both columns": {
    kind: "footer",
    line: {
      text: "Quarterly Report - Confidential - Printed for internal circulation only",
      x: 72,
      y: 24,
      size: 10,
    },
    spans: ["left", "right"],
  },
  "a running header across both columns": {
    kind: "header",
    line: {
      text: "Internal Circulation Only - Quarterly Operating Report - Draft",
      x: 72,
      y: 775,
      size: 10,
    },
    spans: ["left", "right"],
  },
  "a running header over the right column": {
    kind: "header",
    line: { text: "Annual Review 2026", x: 450, y: 775, size: 10 },
    spans: ["right"],
  },
};

/**
 * Furniture drawn where it does NOT read — a footer first, a header last —
 * over two full columns drawn a column at a time. Kept clear of the y the
 * composition matrix below puts its own furniture at, so the two compose.
 */
const MISPLACED_FURNITURE: Record<string, Fixture> = Object.fromEntries(
  Object.entries(FURNITURE).map(([name, { kind, line }]) => {
    const own = { ...line, y: kind === "footer" ? 40 : 760 };
    return kind === "footer"
      ? [
          `${name}, drawn first, below two full columns`,
          { draw: [own, ...WIDE], read: [...texts(WIDE), own.text] },
        ]
      : [
          `${name}, drawn last, above two full columns`,
          { draw: [...WIDE, own], read: [own.text, ...texts(WIDE)] },
        ];
  }),
);

/** `n` lines of `size` pt set `lead` apart, numbered from `from`. */
const bodyCol = (
  side: "Left" | "Right",
  x: number,
  top: number,
  n: number,
  { size, lead, from = 1 }: { size: number; lead: number; from?: number },
): Line[] =>
  Array.from({ length: n }, (_, i) => ({
    text: `${side} body line ${from + i}`,
    x,
    y: top - i * lead,
    size,
  }));

/**
 * Two columns, each under a 14 pt heading set a line above 10 pt body text,
 * the right heading drawn after its body. ADDED 2026-10-08, from the second
 * review of 9681f501, which read it `Left Heading | Right Heading | LB | RB`:
 * the size rule makes each heading its own block, and the two headings, one
 * drawn first and one last, are one row of single lines — so the band rule
 * for a running head in pieces lifted the right heading over the left
 * column's body. 028d3a10 read it right. With 10 pt headings each heading
 * joins its body and every version reads it right.
 */
const HEADED_LEFT: Line = { text: "Left Heading", x: 72, y: 714, size: 14 };
const HEADED_LEFT_BODY = bodyCol("Left", 72, 690, 8, { size: 10, lead: 12 });
const HEADED_RIGHT_BODY = bodyCol("Right", 330, 690, 8, { size: 10, lead: 12 });
const HEADED_RIGHT: Line = { text: "Right Heading", x: 330, y: 714, size: 14 };

/** Pages whose stream order is WRONG — the defect. */
const OUT_OF_ORDER: Record<string, Fixture> = {
  ...MISPLACED_FURNITURE,
  "title drawn after the body it heads": {
    draw: [
      { text: "Second paragraph of body.", x: 72, y: 600 },
      { text: "Document Title", x: 72, y: 720, size: 20 },
      { text: "First paragraph of body.", x: 72, y: 660 },
      { text: "It continues on a second line.", x: 72, y: 646 },
    ],
    read: [
      "Document Title",
      "First paragraph of body.",
      "It continues on a second line.",
      "Second paragraph of body.",
    ],
  },
  "running header drawn last, above two columns": {
    draw: [
      ...LEFT,
      ...RIGHT,
      { text: "Quarterly Report Header", x: 72, y: 750, size: 16 },
    ],
    read: ["Quarterly Report Header", ...texts(LEFT), ...texts(RIGHT)],
  },
  "footer drawn first, below the body": {
    draw: [{ text: "Page 1 of 1", x: 72, y: 40 }, ...PROSE],
    read: [...texts(PROSE), "Page 1 of 1"],
  },
  "a column's heading drawn after its body, beside another column": {
    draw: [
      ...LEFT,
      ...RIGHT_LOW,
      { text: "Right Heading", x: 330, y: 700, size: 14 },
    ],
    read: [...texts(LEFT), "Right Heading", ...texts(RIGHT_LOW)],
  },
  "two columns under 14 pt headings, the right heading drawn after its body": {
    draw: [
      HEADED_LEFT,
      ...HEADED_LEFT_BODY,
      ...HEADED_RIGHT_BODY,
      HEADED_RIGHT,
    ],
    read: [
      HEADED_LEFT.text,
      ...texts(HEADED_LEFT_BODY),
      HEADED_RIGHT.text,
      ...texts(HEADED_RIGHT_BODY),
    ],
  },
};

/**
 * Two-column pages drawn a column at a time — so stream order is already
 * right — where the LEFT column starts LOWER than the right one (a figure or
 * photo over it), and the right column has a gap (a figure, a pull quote)
 * above where the left one starts. The right column's first section then lies
 * wholly above everything else and is drawn as one unbroken run: the shape
 * that let a band cut lift a later column over an earlier one (485db77 put
 * `R1 | L | R2`). Common in IEEE/ACM papers and magazines.
 */
interface ColumnPage {
  /** Lines in DRAW order; each line is in `left` or `right`, or neither. */
  draw: Line[];
  left: Line[];
  right: Line[];
}

const STAGGER_LEFT = wideCol("Left", 72, 500, 36, { lead: 12 });
const STAGGER_RIGHT_UPPER = wideCol("Right", 320, 700, 11, { lead: 12 });
const STAGGER_RIGHT_LOWER = wideCol("Right", 320, 380, 26, {
  from: 12,
  lead: 12,
});
const FIG_1: Line = {
  text: "Fig. 1. The figure over the left column",
  x: 72,
  y: 515,
  size: 10,
};
const FIG_2: Line = {
  text: "Fig. 2. The figure between the right column's sections",
  x: 320,
  y: 395,
  size: 10,
};
const MINI_LEFT = wideCol("Left", 72, 500, 8);
const MINI_RIGHT_UPPER = wideCol("Right", 320, 700, 4);
const MINI_RIGHT_LOWER = wideCol("Right", 320, 600, 10, { from: 5 });
const MAG_LEFT = wideCol("Left", 72, 430, 20);
const MAG_RIGHT_UPPER = wideCol("Right", 320, 700, 8);
const MAG_QUOTE: Line[] = [
  { text: "A pull quote set large", x: 320, y: 550, size: 16 },
  { text: "between the two sections", x: 320, y: 530, size: 16 },
];
const MAG_RIGHT_LOWER = wideCol("Right", 320, 480, 23, { from: 9 });

const STAGGERED: Record<string, ColumnPage> = {
  "IEEE staggered figures: left text from y=500, right column split by a figure":
    {
      draw: [
        FIG_1,
        ...STAGGER_LEFT,
        ...STAGGER_RIGHT_UPPER,
        FIG_2,
        ...STAGGER_RIGHT_LOWER,
      ],
      left: [FIG_1, ...STAGGER_LEFT],
      right: [...STAGGER_RIGHT_UPPER, FIG_2, ...STAGGER_RIGHT_LOWER],
    },
  "a left column starting lower beside a right column in two sections": {
    draw: [...MINI_LEFT, ...MINI_RIGHT_UPPER, ...MINI_RIGHT_LOWER],
    left: MINI_LEFT,
    right: [...MINI_RIGHT_UPPER, ...MINI_RIGHT_LOWER],
  },
  "magazine: a photo over the left column, a pull quote in the right": {
    draw: [...MAG_LEFT, ...MAG_RIGHT_UPPER, ...MAG_QUOTE, ...MAG_RIGHT_LOWER],
    left: MAG_LEFT,
    right: [...MAG_RIGHT_UPPER, ...MAG_QUOTE, ...MAG_RIGHT_LOWER],
  },
};

/**
 * Pages already in order whose blocks invite a band cut that is not there.
 * ADDED 2026-10-08, from a review that ran these through `extractPdfText` at
 * f4f53fd6 and at 028d3a10: the base read each in stream order, and f4f53fd6
 * scrambled every one. Its two new band rules — an upper side drawn "at the
 * ends" in a SPLIT (some first, the rest last), and a middle run "over single
 * lines" — had been measured over 2,400 compositions none of which had a left
 * column with more than one block below where the right column ends, or
 * columns made of one-line blocks. Both rules exist for page FURNITURE: a
 * running head or footer in pieces on one baseline.
 *
 *  - The last page of a two-column paper: a long left column whose lower part
 *    starts below where a short right column ends, split by a 13 pt section
 *    heading at normal spacing (the size rule makes the heading its own
 *    block) or by a paragraph gap over two line heights. HEAD read
 *    `Left A | Right | heading | Left B`, splicing the right column into the
 *    middle of the left.
 *  - A form: two columns of single lines spaced over two line heights apart,
 *    the right one starting a line higher. HEAD read `R1 | L1 | R2 | L2 …`.
 *  - A résumé: label (13 pt) over value (9 pt) in two columns, the right one
 *    starting a line higher. HEAD lifted `Right Heading 1` over the left.
 *  - ADDED 2026-10-08, second review: a left column of one caption beside a
 *    right column ending on its baseline (LONE_CAPTION, below). 9681f501,
 *    which narrowed both rules to "one row of single lines", still lifted the
 *    right column over it: a caption and a footnote are one row too.
 */
const LAST_PAGE_LEFT_A = wideCol("Left", 72, 700, 20, { lead: 12 });
const LAST_PAGE_RIGHT = wideCol("Right", 320, 700, 12, { lead: 12 });
const LAST_PAGE_HEADING: Line = {
  text: "4. Conclusion",
  x: 72,
  y: 454,
  size: 13,
};
const LAST_PAGE_LEFT_B = wideCol("Left", 72, 436, 8, { from: 21, lead: 12 });
const LAST_PAGE_LEFT_B_GAP = wideCol("Left", 72, 430, 8, {
  from: 21,
  lead: 12,
});

const formColumn = (side: "Left" | "Right", x: number, top: number) =>
  Array.from({ length: 6 }, (_, i) => ({
    text: `${side} field ${i + 1}: ________`,
    x,
    y: top - i * 40,
    size: 10,
  }));
const FORM_LEFT = formColumn("Left", 72, 700);
const FORM_RIGHT = formColumn("Right", 320, 712);

const resumeColumn = (side: "Left" | "Right", x: number, top: number) =>
  Array.from({ length: 5 }, (_, i) => [
    { text: `${side} Heading ${i + 1}`, x, y: top - i * 40, size: 13 },
    { text: `${side} value ${i + 1}`, x, y: top - i * 40 - 15, size: 9 },
  ]).flat();
const RESUME_LEFT = resumeColumn("Left", 72, 700);
const RESUME_RIGHT = resumeColumn("Right", 320, 713);

/**
 * A left column holding only a figure's one-line 9 pt caption at its foot,
 * beside a full right column whose last line sits on the caption's baseline:
 * an 8 pt footnote set a line under the column, or the column's own last line
 * after a paragraph gap. ADDED 2026-10-08, from the second review of
 * 9681f501, which read them `R | caption | footnote` and `R1 | caption | R2`:
 * the right column is a run in the MIDDLE of the stream, and the caption with
 * the footnote (or the last line) is one row of single lines — so the band
 * rule for a footer in pieces lifted the right column over the left. 028d3a10
 * read both in stream order.
 */
const LONE_CAPTION: Line = {
  text: "Fig. 3. A figure over the left column",
  x: 72,
  y: 100,
  size: 9,
};
const CAPTIONED_RIGHT = bodyCol("Right", 330, 700, 40, { size: 12, lead: 15 });
const CAPTIONED_FOOTNOTE: Line = {
  text: "1. A footnote at the foot of the right column.",
  x: 330,
  y: 100,
  size: 8,
};
const GAPPED_RIGHT = bodyCol("Right", 330, 700, 38, { size: 12, lead: 15 });
const GAPPED_RIGHT_LAST: Line = {
  text: "Right body line 39",
  x: 330,
  y: 100,
  size: 12,
};

const NO_CUT_THERE: Record<string, Fixture> = {
  "last page of a two-column paper: the left column's lower part, under a 13 pt heading, starts below the right column's end":
    {
      draw: [
        ...LAST_PAGE_LEFT_A,
        LAST_PAGE_HEADING,
        ...LAST_PAGE_LEFT_B,
        ...LAST_PAGE_RIGHT,
      ],
      read: [
        ...texts(LAST_PAGE_LEFT_A),
        LAST_PAGE_HEADING.text,
        ...texts(LAST_PAGE_LEFT_B),
        ...texts(LAST_PAGE_RIGHT),
      ],
    },
  "last page of a two-column paper: the left column's lower paragraph, after a gap over two lines, starts below the right column's end":
    {
      draw: [...LAST_PAGE_LEFT_A, ...LAST_PAGE_LEFT_B_GAP, ...LAST_PAGE_RIGHT],
      read: [
        ...texts(LAST_PAGE_LEFT_A),
        ...texts(LAST_PAGE_LEFT_B_GAP),
        ...texts(LAST_PAGE_RIGHT),
      ],
    },
  "a form: two columns of spaced single lines, the right starting a line higher":
    {
      draw: [...FORM_LEFT, ...FORM_RIGHT],
      read: [...texts(FORM_LEFT), ...texts(FORM_RIGHT)],
    },
  "a résumé: 13 pt labels over 9 pt values in two columns, the right starting a line higher":
    {
      draw: [...RESUME_LEFT, ...RESUME_RIGHT],
      read: [...texts(RESUME_LEFT), ...texts(RESUME_RIGHT)],
    },
  "a left column of one 9 pt caption, beside a right column whose 8 pt footnote sits on the caption's baseline":
    {
      draw: [LONE_CAPTION, ...CAPTIONED_RIGHT, CAPTIONED_FOOTNOTE],
      read: [
        LONE_CAPTION.text,
        ...texts(CAPTIONED_RIGHT),
        CAPTIONED_FOOTNOTE.text,
      ],
    },
  "a left column of one 9 pt caption, beside a right column whose last line, after a paragraph gap, sits on the caption's baseline":
    {
      draw: [LONE_CAPTION, ...GAPPED_RIGHT, GAPPED_RIGHT_LAST],
      read: [LONE_CAPTION.text, ...texts(GAPPED_RIGHT), GAPPED_RIGHT_LAST.text],
    },
};

/** Pages whose stream order is ALREADY the reading order — the controls. */
const IN_ORDER: Record<string, Fixture> = {
  ...NO_CUT_THERE,
  ...Object.fromEntries(
    Object.entries(STAGGERED).map(([name, page]) => [
      name,
      { draw: page.draw, read: texts(page.draw) },
    ]),
  ),
  "two columns drawn a column at a time": {
    draw: [...LEFT, ...RIGHT],
    read: [...texts(LEFT), ...texts(RIGHT)],
  },
  "two full columns drawn a column at a time": {
    draw: WIDE,
    read: texts(WIDE),
  },
  "single-column prose": { draw: PROSE, read: texts(PROSE) },
  // The left column in two sections, the lower one followed at once by a
  // full-width footnote, which joins its block and so spans both columns.
  // Jumping the right column's first section above that block would
  // interleave the columns.
  "sectioned columns with a full-width footnote after the left one": {
    draw: [
      ...col("Left upper", 72, 700, 3),
      ...col("Left lower", 72, 600, 3),
      { text: FOOTNOTE, x: 72, y: 555 },
      ...col("Right upper", 330, 700, 3),
      ...col("Right lower", 330, 600, 3),
    ],
    read: [
      ...texts(col("Left upper", 72, 700, 3)),
      ...texts(col("Left lower", 72, 600, 3)),
      FOOTNOTE,
      ...texts(col("Right upper", 330, 700, 3)),
      ...texts(col("Right lower", 330, 600, 3)),
    ],
  },
  "title, then two columns": {
    draw: [{ text: "Paper Title", x: 72, y: 750, size: 18 }, ...LEFT, ...RIGHT],
    read: ["Paper Title", ...texts(LEFT), ...texts(RIGHT)],
  },
};

async function pdfOf(fixture: Fixture): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  for (const line of fixture.draw) {
    page.drawText(line.text, {
      x: line.x,
      y: line.y,
      size: line.size ?? 12,
      font,
      ...(line.rotate ? { rotate: degrees(line.rotate) } : {}),
    });
  }
  return doc.save();
}

interface ReadItem {
  str: string;
  hasEOL: boolean;
  transform: number[];
  width: number;
}

/** Page 1's text items exactly as pdfjs hands them over, in stream order. */
async function pageItems(bytes: Uint8Array): Promise<ReadItem[]> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const content = await page.getTextContent({ includeMarkedContent: false });
    return content.items.flatMap((item) => ("str" in item ? [item] : []));
  } finally {
    await task.destroy();
  }
}

/** The text in pure content-stream order — what the extractor used to return. */
async function streamOrderText(bytes: Uint8Array): Promise<string> {
  let text = "";
  for (const item of await pageItems(bytes)) {
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return normalizeExtractedText(text);
}

/** Horizontal extent of the drawn items whose text passes `match`. */
async function extentOf(
  bytes: Uint8Array,
  match: (text: string) => boolean,
): Promise<{ left: number; right: number }> {
  const hits = (await pageItems(bytes)).filter((item) => match(item.str));
  expect(hits.length, "extentOf matched no item").toBeGreaterThan(0);
  return {
    left: Math.min(...hits.map((item) => item.transform[4]!)),
    right: Math.max(...hits.map((item) => item.transform[4]! + item.width)),
  };
}

const overlap = (
  a: { left: number; right: number },
  b: { left: number; right: number },
) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0;

/**
 * `furniture` put where it reads (natural) or where generators misplace it
 * (inverted: a footer drawn FIRST, a header drawn LAST) on `body`.
 */
function compose(
  body: Fixture,
  { kind, line }: Furniture,
  placement: "natural" | "inverted",
): Fixture {
  const before = (kind === "header") === (placement === "natural");
  return {
    draw: before ? [line, ...body.draw] : [...body.draw, line],
    read:
      kind === "header" ? [line.text, ...body.read] : [...body.read, line.text],
  };
}

const linesOf = (text: string) => text.split("\n").filter((l) => l.trim());

/**
 * Every character but line breaks, sorted: reordering may move text and the
 * breaks between it, never add or drop anything else — not even a space,
 * which is what `parse.ts` and `translate-limits.ts` rely on when they say
 * this extractor cannot emit a space that is not inside a text item.
 */
const inventory = (text: string) =>
  [...text.replace(/\n/g, "")].sort().join("");

/** One reading of a page as a route delivers it. */
interface Reading {
  via: string;
  /** The visible lines, in order — `null` where the route merges lines. */
  lines: string[] | null;
  /** Every word in order, whitespace collapsed to one space. */
  words: string;
}

const wordsOf = (parts: string[]) =>
  parts.join(" ").replace(/\s+/g, " ").trim();

/** Markdown's words, without the `#` heading markers the converter adds. */
const markdownWords = (markdown: string) =>
  wordsOf(
    markdown
      .split("\n")
      // The first line is the document title, made from the file name.
      .slice(1)
      .map((line) => line.replace(/^#{1,6} /, "")),
  );

/**
 * Every export of `./text` a production module reads a page's text through,
 * and what each route hands its consumer. Keyed by export name: "every
 * consumer reads through a route" requires these keys to be exactly the
 * exports classified `route`.
 */
const ROUTES: Record<string, (bytes: Uint8Array) => Promise<Reading[]>> = {
  extractPdfText: async (bytes) => {
    const lines = linesOf((await extractPdfText(bytes)).text);
    return [{ via: "extractPdfText", lines, words: wordsOf(lines) }];
  },
  extractPdfLines: async (bytes) => {
    const extracted = await extractPdfLines(bytes);
    const visible = extracted.pages.flatMap((page) =>
      page.lines.filter((line) => line.text.trim()),
    );
    // Health: every visible line carries geometry, so the converter below
    // takes its geometry path — the one that reads `lines` — and not the
    // text fallback, which would read the (ordered) `text` and pass blind.
    for (const line of visible) {
      expect(line.y, `no geometry for "${line.text}"`).not.toBeNull();
    }
    const markdown = extractedTextToMarkdown(extracted, {
      sourceName: "fixture.pdf",
    }).markdown;
    const lineTexts = visible.map((line) => line.text.trim());
    const textLines = linesOf(extracted.text);
    return [
      {
        via: "extractPdfLines text",
        lines: textLines,
        words: wordsOf(textLines),
      },
      {
        via: "extractPdfLines lines",
        lines: lineTexts,
        words: wordsOf(lineTexts),
      },
      { via: "PDF to Markdown", lines: null, words: markdownWords(markdown) },
    ];
  },
};

/**
 * `extractPdfText(bytes)`, after requiring every route in {@link ROUTES} to
 * read the page in the same order: the same lines where a route keeps
 * lines, the same words in the same order where it merges them (Markdown
 * joins a paragraph's lines). The fixtures' own assertions then pin that one
 * order, so they pin every consumer's.
 */
async function readEveryWay(bytes: Uint8Array): Promise<ExtractedPdfText> {
  const extracted = await extractPdfText(bytes);
  const lines = linesOf(extracted.text);
  for (const route of Object.values(ROUTES)) {
    for (const reading of await route(bytes)) {
      if (reading.lines) {
        expect(
          reading.lines.map((line) => line.trim()),
          reading.via,
        ).toEqual(lines.map((line) => line.trim()));
      }
      expect(reading.words, reading.via).toBe(wordsOf(lines));
    }
  }
  return extracted;
}

describe("fixtures are what they claim (health check)", () => {
  it("every OUT_OF_ORDER page really is out of order in its stream", async () => {
    expect(Object.keys(OUT_OF_ORDER).length).toBeGreaterThanOrEqual(3);
    for (const [name, fixture] of Object.entries(OUT_OF_ORDER)) {
      const stream = linesOf(await streamOrderText(await pdfOf(fixture)));
      expect(stream, name).toEqual(texts(fixture.draw));
      expect(stream, name).not.toEqual(fixture.read);
    }
  });

  it("every IN_ORDER page already reads right in stream order", async () => {
    expect(Object.keys(IN_ORDER).length).toBeGreaterThanOrEqual(3);
    for (const [name, fixture] of Object.entries(IN_ORDER)) {
      const stream = linesOf(await streamOrderText(await pdfOf(fixture)));
      expect(stream, name).toEqual(fixture.read);
    }
  });

  it("the column headings and the lone caption have the shapes the band rules mistook for furniture", async () => {
    // Measured from the PDF: baseline, size, horizontal extent of one line.
    const measure = async (draw: Line[]) => {
      const items = await pageItems(await pdfOf({ draw, read: [] }));
      return (line: Line) => {
        const hits = items.filter((item) => item.str === line.text);
        expect(hits, line.text).toHaveLength(1);
        const [, , , size, x, y] = hits[0]!.transform as number[];
        return { y: y!, size: size!, left: x!, right: x! + hits[0]!.width };
      };
    };
    const sideBySide = (
      a: { left: number; right: number },
      b: { left: number; right: number },
    ) => !overlap(a, b);

    // Two headings on ONE baseline, each a line or so over its own column,
    // too large to join it (over a quarter larger), the columns side by side.
    const headed = await measure(
      OUT_OF_ORDER[
        "two columns under 14 pt headings, the right heading drawn after its body"
      ]!.draw,
    );
    const lh = headed(HEADED_LEFT);
    const rh = headed(HEADED_RIGHT);
    expect(lh.y).toBe(rh.y);
    for (const [heading, body] of [
      [lh, headed(HEADED_LEFT_BODY[0]!)],
      [rh, headed(HEADED_RIGHT_BODY[0]!)],
    ] as const) {
      expect(overlap(heading, body)).toBe(true);
      // Within the two line heights a paragraph's next line may follow at.
      expect(heading.y - (body.y + body.size)).toBeLessThanOrEqual(
        2 * heading.size,
      );
      expect(heading.size).toBeGreaterThan(body.size * 1.25);
    }
    expect(
      sideBySide(headed(HEADED_LEFT_BODY[0]!), headed(HEADED_RIGHT_BODY[0]!)),
    ).toBe(true);

    // The caption on the baseline of what ends the right column, and outside
    // the right column's width: beside it, not under it.
    for (const [name, column, last] of [
      ["footnote", CAPTIONED_RIGHT, CAPTIONED_FOOTNOTE],
      ["gap", GAPPED_RIGHT, GAPPED_RIGHT_LAST],
    ] as const) {
      const at = await measure([LONE_CAPTION, ...column, last]);
      const caption = at(LONE_CAPTION);
      const end = at(last);
      const above = at(column.at(-1)!);
      expect(caption.y, name).toBe(end.y);
      for (const line of column) {
        expect(sideBySide(caption, at(line)), `${name}: ${line.text}`).toBe(
          true,
        );
      }
      const gap = above.y - (end.y + end.size);
      if (name === "footnote") {
        // A line under the column, but too small to join it.
        expect(gap).toBeLessThanOrEqual(2 * above.size);
        expect(above.size).toBeGreaterThan(end.size * 1.25);
      } else {
        // The column's own size, after more than a paragraph gap.
        expect(end.size).toBe(above.size);
        expect(gap).toBeGreaterThan(2 * above.size);
      }
    }
  });

  it("the page furniture is where it claims, against the full columns", async () => {
    // Every relationship the furniture is meant to exercise is present: over
    // the right column only, the left only, neither (the gutter), and both.
    const claims = Object.values(FURNITURE).map((f) => f.spans.join("+"));
    for (const shape of ["right", "left", "", "left+right"]) {
      expect(claims).toContain(shape);
    }
    expect(Object.values(FURNITURE).map((f) => f.kind)).toEqual(
      expect.arrayContaining(["header", "footer"]),
    );
    for (const [name, furniture] of Object.entries(FURNITURE)) {
      const bytes = await pdfOf({ draw: [...WIDE, furniture.line], read: [] });
      const own = await extentOf(bytes, (s) => s === furniture.line.text);
      const measured: Column[] = [];
      for (const side of ["left", "right"] as const) {
        const prefix = side === "left" ? "Left column" : "Right column";
        const column = await extentOf(bytes, (s) => s.startsWith(prefix));
        if (overlap(own, column)) measured.push(side);
      }
      expect(measured, name).toEqual(furniture.spans);
    }
  });
});

describe("extractPdfText returns reading order", () => {
  for (const [name, fixture] of Object.entries(OUT_OF_ORDER)) {
    it(`puts right: ${name}`, async () => {
      const bytes = await pdfOf(fixture);
      const extracted = await readEveryWay(bytes);
      expect(linesOf(extracted.text)).toEqual(fixture.read);
      expect(inventory(extracted.text)).toBe(
        inventory(await streamOrderText(bytes)),
      );
      expect(await pdfHasSelectableText(bytes)).toBe(extracted.hasText);
    });
  }

  for (const [name, fixture] of Object.entries(IN_ORDER)) {
    it(`leaves byte-identical: ${name}`, async () => {
      const bytes = await pdfOf(fixture);
      expect((await readEveryWay(bytes)).text).toBe(
        await streamOrderText(bytes),
      );
    });
  }

  it("keeps stream order when any text on the page is rotated", async () => {
    // Geometry of rotated text is not a reading order this extractor can
    // judge; an out-of-order page with one rotated stamp is left alone.
    const fixture: Fixture = {
      draw: [
        ...OUT_OF_ORDER["title drawn after the body it heads"]!.draw,
        { text: "DRAFT", x: 560, y: 300, rotate: 90 },
      ],
      read: [],
    };
    const bytes = await pdfOf(fixture);
    expect((await readEveryWay(bytes)).text).toBe(await streamOrderText(bytes));
  });
});

/**
 * Every fixture above is one page shape. Real pages carry FURNITURE on top of
 * their shape, and the first version of this fix was right on each shape and
 * wrong on the composition: a page number drawn first put the right column
 * above the left, and a footer drawn first landed between the columns — on a
 * page whose stream order had been correct. So every body is composed with
 * every piece of furniture, both where it reads and where generators misplace
 * it, and must come out in reading order; a body that was already in order,
 * with its furniture where it reads, must stay byte-identical.
 */
describe("page furniture composes with every body", () => {
  const BODIES = { ...IN_ORDER, ...OUT_OF_ORDER };

  it("the matrix is the size it claims (health check)", () => {
    // A body list that quietly shrank would pass every row below vacuously.
    expect(Object.keys(BODIES).length).toBe(
      Object.keys(IN_ORDER).length + Object.keys(OUT_OF_ORDER).length,
    );
    expect(Object.keys(BODIES).length).toBeGreaterThanOrEqual(18);
    expect(Object.keys(FURNITURE).length).toBeGreaterThanOrEqual(6);
  });

  for (const [furnitureName, furniture] of Object.entries(FURNITURE)) {
    for (const placement of ["natural", "inverted"] as const) {
      it(`${furnitureName}, ${placement === "natural" ? "drawn where it reads" : `drawn ${furniture.kind === "footer" ? "first" : "last"}`}`, async () => {
        for (const [bodyName, body] of Object.entries(BODIES)) {
          const fixture = compose(body, furniture, placement);
          const bytes = await pdfOf(fixture);
          const stream = await streamOrderText(bytes);
          // Health: the composed page draws exactly what it says it draws.
          expect(linesOf(stream), bodyName).toEqual(texts(fixture.draw));
          const extracted = await readEveryWay(bytes);
          expect(linesOf(extracted.text), bodyName).toEqual(fixture.read);
          expect(inventory(extracted.text), bodyName).toBe(inventory(stream));
          if (placement === "natural" && bodyName in IN_ORDER) {
            expect(extracted.text, bodyName).toBe(stream);
          }
        }
      }, 60_000);
    }
  }
});

/**
 * Furniture comes in PIECES on one baseline: a document's own footer drawn
 * first with a page number or Bates stamp appended last, or a running head
 * split into a name on the left and an issue on the right. The matrix above
 * composes ONE piece at a time, and d399bd1 passed all of it while
 * `Company Confidential` (drawn first) + `Page 3` (drawn last) put the
 * confidential line BETWEEN the two columns — {L, R} was an unbroken run in
 * the MIDDLE of the stream, so the band cut was refused and the footer fell
 * to columnOrder. A header split left-first, right-last read
 * `H_L | L | H_R | R` in every version before it.
 *
 * So every body takes every PAIR of pieces on one baseline, one drawn first
 * and the other last, both ways round. (Two pieces drawn back to back on one
 * baseline are one line to pdfjs, not two pieces; the health check below
 * would see it.) Required: every body line exactly once, contiguous, in the
 * body's reading order; every header piece before the body; every footer
 * piece after it — or, when drawn first, before it, where stream order
 * already put it. Never inside it.
 */
interface Piece {
  kind: "header" | "footer";
  side: "left" | "gutter" | "right";
  line: Line;
}

const PIECES: Piece[] = [
  {
    kind: "footer",
    side: "left",
    line: { text: "Company Confidential", x: 72, y: 24, size: 10 },
  },
  {
    kind: "footer",
    side: "gutter",
    line: { text: "7", x: 306, y: 24, size: 10 },
  },
  {
    kind: "footer",
    side: "right",
    line: { text: "Page 7", x: 509, y: 24, size: 10 },
  },
  {
    kind: "header",
    side: "left",
    line: { text: "Journal of Page Furniture", x: 72, y: 775, size: 10 },
  },
  {
    kind: "header",
    side: "gutter",
    line: { text: "12", x: 303, y: 775, size: 10 },
  },
  {
    kind: "header",
    side: "right",
    line: { text: "Vol. 12, No. 4", x: 480, y: 775, size: 10 },
  },
];

/** Every two pieces of one kind, as [drawn first, drawn last], both ways round. */
const PIECE_PAIRS: [Piece, Piece][] = PIECES.flatMap((a, i) =>
  PIECES.flatMap((b, j) => (i !== j && a.kind === b.kind ? [[a, b]] : [])),
) as [Piece, Piece][];

describe("furniture in two pieces on one baseline composes with every body", () => {
  const BODIES = { ...IN_ORDER, ...OUT_OF_ORDER };

  it("the pieces and pairs are what they claim (health check)", async () => {
    // Two kinds × three sides, every ordered pair within a kind: 2 × 3 × 2.
    expect(PIECES).toHaveLength(6);
    expect(PIECE_PAIRS).toHaveLength(12);
    expect(Object.keys(BODIES).length).toBeGreaterThanOrEqual(18);
    for (const kind of ["header", "footer"] as const) {
      expect(
        PIECES.filter((p) => p.kind === kind)
          .map((p) => p.side)
          .sort(),
      ).toEqual(["gutter", "left", "right"]);
      // One baseline per kind.
      expect(
        new Set(PIECES.filter((p) => p.kind === kind).map((p) => p.line.y))
          .size,
      ).toBe(1);
    }
    // No piece's text is a line of any body, or the "exactly once" below
    // would be measuring the body.
    const bodyLines = new Set(Object.values(BODIES).flatMap((b) => b.read));
    for (const piece of PIECES)
      expect(bodyLines.has(piece.line.text)).toBe(false);
    // The side each piece claims, measured against the full columns.
    for (const piece of PIECES) {
      const bytes = await pdfOf({ draw: [...WIDE, piece.line], read: [] });
      const own = await extentOf(bytes, (s) => s === piece.line.text);
      const left = await extentOf(bytes, (s) => s.startsWith("Left column"));
      const right = await extentOf(bytes, (s) => s.startsWith("Right column"));
      const side = overlap(own, left)
        ? overlap(own, right)
          ? "both"
          : "left"
        : overlap(own, right)
          ? "right"
          : "gutter";
      expect(side, piece.line.text).toBe(piece.side);
    }
  });

  for (const [first, last] of PIECE_PAIRS) {
    it(`${first.kind}: ${first.side} piece drawn first, ${last.side} piece drawn last`, async () => {
      // Every body is checked before anything is asserted, so a red run
      // names every page this pair breaks, not only the first.
      const problems: string[] = [];
      for (const [bodyName, body] of Object.entries(BODIES)) {
        const fixture: Fixture = {
          draw: [first.line, ...body.draw, last.line],
          read: [],
        };
        const bytes = await pdfOf(fixture);
        // Health: the page draws exactly what it says, the pieces as lines
        // of their own.
        expect(linesOf(await streamOrderText(bytes)), bodyName).toEqual(
          texts(fixture.draw),
        );
        problems.push(
          ...pieceProblems(
            linesOf((await readEveryWay(bytes)).text),
            body.read,
            first,
            last,
          ).map((problem) => `${bodyName}: ${problem}`),
        );
      }
      expect(problems).toEqual([]);
    }, 60_000);
  }
});

/**
 * What is wrong with `lines` as the reading of a body (`read`) carrying
 * `first` (drawn first) and `last` (drawn last); `[]` when nothing is.
 */
function pieceProblems(
  lines: string[],
  read: string[],
  first: Piece,
  last: Piece,
): string[] {
  const expected = [...read, first.line.text, last.line.text];
  if (
    JSON.stringify([...lines].sort()) !== JSON.stringify([...expected].sort())
  ) {
    return [`lines gained or lost: ${JSON.stringify(lines)}`];
  }
  const start = lines.indexOf(read[0]!);
  const end = start + read.length;
  const problems: string[] = [];
  if (JSON.stringify(lines.slice(start, end)) !== JSON.stringify(read)) {
    problems.push(`the body is broken apart: ${JSON.stringify(lines)}`);
  }
  for (const piece of [first, last]) {
    const at = lines.indexOf(piece.line.text);
    const before = at < start;
    const after = at >= end;
    const ok =
      piece.kind === "header"
        ? before
        : piece === first
          ? before || after
          : after;
    if (!ok) {
      problems.push(
        `${piece.kind} "${piece.line.text}" at ${at}, body at ${start}..${end - 1}`,
      );
    }
  }
  return problems;
}

// Scope: "beside" means some of the later column runs beside the earlier one.
// A right column that ENDS above where the left starts is not beside it, and
// is the one shape `readingOrder`'s docblock names as ambiguous — pinned last.
describe("a later column never comes before an earlier one it runs beside", () => {
  // No clean band separates this page number from the body: the left column
  // runs longer and passes beside it. Lifting the right column in front of it
  // (it lies above it) would put the right column before the left one — the
  // move has to be refused, whatever becomes of the page number.
  const LONG_LEFT = wideCol("Left", 72, 700, 8);
  const SHORT_RIGHT = wideCol("Right", 320, 700, 3);
  const PAGE_NUMBER: Line = { text: "Page 3", x: 509, y: 610, size: 10 };

  it("a page number drawn first, beside the foot of a longer left column", async () => {
    const bytes = await pdfOf({
      draw: [PAGE_NUMBER, ...LONG_LEFT, ...SHORT_RIGHT],
      read: [],
    });
    // Health: the page number sits below the right column and overlaps it,
    // and beside the left one — the shape that tempts the lift.
    const own = await extentOf(bytes, (s) => s === PAGE_NUMBER.text);
    const right = await extentOf(bytes, (s) => s.startsWith("Right column"));
    const left = await extentOf(bytes, (s) => s.startsWith("Left column"));
    expect(overlap(own, right)).toBe(true);
    expect(overlap(own, left)).toBe(false);
    expect(PAGE_NUMBER.y).toBeLessThan(SHORT_RIGHT.at(-1)!.y);
    expect(PAGE_NUMBER.y).toBeGreaterThan(LONG_LEFT.at(-1)!.y);

    const lines = linesOf((await readEveryWay(bytes)).text);
    const lastLeft = Math.max(...texts(LONG_LEFT).map((t) => lines.indexOf(t)));
    const firstRight = Math.min(
      ...texts(SHORT_RIGHT).map((t) => lines.indexOf(t)),
    );
    // Every line is present, and the left column is wholly before the right.
    expect([...lines].sort()).toEqual(
      [PAGE_NUMBER.text, ...texts(LONG_LEFT), ...texts(SHORT_RIGHT)].sort(),
    );
    expect(lastLeft).toBeLessThan(firstRight);
    expect(
      lines.slice(lines.indexOf(texts(LONG_LEFT)[0]!), lastLeft + 1),
    ).toEqual(texts(LONG_LEFT));
  });

  it("the staggered pages have the shape that tempts a band cut (health check)", async () => {
    expect(Object.keys(STAGGERED).length).toBeGreaterThanOrEqual(3);
    for (const [name, page] of Object.entries(STAGGERED)) {
      // `left` and `right` partition what the page draws.
      expect([...texts(page.left), ...texts(page.right)].sort(), name).toEqual(
        texts(page.draw).sort(),
      );
      const items = await pageItems(await pdfOf({ draw: page.draw, read: [] }));
      const side = (lines: Line[]) => {
        const own = new Set(texts(lines));
        const hits = items.filter((item) => own.has(item.str));
        expect(hits.length, name).toBe(lines.length);
        return hits;
      };
      const left = side(page.left);
      const right = side(page.right);
      const extent = (hits: ReadItem[]) => ({
        left: Math.min(...hits.map((item) => item.transform[4]!)),
        right: Math.max(...hits.map((i) => i.transform[4]! + i.width)),
      });
      // Side by side: no line of one column overlaps the other horizontally.
      expect(overlap(extent(left), extent(right)), name).toBe(false);
      // The left column starts LOWER, and the right column has a gap of more
      // than two line heights ABOVE where the left one starts.
      const leftTop = Math.max(...left.map((item) => item.transform[5]!));
      const ys = right.map((item) => item.transform[5]!).sort((a, b) => b - a);
      expect(ys[0]!, name).toBeGreaterThan(leftTop);
      // (Baselines; 32 pt is over two lines of the largest size drawn, 16 pt.)
      const gap = ys.some(
        (y, i) => i > 0 && ys[i - 1]! > leftTop && ys[i - 1]! - y > 2 * 16,
      );
      expect(gap, name).toBe(true);
    }
  });

  // Every staggered page, bare and under every piece of furniture both where
  // it reads and where generators misplace it: the left column comes out
  // wholly before the right, every line exactly once.
  for (const [name, page] of Object.entries(STAGGERED)) {
    it(`keeps the left column before the right: ${name}`, async () => {
      const body: Fixture = { draw: page.draw, read: texts(page.draw) };
      const pages: [string, Fixture][] = [["bare", body]];
      for (const [furnitureName, furniture] of Object.entries(FURNITURE)) {
        for (const placement of ["natural", "inverted"] as const) {
          pages.push([
            `${furnitureName}, ${placement}`,
            compose(body, furniture, placement),
          ]);
        }
      }
      expect(pages.length).toBe(1 + 2 * Object.keys(FURNITURE).length);
      for (const [label, fixture] of pages) {
        const lines = linesOf((await readEveryWay(await pdfOf(fixture))).text);
        const at = (line: Line) => {
          expect(
            lines.filter((l) => l === line.text),
            `${label}: ${line.text}`,
          ).toHaveLength(1);
          return lines.indexOf(line.text);
        };
        const lastLeft = Math.max(...page.left.map(at));
        const firstRight = Math.min(...page.right.map(at));
        expect(lastLeft, `${label}: last left line before first right`).toBe(
          firstRight - 1,
        );
      }
    }, 60_000);
  }

  it("the ambiguous shape reads as the docblock says: a right column ending above the left", async () => {
    // NOT a claim that this is the right reading. With nothing of the right
    // column beside the left one, the page is the same shape, to stream order
    // and geometry, as a header drawn last over the right column (which the
    // matrix above requires to read first). This pins the sentence in
    // `readingOrder`'s docblock: whoever changes the behaviour must change
    // that sentence, and invert this test, not delete it.
    const left = wideCol("Left", 72, 500, 8);
    const right = wideCol("Right", 320, 700, 4);
    const bytes = await pdfOf({ draw: [...left, ...right], read: [] });
    // Health: the right column's last line is above the left column's first.
    expect(right.at(-1)!.y).toBeGreaterThan(left[0]!.y + 2 * 14);
    expect(linesOf(await streamOrderText(bytes))).toEqual([
      ...texts(left),
      ...texts(right),
    ]);
    expect(linesOf((await readEveryWay(bytes)).text)).toEqual([
      ...texts(right),
      ...texts(left),
    ]);
  });
});

describe("a page too dense to order keeps stream order", () => {
  // Ordering is quadratic in the page's blocks. A page where every label is
  // its own block (a map, a CAD drawing, a table drawn cell by cell) must not
  // stall the tab, so above MAX_ORDERED_BLOCKS the page keeps stream order.
  // One line per block, drawn bottom to top, so reading order reverses it.
  const bottomUp = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      str: `label ${i}`,
      hasEOL: true,
      transform: [10, 0, 0, 10, 72, 100 + i * 14],
      width: 40,
      dir: "ltr",
    }));
  const streamOf = (n: number) =>
    Array.from({ length: n }, (_, i) => `label ${i}`).join("\n");
  const readOf = (n: number) =>
    Array.from({ length: n }, (_, i) => `label ${n - 1 - i}`).join("\n");

  it("orders a page of exactly MAX_ORDERED_BLOCKS blocks (positive control)", () => {
    expect(MAX_ORDERED_BLOCKS).toBeGreaterThanOrEqual(100);
    expect(textItemsToPlainText(bottomUp(MAX_ORDERED_BLOCKS))).toBe(
      readOf(MAX_ORDERED_BLOCKS),
    );
  });

  it("keeps stream order one block past it", () => {
    expect(textItemsToPlainText(bottomUp(MAX_ORDERED_BLOCKS + 1))).toBe(
      streamOf(MAX_ORDERED_BLOCKS + 1),
    );
  });
});

/**
 * Every production module that reads a page's text gets it through a route
 * the fixtures above run — DISCOVERED from the importers of `./text`, not
 * listed. The claim this replaces was a sentence ("the extractor PDF to Text,
 * PDF to Markdown, Compare and the translate panel all call") that stayed
 * true of one export while PDF to Markdown moved to another.
 *
 * Each value export of `./text` has one role, and the roles are checked in
 * both directions against what the module exports and what production
 * imports:
 *  - `route`: hands a consumer a page's text — each is a key of ROUTES, so
 *    every fixture reads through it;
 *  - `yes-no`: answers whether there is text, pinned to `extractPdfText`'s
 *    `hasText` in "puts right" above;
 *  - `after-reading`: takes text a route already read (joins, chunks,
 *    normalizes, names the file), keeping its order;
 *  - `seam`: what the routes are built from, exported for tests. Production
 *    importing one would read a page around the routes, so none may.
 */
const EXPORT_ROLES: Record<
  string,
  "route" | "yes-no" | "after-reading" | "seam"
> = {
  extractPdfText: "route",
  extractPdfLines: "route",
  pdfHasSelectableText: "yes-no",
  normalizeExtractedText: "after-reading",
  collapseLayoutPadding: "after-reading",
  PAGE_JOIN: "after-reading",
  pageTextChunks: "after-reading",
  pagesWithoutText: "after-reading",
  joinPageTexts: "after-reading",
  textOutputName: "after-reading",
  textItemsToPlainText: "seam",
  textItemsToLines: "seam",
  linePageFromItems: "seam",
  assembleExtraction: "seam",
  MAX_ORDERED_BLOCKS: "seam",
};

const ROOT = process.cwd();
const TEXT_MODULE = path.join(ROOT, "src", "lib", "pdf", "text");

const parse = (file: string, text: string) =>
  ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

/** The value exports `./text` declares (types and interfaces are not read). */
function textModuleExports(): string[] {
  const sf = parse("text.ts", readFileSync(`${TEXT_MODULE}.ts`, "utf8"));
  const names: string[] = [];
  for (const node of sf.statements) {
    // An `export { … }` list or `export *` would hide names from this walk.
    if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
      names.push("<export statement>");
      continue;
    }
    const exported = (
      ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
    )?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
      names.push(node.name?.text ?? "<anonymous>");
    } else if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        names.push(ts.isIdentifier(d.name) ? d.name.text : "<pattern>");
      }
    }
  }
  return names;
}

/** Whether module specifier `spec`, written in `from`, names `./text`. */
function namesTextModule(from: string, spec: string): boolean {
  const target = spec.startsWith("@/")
    ? path.join(ROOT, "src", spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(path.dirname(from), spec)
      : null;
  return target !== null && target.replace(/\.tsx?$/, "") === TEXT_MODULE;
}

/**
 * The VALUE names `source` takes from `./text`: static imports (not type-only
 * ones), and dynamic imports destructured or read by property. Any other
 * shape — a namespace or default import, a re-export, a dynamic import kept
 * whole — is `"*"`, which no role covers, so it fails the guard rather than
 * slipping past it.
 */
function importedFromText(file: string, source: string): string[] {
  const names: string[] = [];
  const visit = (node: TS.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      namesTextModule(file, node.moduleSpecifier.text)
    ) {
      const clause = node.importClause;
      if (clause && !clause.isTypeOnly) {
        if (clause.name) names.push("*");
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) names.push("*");
        if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            if (!el.isTypeOnly) names.push((el.propertyName ?? el.name).text);
          }
        }
      }
      return;
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      namesTextModule(file, node.moduleSpecifier.text) &&
      !node.isTypeOnly
    ) {
      names.push("*");
      return;
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      namesTextModule(file, node.arguments[0].text)
    ) {
      let use: TS.Node = node.parent;
      while (ts.isAwaitExpression(use) || ts.isParenthesizedExpression(use)) {
        use = use.parent;
      }
      if (
        ts.isVariableDeclaration(use) &&
        ts.isObjectBindingPattern(use.name)
      ) {
        for (const el of use.name.elements) {
          const key = el.propertyName ?? el.name;
          names.push(ts.isIdentifier(key) ? key.text : "*");
        }
      } else if (ts.isPropertyAccessExpression(use)) {
        names.push(use.name.text);
      } else {
        names.push("*");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file, source));
  return names;
}

/** Production sources: src and scripts, without tests and test support. */
function productionSources(): string[] {
  const out: string[] = [];
  const testSupport = path.join(ROOT, "src", "tests");
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && full !== testSupport) walk(full);
      } else if (
        /\.(ts|tsx|mts|cts)$/.test(entry.name) &&
        !/\.d\.ts$/.test(entry.name) &&
        !/\.(test|spec)\.tsx?$/.test(entry.name)
      ) {
        out.push(full);
      }
    }
  };
  walk(path.join(ROOT, "src"));
  walk(path.join(ROOT, "scripts"));
  return out;
}

describe("every consumer reads through a route the fixtures run", () => {
  const consumers = productionSources()
    .filter((file) => file.replace(/\.tsx?$/, "") !== TEXT_MODULE)
    .map((file) => ({
      file: path.relative(ROOT, file).split(path.sep).join("/"),
      names: importedFromText(file, readFileSync(file, "utf8")),
    }))
    .filter((consumer) => consumer.names.length > 0);
  const importedNames = new Set(consumers.flatMap((c) => c.names));

  it("the detector sees every shape of import (positive and negative controls)", () => {
    const at = path.join(ROOT, "src", "lib", "x", "y.ts");
    const of = (source: string) => importedFromText(at, source);
    const from = 'from "@/lib/pdf/text";';
    expect(of(`import { extractPdfText as e } ${from}`)).toEqual([
      "extractPdfText",
    ]);
    expect(of('import { a } from "../pdf/text";')).toEqual(["a"]);
    expect(of('import { a } from "../../lib/pdf/text";')).toEqual(["a"]);
    expect(
      of('const { pdfHasSelectableText } = await import("@/lib/pdf/text");'),
    ).toEqual(["pdfHasSelectableText"]);
    expect(
      of('const n = (await import("@/lib/pdf/text")).extractPdfLines;'),
    ).toEqual(["extractPdfLines"]);
    expect(of('const m = await import("@/lib/pdf/text");')).toEqual(["*"]);
    expect(of(`import * as t ${from}`)).toEqual(["*"]);
    expect(of(`export { extractPdfText } ${from}`)).toEqual(["*"]);
    // Types are erased at runtime: they read no page.
    expect(of(`import type { ExtractedPdfText } ${from}`)).toEqual([]);
    expect(of(`import { type TextLine, joinPageTexts } ${from}`)).toEqual([
      "joinPageTexts",
    ]);
    // Another module, however close its name.
    expect(of('import { extractPdfText } from "@/lib/pdf/textual";')).toEqual(
      [],
    );
    expect(of('import { extractPdfText } from "./text";')).toEqual([]);
  });

  it("the consumer set is plausibly sized, and holds the ones known to read text (health)", () => {
    // A walk that quietly found nothing would pass every check below; one
    // that found everything would be reading the wrong set.
    expect(consumers.length).toBeGreaterThanOrEqual(12);
    expect(consumers.length).toBeLessThanOrEqual(60);
    const byFile = Object.fromEntries(consumers.map((c) => [c.file, c.names]));
    // One positive control per shape that carries a route or an answer.
    expect(
      byFile["src/components/tools/runner/pdf-to-markdown-runner.tsx"],
    ).toContain("extractPdfLines");
    expect(
      byFile["src/components/tools/runner/compare-pdf-runner.tsx"],
    ).toContain("extractPdfText");
    expect(byFile["src/lib/workers/pdf-security-client.ts"]).toContain(
      "pdfHasSelectableText",
    );
  });

  it("every export of ./text has exactly one role, and every role names a real export", () => {
    const exports = textModuleExports();
    // Health: the walk found the module's exports, not an empty list.
    expect(exports).toContain("extractPdfText");
    expect(exports.sort()).toEqual(Object.keys(EXPORT_ROLES).sort());
  });

  it("production imports nothing but routes, yes-no answers and text already read", () => {
    const stray = consumers.flatMap(({ file, names }) =>
      names
        .filter((name) => {
          const role = EXPORT_ROLES[name];
          return role === undefined || role === "seam";
        })
        .map((name) => `${file}: ${name}`),
    );
    expect(stray).toEqual([]);
  });

  it("every route is run by the fixtures, and every role but seam is used", () => {
    const routes = Object.keys(EXPORT_ROLES).filter(
      (name) => EXPORT_ROLES[name] === "route",
    );
    expect(Object.keys(ROUTES).sort()).toEqual(routes.sort());
    // A role no production module imports classifies nothing.
    const unused = Object.entries(EXPORT_ROLES)
      .filter(([name, role]) => role !== "seam" && !importedNames.has(name))
      .map(([name]) => name);
    expect(unused).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import { loadPdfjs } from "./pdfjs";
import {
  extractPdfText,
  MAX_ORDERED_BLOCKS,
  normalizeExtractedText,
  pdfHasSelectableText,
  textItemsToPlainText,
} from "./text";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";

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
 * Every fixture is a real PDF read through `extractPdfText` — the extractor
 * PDF to Text, PDF to Markdown, Compare and the translate panel all call.
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
const wideCol = (side: "Left" | "Right", x: number, top: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    text: `${side} column line ${i + 1} set wide enough to fill its column`,
    x,
    y: top - i * 14,
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
};

/** Pages whose stream order is ALREADY the reading order — the controls. */
const IN_ORDER: Record<string, Fixture> = {
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
      const extracted = await extractPdfText(bytes);
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
      expect((await extractPdfText(bytes)).text).toBe(
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
    expect((await extractPdfText(bytes)).text).toBe(
      await streamOrderText(bytes),
    );
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
    expect(Object.keys(BODIES).length).toBeGreaterThanOrEqual(14);
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
          const extracted = await extractPdfText(bytes);
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

describe("reading order never puts a later column before an earlier one", () => {
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

    const lines = linesOf((await extractPdfText(bytes)).text);
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

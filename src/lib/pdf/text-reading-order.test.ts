import { describe, expect, it } from "vitest";
import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import { loadPdfjs } from "./pdfjs";
import {
  extractPdfText,
  normalizeExtractedText,
  pdfHasSelectableText,
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

/** Pages whose stream order is WRONG — the defect. */
const OUT_OF_ORDER: Record<string, Fixture> = {
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

/** The text in pure content-stream order — what the extractor used to return. */
async function streamOrderText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const content = await page.getTextContent({ includeMarkedContent: false });
    let text = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += item.str;
      if (item.hasEOL) text += "\n";
    }
    return normalizeExtractedText(text);
  } finally {
    await task.destroy();
  }
}

const linesOf = (text: string) => text.split("\n").filter((l) => l.trim());

/** Non-whitespace characters, sorted: reordering may move text, never add or drop it. */
const inventory = (text: string) =>
  [...text.replace(/\s/g, "")].sort().join("");

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

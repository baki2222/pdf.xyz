// @native-canvas
import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { extractedTextToMarkdown, markdownSummary } from "./pdf-to-markdown";
import { linksFromPage, pdfToMarkdown } from "./pdf-to-markdown-read";

/**
 * PDF to Markdown as the runner calls it: real bytes, pdfjs's own text items
 * and annotations (the legacy build — the browser build needs DOMMatrix), the
 * converter, and the Markdown read back. Nothing here hands the converter a
 * shape typed by hand, so a link the reader drops is a link the user loses.
 */

/** pdf.js's legacy build, the one Node runs (as sample-pdf.test.ts does). */
const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pick<
    typeof import("pdfjs-dist"),
    "getDocument"
  >;

const SIZE = 12;

/** Add a /Link with a /URI action over `rect` (x1, y1, x2, y2). */
function addUriLink(
  doc: PDFDocument,
  page: PDFPage,
  rect: [number, number, number, number],
  uri: string,
) {
  const link = doc.context.register(
    doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: rect,
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(uri) },
    }),
  );
  const existing = page.node.lookup(PDFName.of("Annots"));
  if (existing instanceof PDFArray) existing.push(link);
  else page.node.set(PDFName.of("Annots"), doc.context.obj([link]));
}

/**
 * Draw `before + anchor + after` on one line at (x, y) and cover just the
 * anchor with a link, measured from the font's own widths.
 */
function linkedLine(
  doc: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  y: number,
  [before, anchor, after]: [string, string, string],
  uri: string,
) {
  const x = 72;
  page.drawText(`${before}${anchor}${after}`, { x, y, size: SIZE, font });
  const x1 = x + font.widthOfTextAtSize(before, SIZE);
  const x2 = x1 + font.widthOfTextAtSize(anchor, SIZE);
  addUriLink(doc, page, [x1, y - 3, x2, y + SIZE], uri);
}

async function linkedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  linkedLine(
    doc,
    page,
    font,
    700,
    ["Read the ", "setup guide", " before you start."],
    "https://example.com/guide?a=1",
  );
  linkedLine(
    doc,
    page,
    font,
    660,
    ["Mail ", "the team", " with questions."],
    "mailto:team@example.com",
  );
  // A link to a scheme the Markdown must not carry.
  linkedLine(
    doc,
    page,
    font,
    620,
    ["Do not ", "run this", " script."],
    "javascript:alert(1)",
  );
  // A link whose text IS its address.
  linkedLine(
    doc,
    page,
    font,
    580,
    ["See ", "https://example.org", " for more."],
    "https://example.org",
  );
  return doc.save({ useObjectStreams: false });
}

describe("PDF to Markdown keeps the web address behind a link", () => {
  it("writes a linked phrase as [text](url), read from a real PDF's /Link", async () => {
    const result = await pdfToMarkdown(
      await linkedPdf(),
      { sourceName: "links.pdf" },
      legacy,
    );
    expect(result.markdown).toContain(
      "Read the [setup guide](https://example.com/guide?a=1) before you start.",
    );
    expect(result.markdown).toContain(
      "Mail [the team](mailto:team@example.com) with questions.",
    );
    // An address shown as its own text becomes an autolink, not [x](x)
    // (pdf.js reports the address normalised, with its trailing slash).
    expect(result.markdown).toContain("See <https://example.org/> for more.");
    expect(result.linkCount).toBe(3);
    // The result panel's summary says how many were kept.
    expect(markdownSummary(result)).toMatch(/ · 3 links$/);
  });

  it("never writes a javascript: (or any non-web) link, and keeps its words", async () => {
    const { markdown } = await pdfToMarkdown(await linkedPdf(), {}, legacy);
    expect(markdown).not.toMatch(/javascript:/i);
    expect(markdown).toContain("Do not run this script.");
  });

  it("CONTROL: the same page with no /Link annotations writes plain words", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    page.drawText("Read the setup guide before you start.", {
      x: 72,
      y: 700,
      size: SIZE,
      font,
    });
    const { markdown, linkCount } = await pdfToMarkdown(
      await doc.save(),
      {},
      legacy,
    );
    expect(markdown).toContain("Read the setup guide before you start.");
    expect(markdown).not.toContain("](");
    expect(linkCount).toBe(0);
  });
});

describe("linksFromPage: the words a link covers", () => {
  const item = (str: string, x: number, width: number, y = 700) => ({
    str,
    transform: [12, 0, 0, 12, x, y],
    width,
    height: 12,
  });

  it("takes only the words whose letters sit inside the link's box", () => {
    // 14 characters over 140pt: 10pt each. "here" spans x 132..172; the
    // link covers 122..172, the word "here" and the space before it.
    const links = linksFromPage(
      [item("click here now", 72, 140)],
      [
        {
          subtype: "Link",
          url: "https://example.com/",
          rect: [122, 697, 172, 712],
        },
      ],
    );
    expect(links).toEqual([
      expect.objectContaining({ text: "here", url: "https://example.com/" }),
    ]);
  });

  it("drops a link that covers no text, and one with an unsafe scheme", () => {
    expect(
      linksFromPage(
        [item("click here", 72, 100)],
        [
          {
            subtype: "Link",
            url: "https://a.example/",
            rect: [300, 0, 400, 10],
          },
          {
            subtype: "Link",
            url: "file:///etc/passwd",
            rect: [72, 690, 172, 712],
          },
          { subtype: "Link", rect: [72, 690, 172, 712] },
          {
            subtype: "Widget",
            url: "https://b.example/",
            rect: [72, 690, 172, 712],
          },
        ],
      ),
    ).toEqual([]);
  });

  it("follows a link's QuadPoints over two lines rather than its whole box", () => {
    const links = linksFromPage(
      [
        item("the long anchor", 72, 150, 700),
        item("text continues here", 72, 190, 686),
      ],
      [
        {
          subtype: "Link",
          url: "https://example.com/",
          rect: [72, 683, 222, 712],
          // "long anchor" on the first line (x 112..222), "text" on the
          // second (x 72..112).
          quadPoints: [
            112, 712, 222, 712, 112, 697, 222, 697, 72, 698, 112, 698, 72, 683,
            112, 683,
          ],
        },
      ],
    );
    expect(links.map((l) => l.text)).toEqual(["long anchor text"]);
  });
});

/** A page with a paragraph, a table drawn cell by cell, and a paragraph. */
async function tablePdf(rows: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const draw = (text: string, x: number, y: number) =>
    page.drawText(text, { x, y, size: 11, font });
  draw("Prices for the spring order are listed in the table below,", 72, 720);
  draw("and every amount is in euros.", 72, 706);
  const columns = [72, 240, 360];
  rows.forEach((cells, r) =>
    cells.forEach((cell, c) => draw(cell, columns[c]!, 670 - r * 18)),
  );
  draw("Orders close on Friday.", 72, 670 - rows.length * 18 - 30);
  return doc.save({ useObjectStreams: false });
}

const PRICES = [
  ["Item", "Quantity", "Price"],
  ["Apples", "3", "1.20"],
  ["Pears|Quinces", "12", "4.80"],
  ["Plums", "7", "2.10"],
];

describe("PDF to Markdown writes a detected table as a GFM table", () => {
  it("puts the table where its lines were, with the paragraphs around it", async () => {
    const result = await pdfToMarkdown(
      await tablePdf(PRICES),
      { sourceName: "prices.pdf" },
      legacy,
    );
    expect(result.markdown).toContain(
      [
        "| Item | Quantity | Price |",
        "| --- | --- | --- |",
        "| Apples | 3 | 1.20 |",
        // A pipe inside a cell is escaped, so it stays in its cell.
        "| Pears\\|Quinces | 12 | 4.80 |",
        "| Plums | 7 | 2.10 |",
      ].join("\n"),
    );
    expect(result.markdown).toMatch(
      /euros\.\n\n\| Item [^\n]*\n[\s\S]*\| Plums \| 7 \| 2\.10 \|\n\nOrders close on Friday\.$/,
    );
    expect(result.tableCount).toBe(1);
    expect(markdownSummary(result)).toMatch(/ · 1 table$/);
  });

  it("CONTROL: a page of prose has no table, and no word is lost either way", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    [
      "A page of ordinary prose that wraps from one line onto the",
      "next, with nothing lined up in columns at all, and which",
      "ends here.",
    ].forEach((line, i) =>
      page.drawText(line, { x: 72, y: 700 - i * 14, size: 11, font }),
    );
    const prose = await pdfToMarkdown(await doc.save(), {}, legacy);
    expect(prose.markdown).not.toContain("| --- |");
    expect(prose.tableCount).toBe(0);
    // The table's cells, in order, are the cells drawn: none lost or added.
    const { markdown } = await pdfToMarkdown(
      await tablePdf(PRICES),
      {},
      legacy,
    );
    const cells = markdown
      .split("\n")
      .filter((line) => line.startsWith("| "))
      .flatMap((line) => line.slice(2, -2).split(/ (?<!\\)\| /));
    expect(cells.filter((cell) => cell !== "---")).toEqual(
      PRICES.flat().map((word) => word.replace("|", "\\|")),
    );
  });
});

describe("PDF to Markdown's tables: two columns of prose stay prose", () => {
  it("CONTROL: side-by-side paragraphs are not read as a two-column table", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    const left = [
      "The left column starts with a sentence that",
      "wraps onto a second line and then a third",
      "line before it ends with a full stop.",
    ];
    const right = [
      "The right column has its own text that",
      "runs down the page beside the left one,",
      "with lines of a similar length to it.",
    ];
    left.forEach((line, i) =>
      page.drawText(line, { x: 72, y: 700 - i * 14, size: 10, font }),
    );
    right.forEach((line, i) =>
      page.drawText(line, { x: 320, y: 700 - i * 14, size: 10, font }),
    );
    const { markdown, tableCount } = await pdfToMarkdown(
      await doc.save(),
      {},
      legacy,
    );
    expect(tableCount).toBe(0);
    expect(markdown).not.toContain("|");
    expect(markdown).toContain("a third line before it ends with a full stop.");
  });
});

describe("a detected table replaces its lines only when they hold exactly its words", () => {
  const convert = (rowTexts: string[]) => {
    const lines = rowTexts.map((text, i) => ({
      text,
      x: 72,
      y: 700 - i * 14,
      size: 11,
      fontName: null,
    }));
    const text = rowTexts.join("\n");
    return extractedTextToMarkdown({
      pageCount: 1,
      text,
      characterCount: text.length,
      hasText: true,
      pages: [
        {
          pageNumber: 1,
          text,
          characterCount: text.length,
          lines,
          tables: [
            {
              rows: [
                ["Item", "Qty"],
                ["Apples", "3"],
              ],
              top: 700,
              bottom: 686,
            },
          ],
        },
      ],
    });
  };

  it("writes the table when the lines on its rows are its cells", () => {
    const result = convert(["Item Qty", "Apples 3"]);
    expect(result.tableCount).toBe(1);
    expect(result.markdown).toContain("| Item | Qty |\n| --- | --- |");
  });

  it("CONTROL: a line on its rows with words the table lacks keeps every word as prose", () => {
    const result = convert(["Item Qty see note", "Apples 3"]);
    expect(result.tableCount).toBe(0);
    expect(result.markdown).toContain("Item Qty see note");
    expect(result.markdown).not.toContain("| --- |");
  });
});

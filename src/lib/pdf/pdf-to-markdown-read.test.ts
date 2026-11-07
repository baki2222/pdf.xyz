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
import { markdownSummary } from "./pdf-to-markdown";
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

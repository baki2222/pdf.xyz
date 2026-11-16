// @native-canvas
/**
 * Summarize's "Part to summarize" sections, held against an INDEPENDENT
 * reader: pdf.js's own outline (`getOutline` → `getDestination` →
 * `getPageIndex`, the walk a viewer does on a click; the same oracle
 * `bookmarks.pdfjs.test.ts` uses), never the pdf-lib reader the module
 * itself calls. So the module cannot certify itself.
 *
 * The fixture carries every shape that has bitten an outline reader: a
 * first bookmark on page 3 (pages 1-2 must NOT become a section), a URL
 * bookmark (no page), a named destination, two bookmarks on one page
 * (one section, titled by the first in outline order), an outline out of
 * page order, and a title with control characters.
 */
import { describe, expect, it } from "vitest";
import { PDFName, PDFNumber } from "pdf-lib";
import { loadPdfjs } from "./pdfjs";
import {
  MAX_SECTION_TITLE,
  MAX_SUMMARY_SECTIONS,
  cleanSectionTitle,
  readSummarySections,
  summarySections,
} from "./summary-sections";
import {
  action,
  addOutline,
  blankPages,
  fitDest,
  lit,
} from "@/tests/bookmark-fixtures";

const N = (n: string) => PDFName.of(n);
// U+0007 (BEL) and U+009B (CSI), built from code points.
const BEL = String.fromCodePoint(0x07);
const CSI = String.fromCodePoint(0x9b);

/** Top-level outline items as pdf.js resolves them: title and 1-based page. */
async function viewerTopLevel(
  bytes: Uint8Array,
): Promise<{ title: string; page: number | null }[]> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await task.promise;
  try {
    const pageOf = async (dest: unknown): Promise<number | null> => {
      const explicit =
        typeof dest === "string" ? await pdf.getDestination(dest) : dest;
      if (!Array.isArray(explicit)) return null;
      const target: unknown = explicit[0];
      if (typeof target === "number") return target + 1;
      if (!target || typeof target !== "object") return null;
      try {
        return (await pdf.getPageIndex(target as never)) + 1;
      } catch {
        return null;
      }
    };
    const items = ((await pdf.getOutline()) ?? []) as {
      title: string;
      dest: unknown;
    }[];
    // One at a time: two concurrent lookups of the same page reference
    // ("Chapter Five" and "Chapter Five again") never settled under pdf.js
    // here, so the oracle walks the outline in order, as a reader clicks.
    const out: { title: string; page: number | null }[] = [];
    for (const item of items)
      out.push({
        title: item.title,
        page: item.dest ? await pageOf(item.dest) : null,
      });
    return out;
  } finally {
    await task.destroy();
  }
}

/** The rule, written over the ORACLE's items, independently of the module. */
function expectedFrom(
  items: { title: string; page: number | null }[],
  pageCount: number,
) {
  const first = new Map<number, string>();
  for (const { title, page } of items)
    if (page !== null && !first.has(page)) first.set(page, title);
  const starts = [...first.keys()].sort((a, b) => a - b);
  return starts.map((start, i) => ({
    title: first.get(start)!,
    span: [start, (starts[i + 1] ?? pageCount + 1) - 1],
  }));
}

async function fixture(): Promise<Uint8Array> {
  const doc = await blankPages(7);
  const ctx = doc.context;
  doc.catalog.set(
    N("Names"),
    ctx.obj({
      Dests: ctx.obj({ Names: ctx.obj([lit("ch5"), fitDest(doc, 4)]) }),
    }),
  );
  addOutline(doc, [
    { title: "Introduction", dest: fitDest(doc, 2) },
    {
      title: "Website",
      action: action(doc, { S: N("URI"), URI: lit("https://example.org/") }),
    },
    { title: "Chapter Five", dest: lit("ch5") },
    { title: "Chapter Five again", dest: fitDest(doc, 4) },
    // Out of page order, and a 0-based page NUMBER as the head.
    { title: "Methods", dest: ctx.obj([PDFNumber.of(3), N("Fit")]) },
  ]);
  return doc.save();
}

describe("Summarize sections, read against pdf.js's own outline", () => {
  it("one section per distinct bookmark page; the pages before the first bookmark are not a section", async () => {
    const bytes = await fixture();
    const viewer = await viewerTopLevel(bytes);
    // Positive control: the viewer reads the outline the fixture wrote,
    // including the URL bookmark (no page) and the named destination.
    expect(viewer).toEqual([
      { title: "Introduction", page: 3 },
      { title: "Website", page: null },
      { title: "Chapter Five", page: 5 },
      { title: "Chapter Five again", page: 5 },
      { title: "Methods", page: 4 },
    ]);
    const sections = await readSummarySections(bytes);
    expect(sections).toEqual(expectedFrom(viewer, 7));
    expect(sections).toEqual([
      { title: "Introduction", span: [3, 3] },
      { title: "Methods", span: [4, 4] },
      { title: "Chapter Five", span: [5, 7] },
    ]);
    // Health: no section starts on page 1 or 2.
    expect(sections.every(({ span }) => span[0] >= 3)).toBe(true);
  });

  it("a PDF with no outline, or bytes that are not a PDF, give no sections", async () => {
    expect(
      await readSummarySections(await (await blankPages(3)).save()),
    ).toEqual([]);
    expect(await readSummarySections(new Uint8Array([1, 2, 3]))).toEqual([]);
  });

  it("a bookmark on page 1 makes the first section start there", () => {
    expect(
      summarySections(
        [
          { title: "A", pageIndex: 0 },
          { title: "B", pageIndex: 2 },
        ],
        4,
      ),
    ).toEqual([
      { title: "A", span: [1, 2] },
      { title: "B", span: [3, 4] },
    ]);
  });

  it(`offers at most ${MAX_SUMMARY_SECTIONS} sections, in page order`, () => {
    const many = Array.from({ length: 150 }, (_, i) => ({
      title: `S${150 - i}`,
      pageIndex: 149 - i,
    }));
    const sections = summarySections(many, 150);
    expect(sections).toHaveLength(MAX_SUMMARY_SECTIONS);
    expect(sections[0]).toEqual({ title: "S1", span: [1, 1] });
    expect(sections[99]!.span).toEqual([100, 100]);
  });
});

describe("cleanSectionTitle", () => {
  it("removes control characters and collapses whitespace", () => {
    expect(cleanSectionTitle(`  Part${BEL}One${CSI}\n\tTwo  `, 4)).toBe(
      "Part One Two",
    );
  });
  it("an empty or all-control title names its page", () => {
    expect(cleanSectionTitle(`${BEL} `, 9)).toBe("Bookmark on page 9");
  });
  it(`cuts at ${MAX_SECTION_TITLE} characters with an ellipsis`, () => {
    const long = "x".repeat(200);
    const cut = cleanSectionTitle(long, 1);
    expect([...cut]).toHaveLength(MAX_SECTION_TITLE);
    expect(cut.endsWith(String.fromCharCode(0x2026))).toBe(true);
    expect(cleanSectionTitle("y".repeat(MAX_SECTION_TITLE), 1)).toBe(
      "y".repeat(MAX_SECTION_TITLE),
    );
  });
});

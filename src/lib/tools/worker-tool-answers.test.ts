// @vitest-environment node
/**
 * The secure-worker tool pages, held to what their engines write.
 *
 * WHAT SHIPPED (audited at 67e8d0f, on production):
 *
 *  - PDF to Word said "Editable DOCX from any PDF" and "while preserving layout
 *    and text flow", and its guide said so five times — over an engine that
 *    writes one unstyled paragraph per line of selectable text and refuses a
 *    PDF with none.
 *  - PDF to Excel said "Convert tables … with rows and columns intact" over an
 *    engine that detects no tables: it splits each line at tabs, runs of
 *    spaces and COMMAS, so "1,250" lands in two cells.
 *  - Request Signatures said "Collect legally-binding e-signatures" and "Send a
 *    document to others, track status" — on its own card, on Sign PDF's related
 *    card and in the Sign guide — over an engine that prepares a package, with
 *    no e-signature provider wired, that sends nothing and tracks nothing.
 *  - PDF to Word, Excel, PowerPoint, PDF/A, Repair, Request Signatures and
 *    PowerPoint to PDF answered only the two templated worker questions;
 *    Translate's page named none of its languages in the HTML Google indexes.
 *
 * Every new answer on those pages is checked here against the ENGINE, run —
 * DOCX paragraphs, XLSX cells and sheet names, PPTX slides and a real
 * signature-request ZIP decoded; the repair floor fed a truncated file and
 * rubble; Ghostscript's argv read for the PDF/A part; the Office extension
 * check and the URL check asked directly — and the page is read as SERVED
 * (`renderToolPages`), not as `toolFaq` returns it.
 *
 * The two shipped overclaims get a ban each, with the shipped sentences as the
 * corpus in both directions. Neither ban has an automatic exit: the property
 * that would lift the sending ban is "pdf.xyz delivers a request to a signer",
 * and no configuration flag is that property.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument, PDFTextField } from "pdf-lib";
import { tools, getToolBySlug } from "@/lib/tools";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import {
  XLSX_CELL_BREAK_PHRASE,
  XLSX_NUMBER_EXAMPLES,
  XLSX_SHEET_NAME,
  XLSX_TEXT_EXAMPLE,
} from "@/lib/jobs/pdf-office-export";
import { PDF_A_STANDARD, buildPdfAResultMeta } from "@/lib/jobs/pdfa-results";
import { MAX_TOOL_NOTES } from "@/lib/jobs/tool-notes";
import {
  MAX_REQUEST_SIGNERS,
  REQUEST_PACKAGE_FILES,
  signatureBlockFields,
  type SignatureRequestOptions,
} from "@/lib/jobs/request-signatures";
import { LANGUAGE_NAMES, TRANSLATE_LANGUAGES } from "@/lib/jobs/translate-pdf";
import { isSafePublicHttpUrl } from "@/lib/jobs/validation";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { applyFormValues } from "@/lib/pdf/forms";
import {
  PDF_OFFICE_EXPORT_TOOLS,
  runPdfOfficeExport,
  type PdfFlowExtractor,
  type PdfOfficeExportTool,
} from "@/lib/workers/pdf-office-export/engine";
import { readDocxParagraphs } from "@/lib/workers/pdf-office-export/docx-text";
import { cellsByRef, readXlsxSheet } from "@/lib/workers/ooxml/sheet-read";
import { MAX_SIGNIFICANT_DIGITS } from "@/lib/workers/ooxml/sheet-cells";
import { flowText, type PdfFlowText } from "@/lib/workers/pdf-text/flow";
import { parseBboxFlow, parseBboxLayout } from "@/lib/workers/pdf-text/parse";
import { PdfTextExecError } from "@/lib/workers/pdf-text/errors";
import {
  buildTablesZip,
  detectTablesOnPage,
  runTableExtract,
} from "@/lib/workers/table-extract/engine";
import {
  REPORT_TABLES_BBOX,
  TABLE_BBOX,
  TWO_COLUMN_BBOX,
} from "@/tests/poppler-samples";
import { REPORT_TABLES } from "@/tests/table-extract-fixtures";
import {
  LEFT_COLUMN,
  RIGHT_COLUMN,
  TABLE_ROWS,
} from "@/tests/pdf-office-fixtures";
import { runSignatureRequest } from "@/lib/workers/request-signatures/engine";
import { signatureRequestDeps } from "@/lib/workers/request-signatures/native";
import { ghostscriptPdfAArgs } from "@/lib/workers/pdf-archive/native";
import { runRepair } from "@/lib/workers/pdf-structure/engine";
import {
  OFFICE_TO_PDF_TOOLS,
  supportsOfficeInput,
} from "@/lib/workers/office-conversion/engine";
import { guides } from "@/lib/guides/catalog";
import type { Guide } from "@/lib/guides/types";
import {
  OFFICE_TO_PDF_SLUGS,
  PDF_TO_WORD_KEEPS,
  PRIVATE_ADDRESS_EXAMPLES,
  REPAIR_TAKES,
  TRANSLATE_LANGUAGES_ANSWER,
} from "./tool-facts";
import { withoutComments } from "./copy-surface";
import { pageDescription, pageIntro } from "./page-copy";
import {
  renderToolPages,
  type RenderedToolPage,
} from "@/tests/rendered-tool-pages";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

let pages: Map<string, RenderedToolPage>;
beforeAll(() => {
  pages = renderToolPages();
}, 180_000);

function page(slug: string): RenderedToolPage {
  const p = pages.get(slug);
  if (!p) throw new Error(`${slug} was not rendered`);
  return p;
}

/** The served answer to the question matching `question` on `slug`'s page. */
function answer(slug: string, question: RegExp): string {
  const entry = page(slug).faq.find((e) => question.test(e.question));
  if (!entry) {
    throw new Error(
      `${slug}: the served page asks nothing matching ${question}`,
    );
  }
  return entry.answer;
}

function guideStrings(guide: Guide): string[] {
  return [
    guide.title,
    guide.description,
    ...guide.intro,
    ...guide.steps,
    ...guide.sections.flatMap((s) => [s.heading, ...s.body]),
    ...guide.faq.flatMap((f) => [f.question, f.answer]),
  ];
}

/* ------------------------------------------------------------------ *
 *  PDF → Word / Excel / PowerPoint: run the engine, decode the file
 * ------------------------------------------------------------------ */

function extracted(pagesText: readonly string[]): ExtractedPdfText {
  const text = pagesText.join("\n");
  return {
    pageCount: pagesText.length,
    pages: pagesText.map((t, i) => ({
      pageNumber: i + 1,
      text: t,
      characterCount: t.length,
    })),
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
}

/**
 * The same pages as PDF to Word's reading-order input: each non-blank line a
 * one-cell paragraph. For tests about the package, not about paragraphs —
 * those read REAL poppler output through {@link flowOf}.
 */
function linesAsFlow(pagesText: readonly string[]): PdfFlowText {
  return {
    pageCount: pagesText.length,
    pages: pagesText.map((t, i) => ({
      pageNumber: i + 1,
      paragraphs: t
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => [l]),
    })),
  };
}

/** A flow extractor serving poppler's own `-bbox-layout` output, parsed. */
function flowOf(xhtml: string): PdfFlowExtractor {
  return async () => flowText(parseBboxFlow(xhtml));
}

/**
 * Run an export with both extractors wired, as production wires them: Excel
 * and PowerPoint read `extract`, Word reads `extractFlow` (since the wave-1
 * L03 merge; without it Word answers `unsupported`).
 */
async function exportRun(
  tool: PdfOfficeExportTool,
  pagesText: readonly string[],
  extractFlow: PdfFlowExtractor = async () => linesAsFlow(pagesText),
): Promise<Uint8Array> {
  const run = await runPdfOfficeExport(tool, new Uint8Array([1]), {
    extract: async () => extracted(pagesText),
    extractFlow,
  });
  if (!run.ok) throw new Error(`${tool}: ${run.message}`);
  return run.output;
}

async function exportFile(
  tool: PdfOfficeExportTool,
  pagesText: readonly string[],
  extractFlow?: PdfFlowExtractor,
): Promise<JSZip> {
  return JSZip.loadAsync(await exportRun(tool, pagesText, extractFlow));
}

const part = async (zip: JSZip, name: string) => {
  const file = zip.file(name);
  if (!file) throw new Error(`no ${name} in the package`);
  return file.async("string");
};

/**
 * What a DOCX would need to carry more than plain paragraphs of text: the body
 * markup for images, tables, character formatting and paragraph layout, and the
 * parts that would hold images, styles and a theme.
 */
const RICH_MARKUP = ["<w:drawing", "<w:tbl", "<w:rPr", "<w:pPr"] as const;
const RICH_PART = /media\/|styles\.xml|theme/;

/** Every piece of {@link RICH_MARKUP} in the body, and every rich part's name. */
async function richContentIn(zip: JSZip): Promise<string[]> {
  const doc = await part(zip, "word/document.xml");
  return [
    ...RICH_MARKUP.filter((tag) => doc.includes(tag)),
    ...Object.keys(zip.files).filter((name) => RICH_PART.test(name)),
  ];
}

describe("PDF to Word: the DOCX is the page's sentence", () => {
  /*
   * HISTORY: this was "each line becomes a paragraph", true of the engine
   * until the wave-1 L03 merge (2026-09-28), which made Word read poppler's
   * reading order. Each clause of the new sentence is paired below with the
   * engine run that makes it true, on poppler's REAL output for a real PDF
   * (`poppler-samples.ts`), read back out of the DOCX a user downloads.
   */
  it("reading order, wrapped lines joined, one column at a time, table rows tabbed — and nothing but text", async () => {
    const twoColumns = await exportRun(
      "pdf-to-word",
      [""],
      flowOf(TWO_COLUMN_BBOX),
    );
    expect(PDF_TO_WORD_KEEPS).toContain(
      "lines that wrap in the PDF are joined",
    );
    expect(PDF_TO_WORD_KEEPS).toContain("read one column at a time");
    // The left column's three printed lines are ONE paragraph, and all of it
    // comes before any of the right column.
    expect(await readDocxParagraphs(twoColumns)).toEqual([
      "Quarterly Report",
      LEFT_COLUMN.join(" "),
      RIGHT_COLUMN.join(" "),
    ]);

    const table = await exportRun("pdf-to-word", [""], flowOf(TABLE_BBOX));
    expect(PDF_TO_WORD_KEEPS).toContain("its cells separated by tabs");
    expect(await readDocxParagraphs(table)).toEqual(
      TABLE_ROWS.map((row) => row.join("\t")),
    );

    // Images, tables, fonts/colors, layout: none of their markup, none of the
    // parts that would carry them — in either real export.
    for (const bytes of [twoColumns, table])
      expect(await richContentIn(await JSZip.loadAsync(bytes))).toEqual([]);
    expect(answer("pdf-to-word", /keep/i)).toContain(PDF_TO_WORD_KEEPS);
  });

  /*
   * HISTORY: the first control built a string literal holding `<w:rPr` and
   * asserted the literal contained `<w:rPr`. It never went through the
   * detector, so it passed whatever the detector or the engine did — a control
   * that cannot fail. This one hands the SAME function a real DOCX package —
   * the engine's own output, re-zipped with one of each rich thing added — and
   * requires it to report every one.
   */
  it("positive control: the detector reports each rich thing in a real DOCX", async () => {
    const zip = await exportFile("pdf-to-word", ["Quarterly report"]);
    const doc = await part(zip, "word/document.xml");
    const rich =
      `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>` +
      `<w:r><w:drawing/></w:r></w:p>` +
      `<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>`;
    expect(doc, "the engine's body moved").toContain("<w:sectPr/>");
    zip.file(
      "word/document.xml",
      doc.replace("<w:sectPr/>", `${rich}<w:sectPr/>`),
    );
    zip.file("word/media/image1.png", new Uint8Array([0x89, 0x50]));
    zip.file("word/styles.xml", "<w:styles/>");
    zip.file("word/theme/theme1.xml", "<a:theme/>");
    // Through bytes and back, so the detector reads a package, not an object.
    const reread = await JSZip.loadAsync(
      await zip.generateAsync({ type: "uint8array" }),
    );
    const found = await richContentIn(reread);
    for (const tag of RICH_MARKUP) expect(found, tag).toContain(tag);
    for (const name of [
      "word/media/image1.png",
      "word/styles.xml",
      "word/theme/theme1.xml",
    ]) {
      expect(found, name).toContain(name);
    }
  });
});

describe("PDF to Excel: the sheet is the page's sentence", () => {
  /*
   * HISTORY: until the wave-1 L03 merge (2026-09-28) the engine split each
   * line on a regex (`\t| {2,}|,`) this file checked the phrase against, and
   * wrote every cell as text; the page said "1,250" lands in two cells and
   * "nothing is converted to a number". L03 placed cells by position and typed
   * amounts. The regex is gone, so the phrase is now held to the ENGINE: each
   * candidate break is run, and the phrase must name exactly the ones that
   * split. The two tests that pinned the old answers are inverted below.
   */
  const BREAKS = [
    { word: "tabs", line: "a\tb" },
    { word: "two or more spaces", line: "a  b" },
    { word: "comma", line: "a,b" },
    { word: "single space", line: "a b" },
  ];

  async function sheetOf(lines: readonly string[]) {
    return readXlsxSheet(await exportRun("pdf-to-excel", [lines.join("\n")]));
  }
  async function cells(line: string): Promise<string[]> {
    return (await sheetOf([line])).rows.flatMap((r) =>
      r.cells.map((c) => c.value),
    );
  }

  it("the phrase names exactly the breaks the engine makes", async () => {
    let splitting = 0;
    for (const { word, line } of BREAKS) {
      const splits = (await cells(line)).length > 1;
      if (splits) {
        splitting += 1;
        expect(await cells(line), line).toEqual(["a", "b"]);
      }
      expect(XLSX_CELL_BREAK_PHRASE.includes(word), word).toBe(splits);
    }
    // Health: some break splits and some does not, so neither direction of
    // the equality above is vacuous.
    expect(splitting).toBeGreaterThan(0);
    expect(splitting).toBeLessThan(BREAKS.length);
    expect(answer("pdf-to-excel", /lay out/i)).toContain(
      XLSX_CELL_BREAK_PHRASE,
    );
  });

  it("INVERTED: a comma no longer splits a cell, and the named amounts are numbers", async () => {
    // Was: `cells("1,250")` equals ["1", "250"], and the page said so.
    const served = answer("pdf-to-excel", /lay out/i);
    expect(served).toContain("A comma never splits a cell");
    for (const example of XLSX_NUMBER_EXAMPLES) {
      const sheet = await sheetOf([`Total    ${example}`]);
      const value = sheet.rows[0]!.cells[1];
      expect(value?.type, example).toBe("number");
      expect(served, example).toContain(example);
    }
    // …and the text the page says stays text does.
    for (const stays of [XLSX_TEXT_EXAMPLE, "=SUM(B1)"]) {
      const sheet = await sheetOf([`Date    ${stays}`]);
      expect(sheet.rows[0]!.cells[1]?.type, stays).toBe("text");
      expect(sheet.rows[0]!.cells[1]?.value, stays).toBe(stays);
    }
    expect(served).toContain(XLSX_TEXT_EXAMPLE);
  });

  it("what the page says stays text stays text, and the digit limit is the writer's", async () => {
    // The authored "Will SUM work on my numbers?" answer names the shapes
    // that stay text; each is run, and the digit limit has a control on
    // both sides of it.
    const served = answer("pdf-to-excel", /SUM/);
    const STAYS_TEXT = [
      XLSX_TEXT_EXAMPLE,
      "1.250,00",
      "(1,250.00)",
      "00123",
      "1".repeat(MAX_SIGNIFICANT_DIGITS + 1),
    ];
    for (const value of STAYS_TEXT) {
      const sheet = await sheetOf([`Ref    ${value}`]);
      expect(sheet.rows[0]!.cells[1], value).toMatchObject({
        type: "text",
        value,
      });
    }
    const longest = "1".repeat(MAX_SIGNIFICANT_DIGITS);
    expect((await sheetOf([`Ref    ${longest}`])).rows[0]!.cells[1]?.type).toBe(
      "number",
    );
    for (const said of [
      XLSX_TEXT_EXAMPLE,
      "1.250,00",
      "negatives in brackets",
      "leading zeros",
      `${MAX_SIGNIFICANT_DIGITS} significant digits`,
      ...XLSX_NUMBER_EXAMPLES,
    ])
      expect(served, said).toContain(said);
  });

  it("an empty cell stays in its column, as the page says", async () => {
    const sheet = await sheetOf([
      "Item      Qty      Price",
      "Pear               4.00",
    ]);
    const pear = sheet.rows[1]!.cells.map((c) => [c.ref, c.value]);
    expect(pear).toEqual([
      ["A2", "Pear"],
      ["C2", "4.00"],
    ]);
    expect(answer("pdf-to-excel", /lay out/i)).toContain(
      "an empty cell stays empty",
    );
  });

  it("one sheet, with the name the page gives it", async () => {
    const zip = await exportFile("pdf-to-excel", ["x,1\ny,2"]);
    const workbook = await part(zip, "xl/workbook.xml");
    const names = [...workbook.matchAll(/<sheet name="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(names).toEqual([XLSX_SHEET_NAME]);
    expect(answer("pdf-to-excel", /lay out/i)).toContain(
      `“${XLSX_SHEET_NAME}”`,
    );
    // INVERTED: this also required every cell to be text ("inlineStr"),
    // pinning a sheet whose SUM over an invoice returned 0. What is text and
    // what is a number is now asserted, value by value, above.
  });
});

describe("Extract Tables: tables.xlsx is the page's numbers answer", () => {
  it("each value the page calls a number is one in the workbook, and each it calls text stays text", async () => {
    const served = answer("extract-tables", /numbers/i);
    const NUMBERS = [...XLSX_NUMBER_EXAMPLES, "-4"];
    const TEXT = [
      "00123",
      "1.250,00",
      XLSX_TEXT_EXAMPLE,
      "(1,250.00)",
      "1".repeat(MAX_SIGNIFICANT_DIGITS + 1),
    ];
    const values = [...NUMBERS, ...TEXT];
    const zip = await JSZip.loadAsync(
      await buildTablesZip([
        { pageNumber: 1, rows: [["Value"], ...values.map((v) => [v])] },
      ]),
    );
    const sheet = await readXlsxSheet(
      await zip.file("tables.xlsx")!.async("uint8array"),
    );
    const typeOf = new Map(
      sheet.rows.slice(1).map((r, i) => [values[i]!, r.cells[0]?.type]),
    );
    expect(typeOf.size).toBe(values.length);
    for (const v of NUMBERS) {
      expect(typeOf.get(v), v).toBe("number");
      expect(served, v).toContain(v);
    }
    for (const v of TEXT) expect(typeOf.get(v), v).toBe("text");
    for (const said of [
      "00123",
      "1.250,00",
      `${MAX_SIGNIFICANT_DIGITS} significant digits`,
      "bracketed negative",
    ])
      expect(served, said).toContain(said);
  });
});

describe("PDF to PowerPoint: the deck is the page's sentence", () => {
  it("one slide per page, one text box each, one paragraph per line; a textless page is an empty slide", async () => {
    const zip = await exportFile("pdf-to-powerpoint", ["A\nB", "", "C"]);
    const slides = Object.keys(zip.files).filter((n) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(n),
    );
    expect(slides).toHaveLength(3);
    const first = await part(zip, "ppt/slides/slide1.xml");
    expect(first.match(/<p:sp>/g)).toHaveLength(1);
    expect(first.match(/<a:p>/g)).toHaveLength(2);
    expect(first).not.toContain("<p:pic");
    expect(await part(zip, "ppt/slides/slide2.xml")).not.toContain("<a:t>");
    const served = answer("pdf-to-powerpoint", /slide/i);
    expect(served).toMatch(/One slide per PDF page/);
    expect(served).toMatch(/empty slide/);
  });
});

describe("the three exports refuse a PDF with no text, as each page says", () => {
  it("every export tool is asked, and each refuses", async () => {
    expect(PDF_OFFICE_EXPORT_TOOLS.length).toBeGreaterThanOrEqual(3);
    for (const tool of PDF_OFFICE_EXPORT_TOOLS) {
      const run = await runPdfOfficeExport(tool, new Uint8Array([1]), {
        extract: async () => extracted([""]),
        extractFlow: async () => linesAsFlow([""]),
      });
      expect(run.ok, tool).toBe(false);
      expect(run.ok === false && run.kind, tool).toBe("no_text");
      const served = answer(tool, /scanned/i);
      expect(served, tool).toMatch(/refused/);
      expect(served, tool).toContain("OCR PDF");
    }
  });
});

/* ------------------------------------------------------------------ *
 *  Request Signatures: a real package, unzipped, and filled
 * ------------------------------------------------------------------ */

async function twoPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 500]);
  doc.addPage([400, 500]);
  return doc.save();
}

const REQUEST: SignatureRequestOptions = {
  signers: [
    { name: "Ada Signer", email: "ada@example.com" },
    { name: "Ben Signer", email: "ben@example.com" },
  ],
  fields: [
    {
      signer: 0,
      page: 2,
      type: "signature",
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.05,
      required: true,
    },
    {
      signer: 1,
      page: 2,
      type: "signature",
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.05,
      required: true,
    },
  ],
  routing: "sequential",
  deliver: false,
};

describe("Request Signatures: the download is the page's list", () => {
  it("the package holds exactly the files the page names", async () => {
    const run = await runSignatureRequest(
      await twoPagePdf(),
      REQUEST,
      signatureRequestDeps(),
    );
    if (!run.ok) throw new Error(run.message);
    const zip = await JSZip.loadAsync(run.output);
    const inZip = Object.keys(zip.files).sort();
    expect(inZip).toEqual(Object.values(REQUEST_PACKAGE_FILES).sort());
    const served = answer("request-signatures", /in the download/i);
    for (const name of inZip) expect(served, name).toContain(name);

    // Signers fill the prepared PDF's fields, as the page says — through the
    // Fill Forms engine itself.
    const prepared = await zip
      .file(REQUEST_PACKAGE_FILES.prepared)!
      .async("uint8array");
    const fields = (await PDFDocument.load(prepared)).getForm().getFields();
    expect(fields.length).toBe(REQUEST.fields.length);
    for (const f of fields) expect(f, f.getName()).toBeInstanceOf(PDFTextField);
    const filled = await applyFormValues(
      prepared,
      Object.fromEntries(fields.map((f) => [f.getName(), "Ada Signer"])),
    );
    expect(filled.appliedCount).toBe(fields.length);
    const how = answer("request-signatures", /fill it in/i);
    expect(how).toContain(REQUEST_PACKAGE_FILES.prepared);
    expect(how).toContain("Fill Forms");
    expect(how).toMatch(/text fields, not certified digital signatures/);
  });

  it("nothing is sent: production wires no provider, and asking to send is refused", async () => {
    const deps = signatureRequestDeps();
    expect("delivery" in deps).toBe(false);
    const run = await runSignatureRequest(
      await twoPagePdf(),
      { ...REQUEST, deliver: true },
      deps,
    );
    expect(run.ok === false && run.kind).toBe("delivery_unconfigured");
    const served = answer("request-signatures", /email my signers/i);
    expect(served).toMatch(/^No\./);
    expect(served).toContain(`up to ${MAX_REQUEST_SIGNERS} signers`);
    // The panel's own cap is the same constant, and the optional date field
    // the "Signers" fact mentions is a real choice that places a real field.
    const panel = withoutComments(
      read("src/components/tools/request-signatures-worker-panel.tsx"),
    );
    expect(panel).toMatch(/signers\.length >= MAX_REQUEST_SIGNERS/);
    expect(panel).toContain("Add a date field next to each signature");
    // Since L12 (067e62f) the panel builds the fields with
    // signatureBlockFields(...) instead of pushing them inline, so the date
    // choice is RUN here rather than matched in the panel's source.
    expect(panel).toMatch(
      /signatureBlockFields\(\s*cleanSigners\.length,\s*page,\s*includeDate,?\s*\)/,
    );
    const types = (includeDate: boolean) =>
      signatureBlockFields(2, 1, includeDate).map(
        (f) => `${f.signer}:${f.type}`,
      );
    expect(types(true)).toEqual([
      "0:signature",
      "0:date",
      "1:signature",
      "1:date",
    ]);
    expect(types(false)).toEqual(["0:signature", "1:signature"]);
    expect(page("request-signatures").text).toContain(
      `Up to ${MAX_REQUEST_SIGNERS} per request`,
    );
  });
});

/**
 * The sending claims, as they shipped. Every surface that speaks about
 * Request Signatures is read: its own page as served, every served page that
 * carries its card, and every guide that teaches it.
 */
describe("no copy says Request Signatures sends, tracks or collects", () => {
  const SHIPPED = [
    "Collect legally-binding e-signatures.",
    "Send a document to others, track status, and collect audited e-signatures in order.",
    "When the signature you need is someone else's, use Request Signatures instead — it sends a document to others, tracks status, and collects audited e-signatures in order.",
    "Sign PDF handles your own signature. To collect signatures from others, use the Request Signatures tool, which sends a document to recipients, tracks status, and collects audited e-signatures in order.",
  ];
  const CLAIMS = [
    /\bcollect(?:s|ing)?\b[^.]*\be-signatures\b/i,
    /\bsends?\s+a\s+document\s+to\b/i,
    /\btracks?\s+(?:its\s+|the\s+)?status\b/i,
  ];

  function surfaces(): { where: string; text: string }[] {
    const slug = "request-signatures";
    const out: { where: string; text: string }[] = [
      { where: `${slug} (served)`, text: page(slug).text },
      ...page(slug).faq.map((e) => ({
        where: `${slug} FAQ`,
        text: `${e.question} ${e.answer}`,
      })),
      ...page(slug).howTo.map((s) => ({ where: `${slug} step`, text: s })),
    ];
    for (const tool of tools) {
      if (tool.related?.includes(slug)) {
        out.push({ where: `${tool.slug} (card)`, text: page(tool.slug).text });
      }
    }
    for (const guide of guides) {
      if (guide.tools.includes(slug)) {
        for (const text of guideStrings(guide)) {
          out.push({ where: `guide ${guide.slug}`, text });
        }
      }
    }
    return out;
  }

  it("the corpus and the patterns cover each other", () => {
    for (const s of SHIPPED) {
      expect(
        CLAIMS.some((c) => c.test(s)),
        `no pattern catches: ${s}`,
      ).toBe(true);
    }
    for (const c of CLAIMS) {
      expect(
        SHIPPED.some((s) => c.test(s)),
        `${c} catches nothing shipped`,
      ).toBe(true);
    }
  });

  it("every surface that speaks about it is read, and none claims it", () => {
    const all = surfaces();
    const wheres = new Set(all.map((s) => s.where.split(" ")[0]));
    // Its own page, Sign PDF's card, and the Sign guide at least.
    expect(wheres.size, [...wheres].join(", ")).toBeGreaterThanOrEqual(3);
    const offenders = all.flatMap(({ where, text }) =>
      CLAIMS.filter((c) => c.test(text)).map((c) => `${where}: ${c}`),
    );
    expect(offenders).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 *  The layout claims PDF to Word / Excel shipped
 * ------------------------------------------------------------------ */

describe("no copy promises the Office exports keep a PDF's layout or tables", () => {
  const SHIPPED = [
    "Editable DOCX from any PDF.",
    "Convert PDFs into editable Word documents while preserving layout and text flow.",
    "Extract tables into spreadsheets.",
    "Convert tables inside PDFs into editable Excel spreadsheets with rows and columns intact.",
    "The conversion is built to preserve layout and text flow, so the DOCX follows the structure of the original while staying fully editable.",
    "That is the point of converting rather than copying and pasting: pasted text loses its arrangement on the page, while the converted DOCX carries the layout with it.",
  ];
  const PROMISES = [
    /\bpreserv\w*\s+(?:the\s+)?layout/i,
    /\brows and columns intact\b/i,
    /\bcarr(?:y|ies)\s+the\s+layout\b/i,
    /\btables?\b[^.]*\binto\s+(?:editable\s+)?(?:excel\s+)?spreadsheets?\b/i,
    /\bfrom any PDF\b/i,
  ];

  function surfaces(): { where: string; text: string }[] {
    const out: { where: string; text: string }[] = [];
    for (const slug of PDF_OFFICE_EXPORT_TOOLS) {
      const tool = getToolBySlug(slug)!;
      out.push({ where: `${slug} tagline`, text: tool.tagline });
      out.push({ where: `${slug} description`, text: tool.description });
      // What the page serves around the FAQ since the authored content
      // (seo/content): the meta description and the whole visible page — the
      // intro and use cases under "About this tool" included.
      out.push({ where: `${slug} meta`, text: pageDescription(tool) });
      out.push({ where: `${slug} (served)`, text: page(slug).text });
      for (const e of page(slug).faq) {
        out.push({ where: `${slug} FAQ`, text: `${e.question} ${e.answer}` });
      }
      for (const s of page(slug).howTo) {
        out.push({ where: `${slug} step`, text: s });
      }
      for (const guide of guides) {
        if (!guide.tools.includes(slug)) continue;
        for (const text of guideStrings(guide)) {
          out.push({ where: `guide ${guide.slug}`, text });
        }
      }
    }
    return out;
  }

  it("the corpus and the patterns cover each other", () => {
    for (const s of SHIPPED) {
      expect(
        PROMISES.some((p) => p.test(s)),
        `uncaught: ${s}`,
      ).toBe(true);
    }
    for (const p of PROMISES) {
      expect(
        SHIPPED.some((s) => p.test(s)),
        `${p} catches nothing`,
      ).toBe(true);
    }
  });

  it("the tool pages serve their catalogue copy, and no surface makes the promise", () => {
    // "About this tool" renders the authored intro since seo/content, and the
    // catalogue description only where a tool has none — so the page is held
    // to serving the copy it renders (`pageIntro`), and every surface above,
    // the served page among them, is scanned for the promise.
    for (const slug of PDF_OFFICE_EXPORT_TOOLS) {
      for (const paragraph of pageIntro(getToolBySlug(slug)!))
        expect(page(slug).text).toContain(paragraph);
    }
    const all = surfaces();
    expect(all.length).toBeGreaterThan(20);
    const offenders = all.flatMap(({ where, text }) =>
      PROMISES.filter((p) => p.test(text)).map((p) => `${where}: ${p}`),
    );
    expect(offenders).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 *  The table pages describing engines that were replaced under them
 * ------------------------------------------------------------------ */

/**
 * PDF to Excel and Extract Tables were both REWRITTEN under their pages.
 * PDF to Excel stopped splitting at commas and started placing values by
 * column and storing amounts as numbers (wave-1 L03, 2026-09-28); Extract
 * Tables stopped treating a page as one grid built from word left edges
 * (2026-09-27). Each page's derived FAQ was updated and held to the engine
 * above — and the AUTHORED copy around it (meta description, intro, use
 * cases, steps, FAQ) kept describing the old engines, contradicting the
 * answer printed under it. Every check above asked the derived answer
 * (`answer(slug, …)`), so none of them read the sentences a reader meets
 * first (house rule 5). Audited at 028d3a10.
 *
 * The SHIPPED sentences are the corpus, both ways. Each claim is also RUN:
 * the engine is asked to do what the sentence says and must not, so the ban
 * stands on the engine's behaviour, not on this list. The exit condition is
 * that property — if an engine starts doing one of these again, its
 * `refute` goes red here, and the sentence may be true again; nothing else
 * lifts a ban.
 */
describe("no table page describes the replaced comma split, text-only cells or whole-page grid", () => {
  const SHIPPED = [
    "Export the text layer of a PDF to an XLSX sheet: one row per line, new cells at tabs, commas and wide gaps.",
    "Each non-empty line becomes one spreadsheet row, cut into cells wherever it has a tab, a comma, or a run of two or more spaces; a single space never starts a new cell.",
    "Ruling lines and cell borders are ignored, merged cells are not rebuilt, and every value is stored as text.",
    'The comma rule cuts both ways: comma-separated values split neatly, but an amount printed as 1,250.00 becomes two cells, and so does "Doe, Jane".',
    "Lines of comma-separated values come back as columns you can sort and filter.",
    "A value that itself contains a comma, such as a quoted address, is split too.",
    "Money columns with thousands separators suit Extract Tables better.",
    "Convert number columns from text before summing, delete rows that came from page headers and footers, and check any row that had a blank field.",
    "Only when every row has a value in every column.",
    "A blank cell is not written as an empty cell, so the values after it move one column left and land under the wrong heading.",
    "Why does SUM return zero on my numbers?",
    "Every cell is written as text, figures and dates included, so the spreadsheet treats them as labels until you convert the column to numbers.",
    "PDF to Excel converts every line and splits it at gaps and commas, with no idea where a table starts.",
    "Extract Tables lays each page's words into a grid by their position, skips any page whose grid is mostly empty, and hands back a ZIP holding a CSV per table and one workbook with a sheet for each.",
    "It finds at most one table per page, so a page that mixes a table with paragraphs may be skipped or have the paragraphs in the grid.",
    "If only some pages are scans, the export succeeds and those pages add no rows, with nothing marking the gap.",
    "An open-password PDF fails with a general export error that does not mention the password, since this page has no password field; take it through Unlock PDF, which asks for that password, and convert the copy it returns.",
    "Columns stop at Z: when one line splits into more cells than there are letters from A to Z, the extra cells are all written to column Z of that row, and desktop Microsoft Excel then refuses to open the whole workbook, not just that row.",
    "Lines of prose with many commas can trip this as easily as a wide table.",
    "Turns each grid-like page of a text-based PDF into its own CSV file and Excel sheet, placing words by position on the page.",
    "Extract Tables reads the position of every word on a page, puts words that sit on the same line into one row and words whose left edges line up into one column, and keeps the page only if the result looks like a grid: at least two rows and two columns with two or more filled cells each, and at least half of all cells filled.",
    "The whole page is treated as a single grid, so a heading or footnote becomes an extra row, its words can open extra columns, and two tables on one page come out as one.",
    "A multi-page appendix yields one numbered CSV and one sheet per qualifying page, and each sheet name carries the page number, so every result can be traced back to where it came from.",
    "A scan with no text, or a file where no page forms a grid, shows an error beneath the button in place of a result.",
    "Compare each sheet with the page named in its tab, delete rows that came from headings or notes, and rejoin words split across columns.",
    "Extract Tables places each word by position, so 1,250.00 stays whole and an empty cell stays empty, but a description spreads over several columns; it also skips pages that do not form a grid and gives each qualifying page its own sheet and CSV.",
    "Why are words from one cell spread over several columns?",
    "Columns are built from the left edge of each individual word.",
    "Every word on the page goes into the grid, not just the table.",
    "Paragraphs, address blocks and long captions add many sparsely filled rows and columns, and once fewer than half of all cells hold text the page is rejected.",
    "Each page is analysed on its own, so a table spanning three pages comes out as up to three CSV files and three sheets, one for each page that passes the grid test, and a header row the PDF repeats on each page is repeated in each sheet too.",
    "Every cell in tables.xlsx is stored as a text string, so currency symbols, thousands separators and leading zeros survive, but nothing can be summed until you convert it, for example with Excel's Convert to Number.",
    "By where the text sits: it groups the PDF's selectable text into rows and columns by position, and keeps a grid only where columns and rows line up and most of its cells hold text.",
  ];

  /** A sentence's clauses: what one claim can be made in. */
  const clauses = (text: string) => text.split(/(?<=[.;:!?])\s+/);

  /** One run of PDF to Excel on `lines`, decoded. */
  async function excel(lines: readonly string[]) {
    return readXlsxSheet(await exportRun("pdf-to-excel", [lines.join("\n")]));
  }
  const excelCells = async (line: string) =>
    (await excel([line])).rows.flatMap((r) => r.cells);

  /** Extract Tables on poppler's real words for the report page. */
  const reportLayout = () => parseBboxLayout(REPORT_TABLES_BBOX);

  interface Claim {
    readonly says: string;
    readonly pattern: RegExp;
    /** Run the engine; it must NOT do what `says` says. */
    readonly refute: () => Promise<void>;
  }

  const commaSplits = async () => {
    for (const line of ["a,b", "Doe, Jane", "1,250.00"])
      expect(await excelCells(line), line).toHaveLength(1);
    // Control: the same probe sees a split where the engine makes one.
    expect(await excelCells("a  b")).toHaveLength(2);
  };
  const textOnly = async () => {
    const [, amount] = (await excel(["Total    1,250.00"])).rows[0]!.cells;
    expect(amount).toMatchObject({ type: "number", value: "1250.00" });
    const run = await runTableExtract(new Uint8Array([1]), {
      extractLayout: async () => reportLayout(),
    });
    if (!run.ok) throw new Error(run.message);
    const zip = await JSZip.loadAsync(run.output);
    const sheet = cellsByRef(
      await readXlsxSheet(await zip.file("tables.xlsx")!.async("uint8array")),
    );
    expect(sheet.get("D2")).toMatchObject({ type: "number", value: "5400.00" });
    // Control: the reader sees text where the writer writes text.
    expect(sheet.get("A2")).toMatchObject({
      type: "text",
      value: "North America",
    });
  };
  const blankShifts = async () => {
    const sheet = await excel([
      "Item      Qty      Price",
      "Pear               4.00",
    ]);
    expect(sheet.rows[1]!.cells.map((c) => c.ref)).toEqual(["A2", "C2"]);
  };
  const clampsAtZ = async () => {
    const line = (p: string) =>
      Array.from({ length: 30 }, (_, i) => `${p}${i + 1}`).join("   ");
    const refs = (await excel([line("h"), line("v")])).rows[1]!.cells.map(
      (c) => c.ref,
    );
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs.filter((r) => /^[A-Z]{2}\d/.test(r)).length).toBeGreaterThan(0);
  };
  const wholePageGrid = async () => {
    // A title, a paragraph, two tables with a caption between, a note and a
    // footer, as poppler gives its words: exactly the two tables come back,
    // multi-word cells whole, right-aligned amounts in their header's column.
    const [page] = reportLayout().pages;
    const found = detectTablesOnPage(page!).map((t) => t.rows);
    expect(found).toEqual(REPORT_TABLES.map((t) => t.map((r) => [...r])));
    expect(found.length).toBeGreaterThan(1);
  };
  const silentGaps = async () => {
    const run = await runPdfOfficeExport("pdf-to-excel", new Uint8Array([1]), {
      extract: async () => extracted(["Item  Qty", ""]),
    });
    if (!run.ok) throw new Error(run.message);
    expect(run.coverage.pagesWithoutText).toEqual([2]);
  };
  const generalPasswordError = async () => {
    const run = await runPdfOfficeExport("pdf-to-excel", new Uint8Array([1]), {
      extract: async () => {
        throw new PdfTextExecError({
          exitCode: 1,
          killed: false,
          outputTooLarge: false,
        });
      },
      isEncrypted: async () => true,
    });
    expect(run).toMatchObject({ ok: false, kind: "password_protected" });
    if (!run.ok) expect(run.message).toMatch(/password/i);
  };

  const CLAIMS: Claim[] = [
    {
      says: "a comma starts a new cell",
      pattern: /^(?!.*\bnever\b).*\bcomma/i,
      refute: commaSplits,
    },
    {
      says: "an amount's thousands separator is a reason to go elsewhere",
      pattern: /\bthousands separators?\b.*\b(?:suit|better|splits?)\b/i,
      refute: commaSplits,
    },
    {
      says: "every cell is text",
      pattern: /\b(?:every|all)\s+(?:value|cell)s?\b.*\bas (?:a )?text\b/i,
      refute: textOnly,
    },
    {
      says: "numbers need converting from text",
      pattern: /\bnumber columns from text\b/i,
      refute: textOnly,
    },
    {
      says: "SUM returns zero",
      pattern: /\bSUM returns? (?:zero|0)\b/i,
      refute: textOnly,
    },
    {
      says: "a blank cell moves the values after it",
      pattern: /\b(?:moves?|shifts?)\b.*\bleft\b/i,
      refute: blankShifts,
    },
    {
      says: "rows line up only when no cell is blank",
      pattern: /\bevery row has a value in every column\b/i,
      refute: blankShifts,
    },
    {
      says: "columns clamp at Z",
      pattern: /\bcolumn Z\b|\bstops? at Z\b/i,
      refute: clampsAtZ,
    },
    {
      says: "a partly scanned PDF's missing pages go unmarked",
      pattern: /\bnothing mark(?:s|ing)\b/i,
      refute: silentGaps,
    },
    {
      says: "a locked PDF gets a general error",
      pattern: /\b(?:general|generic)\s+(?:export\s+)?error\b/i,
      refute: generalPasswordError,
    },
    {
      says: "a page is the unit of a table",
      pattern: /\b(?:grid-like|qualifying)\s+pages?\b/i,
      refute: wholePageGrid,
    },
    {
      says: "at most one table per page",
      pattern: /\bat most one table per page\b/i,
      refute: wholePageGrid,
    },
    {
      says: "the page is one grid",
      pattern: /\bsingle grid\b|\bevery word on the page goes into the grid\b/i,
      refute: wholePageGrid,
    },
    {
      says: "a page passes or forms the grid",
      pattern:
        /\bpages?\b(?:\s+that)?\s+(?:passes|pass|forms?)\s+(?:a|the)\s+grid\b/i,
      refute: wholePageGrid,
    },
    {
      says: "a fill ratio decides",
      pattern:
        /\bhalf of (?:all )?(?:the )?cells\b|\bmost of its cells\b|\bmostly empty\b/i,
      refute: wholePageGrid,
    },
    {
      says: "columns come from left edges",
      pattern: /\bleft edges?\b/i,
      refute: wholePageGrid,
    },
    {
      says: "a cell's words spread over columns",
      pattern:
        /\b(?:split|spread)s?\s+(?:over|across)\s+(?:several\s+)?columns\b/i,
      refute: wholePageGrid,
    },
  ];

  const caught = (pattern: RegExp, text: string) =>
    clauses(text).some((c) => pattern.test(c));

  function surfaces(): { where: string; text: string }[] {
    const out: { where: string; text: string }[] = [];
    for (const slug of ["pdf-to-excel", "extract-tables"]) {
      out.push({
        where: `${slug} meta`,
        text: pageDescription(getToolBySlug(slug)!),
      });
      out.push({ where: `${slug} (served)`, text: page(slug).text });
      for (const e of page(slug).faq)
        out.push({ where: `${slug} FAQ`, text: `${e.question} ${e.answer}` });
      for (const s of page(slug).howTo)
        out.push({ where: `${slug} step`, text: s });
      for (const guide of guides) {
        if (!guide.tools.includes(slug)) continue;
        for (const text of guideStrings(guide))
          out.push({ where: `guide ${guide.slug}`, text });
      }
    }
    return out;
  }

  it("the corpus and the patterns cover each other", () => {
    for (const s of SHIPPED)
      expect(
        CLAIMS.some((c) => caught(c.pattern, s)),
        `uncaught: ${s}`,
      ).toBe(true);
    for (const { says, pattern } of CLAIMS)
      expect(
        SHIPPED.some((s) => caught(pattern, s)),
        `${says}: ${pattern} catches nothing shipped`,
      ).toBe(true);
    // The comma claim lets a NEGATED comma through, and only that: the
    // sentences the pages now serve pass, and their un-negated twins do not.
    const comma = CLAIMS[0]!.pattern;
    expect(caught(comma, "A comma never splits a cell.")).toBe(false);
    expect(caught(comma, "A comma splits a cell.")).toBe(true);
  });

  for (const { says, refute } of CLAIMS)
    it(`the engine does not do it: ${says}`, refute);

  it("no surface either page serves makes one of the claims", () => {
    const all = surfaces();
    // Health: both pages, as served, with their FAQs and steps.
    expect(all.length).toBeGreaterThan(20);
    for (const slug of ["pdf-to-excel", "extract-tables"])
      expect(page(slug).text.length, slug).toBeGreaterThan(3000);
    const offenders = all.flatMap(({ where, text }) =>
      clauses(text).flatMap((clause) =>
        CLAIMS.filter((c) => c.pattern.test(clause)).map(
          (c) => `${where}: [${c.says}] ${clause}`,
        ),
      ),
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 *  Repair, PDF/A, Office → PDF, Translate, Webpage
 * ------------------------------------------------------------------ */

describe("Repair PDF takes what its page says, and returns no rubble", () => {
  const PDF_HEAD = new TextEncoder().encode(
    "%PDF-1.7\n1 0 obj\n<< /Type /Catalog",
  );
  const truncated = new Uint8Array([
    ...PDF_HEAD,
    ...new TextEncoder().encode(" /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Ty"),
  ]);
  const goodPdf = async () => {
    const d = await PDFDocument.create();
    d.addPage();
    return d.save();
  };

  it("a truncated file is taken in; a non-PDF is refused; rubble is not handed back", async () => {
    let called = 0;
    const repaired = await runRepair(truncated, {
      qpdf: {
        repair: async () => {
          called += 1;
          return { bytes: await goodPdf(), warnings: ["xref rebuilt"] };
        },
        linearize: async () => ({ bytes: new Uint8Array(), warnings: [] }),
      },
    });
    expect(called).toBe(1);
    expect(repaired.ok).toBe(true);
    expect(repaired.ok && repaired.meta.recoveredWithWarnings).toBe(true);

    const refused = await runRepair(
      new TextEncoder().encode("this is a text file, not a PDF at all....."),
      {
        qpdf: {
          repair: async () => ({ bytes: await goodPdf(), warnings: [] }),
          linearize: async () => ({ bytes: new Uint8Array(), warnings: [] }),
        },
      },
    );
    expect(refused.ok === false && refused.kind).toBe("invalid_pdf");

    const rubble = await runRepair(truncated, {
      qpdf: {
        repair: async () => ({
          bytes: new TextEncoder().encode("not a pdf"),
          warnings: [],
        }),
        linearize: async () => ({ bytes: new Uint8Array(), warnings: [] }),
      },
    });
    expect(rubble.ok).toBe(false);
    expect(answer("repair-pdf", /damaged files/i)).toBe(REPAIR_TAKES);
  });
});

describe("PDF to PDF/A names the part Ghostscript is asked for", () => {
  it("the page's standard is the -dPDFA part in the argv", () => {
    const m = /^PDF\/A-(\d)([abu])$/.exec(PDF_A_STANDARD);
    expect(m, PDF_A_STANDARD).not.toBeNull();
    // L13 (75d7a4b) added the PDF/A definition file and ICC profile paths;
    // the part flag this checks does not depend on them.
    expect(
      ghostscriptPdfAArgs("in.pdf", "out.pdf", "PDFA_def.ps", "srgb.icc"),
    ).toContain(`-dPDFA=${m![1]}`);
    const served = answer("pdf-to-pdfa", /validated/i);
    expect(served).toMatch(/^No\./);
    expect(served).toContain(PDF_A_STANDARD);
    // The panel says the same — no validation step exists to contradict.
    expect(read("src/components/tools/pdf-archive-worker-panel.tsx")).toMatch(
      /We do not validate/,
    );
  });
});

describe("PDF to PDF/A says how much of Ghostscript's report reaches the reader", () => {
  /*
   * HISTORY: the answer said "everything it reports is listed with your
   * download". The notes pass `boundToolNotes` on the way to the job record,
   * which keeps at most MAX_TOOL_NOTES lines, withholds path-like ones, and
   * appends a count of what it dropped — so a conversion reporting more than
   * that was never listed in full.
   */
  it("a report longer than the bound is cut to it, with a count, and the page says so", () => {
    const extra = 3;
    const report = Array.from(
      { length: MAX_TOOL_NOTES + extra },
      (_, i) => `note ${i + 1}: cannot be represented in XMP, discarding`,
    );
    const { notes } = buildPdfAResultMeta({ hadNotes: true, notes: report });
    // What the panel receives: the bound, then the count line.
    expect(notes).toHaveLength(MAX_TOOL_NOTES + 1);
    expect(notes.at(-1)).toMatch(new RegExp(`^${extra} further message`));
    const served = answer("pdf-to-pdfa", /remove/i);
    expect(served).toContain(`up to ${MAX_TOOL_NOTES} of its messages`);
    expect(served).toMatch(/count of any it leaves out/);
    expect(served).not.toMatch(/\beverything\b/i);
  });
});

describe("Office → PDF pages name the extensions the worker takes", () => {
  it("the page's set is the engine's set, both ways", () => {
    expect([...OFFICE_TO_PDF_SLUGS].sort()).toEqual(
      [...OFFICE_TO_PDF_TOOLS].sort(),
    );
    const allExts = OFFICE_TO_PDF_TOOLS.flatMap(
      (slug) => getToolBySlug(slug)!.accept,
    ).map((f) => f.toLowerCase());
    for (const slug of OFFICE_TO_PDF_TOOLS) {
      const own = getToolBySlug(slug)!.accept.map((f) => f.toLowerCase());
      expect(own.length).toBeGreaterThan(0);
      const served = answer(slug, /which files/i);
      for (const ext of allExts) {
        const taken = supportsOfficeInput(slug, `file.${ext}`);
        expect(taken, `${slug} .${ext}`).toBe(own.includes(ext));
        if (taken) expect(served, ext).toContain(`.${ext}`);
      }
      expect(supportsOfficeInput(slug, "file.pdf")).toBe(false);
    }
  });
});

describe("Translate PDF's languages are in the HTML Google indexes", () => {
  it("every language, by name, on the served page and in the guide", () => {
    const served = answer("translate-pdf", /languages/i);
    expect(served).toBe(TRANSLATE_LANGUAGES_ANSWER);
    expect(served).toContain(`${TRANSLATE_LANGUAGES.length} languages`);
    for (const code of TRANSLATE_LANGUAGES) {
      expect(served, code).toContain(LANGUAGE_NAMES[code]);
    }
    const guide = guides.find((g) => g.tools[0] === "translate-pdf");
    expect(guide).toBeDefined();
    expect(guide!.faq.map((f) => f.answer)).toContain(served);
    // The panel offers the same list, and the label the answer quotes.
    const panel = read("src/components/tools/translate-worker-panel.tsx");
    expect(panel).toMatch(/TRANSLATE_LANGUAGES\.map/);
    expect(panel).toContain(">Auto-detect<");
  });
});

describe("Webpage to PDF refuses the addresses its page says it refuses", () => {
  it("each named private address, and credentials in the URL, are refused; a public page is not", () => {
    expect(PRIVATE_ADDRESS_EXAMPLES.length).toBeGreaterThan(0);
    const served = answer("webpage-to-pdf", /which pages/i);
    for (const host of PRIVATE_ADDRESS_EXAMPLES) {
      expect(isSafePublicHttpUrl(`http://${host}/`), host).toBe(false);
      expect(served).toContain(host);
    }
    expect(isSafePublicHttpUrl("https://user:secret@example.com/")).toBe(false);
    expect(served).toMatch(/username or password/);
    expect(isSafePublicHttpUrl("https://example.com/")).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 *  Labels a worker page quotes exist in the panel it mounts
 * ------------------------------------------------------------------ */

/**
 * slug → the source of the worker panel `/tools/[slug]` mounts, plus the
 * components that panel imports from its own directory. Resolved from the
 * page's own dispatch (`tool.slug === "…" ? <XWorkerPanel`) and its imports —
 * never a typed list.
 */
function workerPanelSources(): Map<string, string> {
  const pageSrc = read("src/app/tools/[slug]/page.tsx");
  const imports = new Map<string, string>();
  for (const m of pageSrc.matchAll(
    /import\s+\{\s*(\w+)\s*\}\s+from\s+"@\/components\/tools\/([\w-]+)"/g,
  )) {
    imports.set(m[1]!, `src/components/tools/${m[2]}.tsx`);
  }
  const out = new Map<string, string>();
  for (const arm of pageSrc.matchAll(
    /((?:tool\.slug === "[a-z0-9-]+"\s*(?:\|\|\s*)?)+)\?\s*\([\s\S]*?<(\w+WorkerPanel)\b/g,
  )) {
    const file = imports.get(arm[2]!);
    if (!file) throw new Error(`no import resolves ${arm[2]}`);
    const main = read(file);
    const nested = [...main.matchAll(/from\s+"\.\/([\w-]+)"/g)]
      .map((m) => path.join("src/components/tools", `${m[1]}.tsx`))
      .flatMap((rel) => {
        try {
          return [read(rel)];
        } catch {
          return [];
        }
      });
    const source = [main, ...nested].join("\n");
    for (const s of arm[1]!.matchAll(/"([a-z0-9-]+)"/g)) out.set(s[1]!, source);
  }
  return out;
}

describe("every label a worker page quotes exists in the panel it mounts", () => {
  it("resolves plausibly many panels (the walk cannot quietly empty)", () => {
    const panels = workerPanelSources();
    expect(panels.size).toBeGreaterThanOrEqual(15);
    expect(panels.get("request-signatures")).toContain("Add signer");
  });

  it("each quoted label is in the panel's source, or is a name the engine writes", () => {
    const panels = workerPanelSources();
    /** Quoted names that are OUTPUT, verified above by decoding the file. */
    const ENGINE_NAMES = new Set<string>([XLSX_SHEET_NAME]);
    const missing: string[] = [];
    let checked = 0;
    for (const tool of tools) {
      const cap = capabilityForMode(tool.processing);
      if (cap !== "secure-worker" && cap !== "ai") continue;
      const texts = [
        ...page(tool.slug).howTo,
        ...page(tool.slug).faq.map((e) => e.answer),
      ];
      for (const label of texts.flatMap((t) =>
        [...t.matchAll(/“([^”]+)”/g)].map((m) => m[1]!),
      )) {
        if (ENGINE_NAMES.has(label)) continue;
        checked += 1;
        const source = panels.get(tool.slug);
        if (!source?.includes(label)) missing.push(`${tool.slug}: “${label}”`);
      }
    }
    expect(checked, "implausibly few quoted labels").toBeGreaterThanOrEqual(8);
    expect(missing, missing.join("\n")).toEqual([]);
    // Positive control, through the same resolver.
    expect(panels.get("repair-pdf")?.includes("Rotate to landscape")).toBe(
      false,
    );
  });
});

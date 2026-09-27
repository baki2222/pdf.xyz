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
  XLSX_CELL_BREAK,
  XLSX_CELL_BREAK_PHRASE,
  XLSX_SHEET_NAME,
} from "@/lib/jobs/pdf-office-export";
import { PDF_A_STANDARD } from "@/lib/jobs/pdfa-results";
import {
  MAX_REQUEST_SIGNERS,
  REQUEST_PACKAGE_FILES,
  type SignatureRequestOptions,
} from "@/lib/jobs/request-signatures";
import { LANGUAGE_NAMES, TRANSLATE_LANGUAGES } from "@/lib/jobs/translate-pdf";
import { isSafePublicHttpUrl } from "@/lib/jobs/validation";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { applyFormValues } from "@/lib/pdf/forms";
import {
  PDF_OFFICE_EXPORT_TOOLS,
  runPdfOfficeExport,
  type PdfOfficeExportTool,
} from "@/lib/workers/pdf-office-export/engine";
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

async function exportFile(
  tool: PdfOfficeExportTool,
  pagesText: readonly string[],
): Promise<JSZip> {
  const run = await runPdfOfficeExport(tool, new Uint8Array([1]), {
    extract: async () => extracted(pagesText),
  });
  if (!run.ok) throw new Error(`${tool}: ${run.message}`);
  return JSZip.loadAsync(run.output);
}

const part = async (zip: JSZip, name: string) => {
  const file = zip.file(name);
  if (!file) throw new Error(`no ${name} in the package`);
  return file.async("string");
};

describe("PDF to Word: the DOCX is the page's sentence", () => {
  it("each line becomes a paragraph, and nothing but text goes in", async () => {
    const lines = ["Quarterly report", "Revenue rose.", "Costs fell."];
    const zip = await exportFile("pdf-to-word", [lines.join("\n")]);
    const doc = await part(zip, "word/document.xml");
    const paragraphs = [...doc.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map((m) =>
      [...m[1]!.matchAll(/<w:t>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""),
    );
    expect(paragraphs).toEqual(lines);
    // Images, tables, fonts/colors, layout: none of their markup, none of the
    // parts that would carry them.
    for (const tag of ["<w:drawing", "<w:tbl", "<w:rPr", "<w:pPr"]) {
      expect(doc, tag).not.toContain(tag);
    }
    const names = Object.keys(zip.files);
    expect(names.filter((n) => /media\/|styles\.xml|theme/.test(n))).toEqual(
      [],
    );
    expect(answer("pdf-to-word", /keep/i)).toContain(PDF_TO_WORD_KEEPS);
  });

  it("positive control: the detector sees a styled run when one is there", () => {
    const styled = "<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>x</w:t></w:r></w:p>";
    expect(styled).toContain("<w:rPr");
  });
});

describe("PDF to Excel: the sheet is the page's sentence", () => {
  /** Each separator the phrase must name, and a line that exercises it. */
  const SEPARATORS = [
    { word: "tabs", line: "a\tb" },
    { word: "two or more spaces", line: "a  b" },
    { word: "commas", line: "a,b" },
  ];

  async function cells(line: string): Promise<string[]> {
    const zip = await exportFile("pdf-to-excel", [line]);
    const sheet = await part(zip, "xl/worksheets/sheet1.xml");
    return [...sheet.matchAll(/<t>([^<]*)<\/t>/g)].map((m) => m[1]!);
  }

  it("the regex has exactly the alternatives the phrase names", () => {
    expect(XLSX_CELL_BREAK.source.split("|")).toHaveLength(SEPARATORS.length);
  });

  it("every named separator splits a cell, and a single space does not", async () => {
    for (const { word, line } of SEPARATORS) {
      expect(XLSX_CELL_BREAK_PHRASE, word).toContain(word);
      expect(await cells(line), line).toEqual(["a", "b"]);
    }
    expect(await cells("a b")).toEqual(["a b"]);
    // The consequence the page warns about, run.
    expect(await cells("1,250")).toEqual(["1", "250"]);
    const served = answer("pdf-to-excel", /lay out/i);
    expect(served).toContain(XLSX_CELL_BREAK_PHRASE);
    expect(served).toContain("1,250");
  });

  it("one sheet, with the name the page gives it, holding only text cells", async () => {
    const zip = await exportFile("pdf-to-excel", ["x,1\ny,2"]);
    const workbook = await part(zip, "xl/workbook.xml");
    const names = [...workbook.matchAll(/<sheet name="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(names).toEqual([XLSX_SHEET_NAME]);
    expect(answer("pdf-to-excel", /lay out/i)).toContain(
      `“${XLSX_SHEET_NAME}”`,
    );
    const sheet = await part(zip, "xl/worksheets/sheet1.xml");
    const types = [...sheet.matchAll(/<c [^>]*t="([^"]+)"/g)].map((m) => m[1]);
    expect(types.length).toBeGreaterThan(0);
    expect(new Set(types)).toEqual(new Set(["inlineStr"]));
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
    expect(panel).toMatch(
      /if \(includeDate\) \{\s*fields\.push\(\{[^}]*type: "date"/,
    );
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
    for (const slug of PDF_OFFICE_EXPORT_TOOLS) {
      expect(page(slug).text).toContain(getToolBySlug(slug)!.description);
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
    expect(ghostscriptPdfAArgs("in.pdf", "out.pdf")).toContain(
      `-dPDFA=${m![1]}`,
    );
    const served = answer("pdf-to-pdfa", /validated/i);
    expect(served).toMatch(/^No\./);
    expect(served).toContain(PDF_A_STANDARD);
    // The panel says the same — no validation step exists to contradict.
    expect(read("src/components/tools/pdf-archive-worker-panel.tsx")).toMatch(
      /We do not validate/,
    );
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

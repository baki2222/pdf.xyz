// @vitest-environment node
// @native-canvas
/**
 * Every tool page answers a question of its own, and every such answer is what
 * the engine behind it does.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * Audited at 67e8d0f on production, the FAQ on 28 of the 50 tool pages (and
 * the FAQPage JSON-LD built from it) was nothing but the templated questions
 * `toolFaq` asks of every tool in a mode: "Is my file uploaded when I use
 * Merge PDF?", "Does Merge PDF work offline?", "How large can my file be?".
 * Merge, Split, Sign, Edit, Compress, Protect and Unlock — the tools people
 * search for most — answered none of the questions those searchers ask:
 * different page sizes, legally binding, quality loss, a forgotten password.
 *
 * Nothing caught it because every copy guard asks whether a sentence is TRUE,
 * and a page with no specific sentence has nothing false in it. The property
 * this file holds is the missing half: a served page must say something only
 * that tool can say — and because adding copy is how this product has shipped
 * most of its false claims, each new answer below is run against its engine,
 * read off the served page, not off `toolFaq`.
 *
 * ── HOW "TEMPLATED" IS DECIDED (derived, not listed) ────────────────────────
 *
 * A question is templated when, with the tool's name taken out, it is asked on
 * at least a quarter of the served pages. Nothing is typed: a new boilerplate
 * question joins the set the moment it is asked widely, and a runner-specific
 * question shared by the few tools mounting that runner stays specific. The
 * three questions merge-pdf served at 67e8d0f are the positive control: the
 * detector must classify each as templated.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
  type PDFContext,
} from "pdf-lib";
import { tools } from "@/lib/tools";
import type { Tool } from "./types";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { getRunnerKind } from "@/lib/pdf/registry";
import { extractPages, getPageCount, mergePdfs } from "@/lib/pdf/engine";
import { PDF_ENCRYPTED_UNKNOWN_MESSAGE } from "@/lib/pdf/encryption";
import { userPasswordEncryptedPdf } from "@/tests/encrypted-pdf-fixture";
import { parseRanges } from "@/lib/pdf/ranges";
import {
  IMAGE_HEAVY_SHARE,
  analyzePdf,
  summarizeAnalysis,
} from "@/lib/pdf/analyze";
import { signPdf } from "@/lib/pdf/signature";
import { editPdf } from "@/lib/pdf/edit";
import { annotatePdf } from "@/lib/pdf/annotate";
import { addWatermark } from "@/lib/pdf/watermark";
import { addPageNumbers } from "@/lib/pdf/page-numbers";
import {
  addHeaderFooter,
  resolveStampDate,
  stampDateCandidates,
} from "@/lib/pdf/header-footer";
import { applyTokens } from "@/lib/pdf/stamp";
import { cropPdf } from "@/lib/pdf/crop";
import { flattenPdf } from "@/lib/pdf/flatten";
import {
  OVERLAY_FITS as ENGINE_OVERLAY_FITS,
  overlayPdf,
} from "@/lib/pdf/overlay";
import { GRAYSCALE_DPI_PRESETS as ENGINE_GRAYSCALE_PRESETS } from "@/lib/pdf/grayscale";
import {
  createGrayscaleBuilder,
  grayscaleTitle,
} from "@/lib/pdf/grayscale-builder";
import { applyFormValues, inspectFormFields } from "@/lib/pdf/forms";
import { createFormFields } from "@/lib/pdf/create-forms";
import { extractPdfImages } from "@/lib/pdf/extract-images";
import { embedRasterImage } from "@/lib/pdf/pdf-lib";
import { compareExtractedPdfText } from "@/lib/pdf/compare-pdf";
import { joinPageTexts, type ExtractedPdfText } from "@/lib/pdf/text";
import {
  extractedTextToMarkdown,
  type PdfToMarkdownInput,
} from "@/lib/pdf/pdf-to-markdown";
import {
  ANNOTATION_FACT,
  ANNOTATION_TYPES,
  DEEP_COMPRESSION_PRESETS,
  EDIT_OP_FACT,
  EDIT_OP_TYPES,
  FIELD_TYPE_FACT,
  GRAYSCALE_DPI_PRESETS,
  NEW_FIELD_TYPES,
  OVERLAY_FITS,
} from "@/lib/pdf/offered-kinds";
import { MIN_CROP_DIMENSION, PT_PER_INCH } from "@/lib/pdf/page-geometry";
import {
  DEEP_COMPRESSION_TOOLS,
  parseCompressionOptions,
} from "@/lib/workers/compression/engine";
import { nativeArgs } from "@/lib/workers/compression/native";
import {
  PDF_ENCRYPTION_LEVELS,
  PDF_KEY_LENGTHS,
} from "@/lib/jobs/pdf-security";
import {
  runProtect,
  runUnlock,
  type QpdfPasswordRequirement,
  type QpdfRunner,
  type QpdfUnlockOutcome,
} from "@/lib/workers/pdf-security/engine";
import { protectArgs } from "@/lib/workers/pdf-security/native";
import { linearizeArgs } from "@/lib/workers/pdf-structure/native";
import {
  runTableExtract,
  type PdfLayout,
  type PdfLayoutPage,
} from "@/lib/workers/table-extract/engine";
import { HTML_DOCUMENT_URL } from "@/lib/workers/html-render/native";
import { createRenderNetwork } from "@/lib/workers/html-render/network";
import {
  SUMMARY_FORMATS,
  SUMMARY_LENGTHS,
  parseSummarizeOptions,
} from "@/lib/jobs/summarize-pdf";
import {
  EXTRACTION_FIELD_TYPES,
  MAX_EXTRACTION_FIELDS,
  parseExtractOptions,
} from "@/lib/jobs/ai-extract";
import {
  MAX_CONTEXT_EXCHANGES,
  buildChatContext,
} from "@/lib/workers/chat-with-pdf-conversation";
import { runAiExtract } from "@/lib/workers/ai-extract/engine";
import type { AiProvider } from "@/lib/workers/ai/provider";
import { withoutComments } from "./copy-surface";
import {
  FACTS_SLUGS,
  SPLIT_NAME_EXAMPLES,
  modeFaq,
  toolFacts,
} from "./tool-facts";
import {
  renderToolPages,
  type RenderedToolPage,
} from "@/tests/rendered-tool-pages";
import { runnerModuleOf } from "@/tests/tool-panel-modules";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

let pages: Map<string, RenderedToolPage>;
beforeAll(() => {
  pages = renderToolPages();
}, 180_000);

const page = (slug: string) => {
  const p = pages.get(slug);
  if (!p) throw new Error(`no rendered page for ${slug}`);
  return p;
};

/** The served answer to the one question on `slug`'s page matching `q`. FATAL if absent. */
function answer(slug: string, q: RegExp): string {
  const hits = page(slug).faq.filter((e) => q.test(e.question));
  if (hits.length !== 1) {
    throw new Error(
      `${slug}: expected one served question matching ${q}, found ${hits.length}: ${page(
        slug,
      )
        .faq.map((e) => e.question)
        .join(" | ")}`,
    );
  }
  return hits[0]!.answer;
}

/** Tools mounting runner `kind`, discovered from the registry. Never empty. */
function mounting(kind: string): Tool[] {
  const found = tools.filter((t) => getRunnerKind(t.slug) === kind);
  if (found.length === 0) throw new Error(`no tool mounts runner "${kind}"`);
  return found;
}

/* ------------------------------------------------------------------ *
 *  Runner source, resolved the way the page mounts it (as in
 *  tool-page-substance.test.ts): registry kind → dispatcher arm → module.
 * ------------------------------------------------------------------ */

const RUNNER_DIR = "src/components/tools/runner";

function runnerSource(slug: string): string {
  const kind = getRunnerKind(slug);
  if (!kind) throw new Error(`${slug} mounts no runner`);
  const dispatch = read(`${RUNNER_DIR}/tool-runner.tsx`);
  const arm = new RegExp(
    `case\\s+"${kind}":[\\s\\S]{0,200}?<([A-Z][A-Za-z]*)`,
  ).exec(dispatch);
  if (!arm) throw new Error(`no dispatcher arm renders kind "${kind}"`);
  // Through the dispatcher's own bindings — a static import, or the
  // `next/dynamic` loader every runner has been since 2026-10-09 — to the
  // module that defines it. Throws when it cannot.
  return withoutComments(read(runnerModuleOf(arm[1]!)));
}

/* ------------------------------------------------------------------ *
 *  1. No page's FAQ is only boilerplate
 * ------------------------------------------------------------------ */

/** Verbatim: the whole FAQ merge-pdf served at 67e8d0f. */
const SHIPPED_MERGE_FAQ = [
  "Is my file uploaded when I use Merge PDF?",
  "Does Merge PDF work offline?",
  "How large can my file be?",
];

const normalize = (question: string, tool: Tool) =>
  question.split(tool.name).join("{tool}");

/** The questions each tool page serves: the census the detector reads. */
const servedQuestions = (tool: Tool): readonly string[] =>
  page(tool.slug).faq.map((e) => e.question);

function templatedQuestions(
  questionsOf: (tool: Tool) => readonly string[] = servedQuestions,
): Set<string> {
  const askedOn = new Map<string, number>();
  for (const tool of tools) {
    const seen = new Set(questionsOf(tool).map((q) => normalize(q, tool)));
    for (const q of seen) askedOn.set(q, (askedOn.get(q) ?? 0) + 1);
  }
  const floor = Math.ceil(tools.length / 4);
  return new Set([...askedOn].filter(([, n]) => n >= floor).map(([q]) => q));
}

/** The questions on a page that no other quarter of the site shares. */
function ownQuestions(
  tool: Tool,
  faq: readonly { question: string }[],
  templated: Set<string>,
): string[] {
  return faq
    .map((e) => e.question)
    .filter((q) => !templated.has(normalize(q, tool)));
}

describe("every tool page answers a question of its own", () => {
  it("the detector classifies the shipped boilerplate as templated (positive control)", () => {
    expect(pages.size, "the render lost pages").toBe(tools.length);
    // The census the boilerplate lived in: every served page PLUS the mode
    // template (`modeFaq`) it was built from. Since the authored content
    // (seo/content) a page with its own FAQ no longer serves that template,
    // so on the served census alone "Is my file uploaded when I use …?" is
    // asked on a handful of pages and is — correctly — not boilerplate any
    // more. The control still has to show the detector CAN see it, so it runs
    // the same predicate over the census that carries it.
    const templated = templatedQuestions((tool) => [
      ...servedQuestions(tool),
      ...modeFaq(tool).map((e) => e.question),
    ]);
    const merge = tools.find((t) => t.slug === "merge-pdf")!;
    for (const q of SHIPPED_MERGE_FAQ)
      expect(templated.has(normalize(q, merge)), q).toBe(true);
    // Through the same predicate: merge's page as it shipped has nothing of its own.
    expect(
      ownQuestions(
        merge,
        SHIPPED_MERGE_FAQ.map((question) => ({ question })),
        templated,
      ),
    ).toEqual([]);
    // Health, both ways: the set is the boilerplate, not the whole FAQ.
    expect(templated.size).toBeGreaterThanOrEqual(SHIPPED_MERGE_FAQ.length);
    expect(
      templated.size,
      `implausibly many templated questions: ${[...templated].join(" | ")}`,
    ).toBeLessThan(10);
    // …and on the served census the detector still finds the boilerplate that
    // IS served everywhere (the size question), and not the whole FAQ.
    const served = templatedQuestions();
    expect(served.has("How large can my file be?")).toBe(true);
    expect(served.size).toBeLessThan(10);
  });

  it("no served page's FAQ consists only of templated questions", () => {
    const templated = templatedQuestions();
    const bare = tools
      .filter((t) => ownQuestions(t, page(t.slug).faq, templated).length === 0)
      .map((t) => t.slug);
    expect(bare, "these pages answer only boilerplate").toEqual([]);
    const own = tools.reduce(
      (sum, t) => sum + ownQuestions(t, page(t.slug).faq, templated).length,
      0,
    );
    expect(own, "implausibly few own questions").toBeGreaterThan(tools.length);
  });

  it("every authored fact reaches its tool's served page", () => {
    // `tool-facts-slugs.test.ts` holds the FACTS keys to the catalogue; this is
    // the other end of that chain — the fact as a reader receives it.
    let checked = 0;
    const missing: string[] = [];
    for (const slug of FACTS_SLUGS) {
      const text = page(slug).text;
      for (const fact of toolFacts(slug)) {
        checked += 1;
        if (!text.includes(fact.value)) missing.push(`${slug}: ${fact.label}`);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(FACTS_SLUGS.length);
    expect(missing).toEqual([]);
  });

  it("every FAQPage entry is also visible on the page", () => {
    // The value is the answer a reader sees; the JSON-LD must not carry
    // questions the page does not show, nor the reverse.
    const hidden: string[] = [];
    let checked = 0;
    for (const tool of tools) {
      const p = page(tool.slug);
      for (const e of p.faq) {
        checked += 1;
        if (!p.text.includes(e.question))
          hidden.push(`${tool.slug}: ${e.question}`);
        if (!p.text.includes(e.answer))
          hidden.push(`${tool.slug}: answer to "${e.question}"`);
      }
    }
    expect(checked).toBeGreaterThan(tools.length * 3);
    expect(hidden).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 *  Fixtures
 * ------------------------------------------------------------------ */

async function pdfWithPages(
  sizes: readonly [number, number][],
  label = "Page",
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  sizes.forEach(([w, h], i) => {
    const p = doc.addPage([w, h]);
    p.drawText(`${label} ${i + 1}`, { x: 20, y: h - 40, size: 14, font });
  });
  return doc.save();
}

function contentOf(doc: PDFDocument, index: number): string {
  const contents = doc.getPage(index).node.Contents();
  if (!contents) return "";
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  return streams
    .map((s) =>
      s instanceof PDFRawStream
        ? Buffer.from(decodePDFRawStream(s).decode()).toString("latin1")
        : "",
    )
    .join("\n");
}

/** Every hex string shown with Tj/TJ, decoded — the text a page draws. */
function drawnText(doc: PDFDocument, index: number): string[] {
  return [...contentOf(doc, index).matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map(
    (m) => Buffer.from(m[1]!, "hex").toString("latin1"),
  );
}

/** A PDF whose trailer names an /Encrypt dictionary — locked, as pdf-lib sees it. */
async function lockedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.context.trailerInfo.Encrypt = doc.context.register(
    doc.context.obj({ Filter: "Standard", V: 4, R: 4, Length: 128 }),
  );
  return doc.save({ useObjectStreams: false });
}

/** Every indirect dictionary in a PDF (object streams included). */
function dictionaries(doc: PDFDocument): PDFDict[] {
  return doc.context
    .enumerateIndirectObjects()
    .map(([, obj]) => obj)
    .flatMap((obj) =>
      obj instanceof PDFDict
        ? [obj]
        : obj instanceof PDFRawStream
          ? [obj.dict]
          : [],
    );
}

/* ------------------------------------------------------------------ *
 *  2. The page tools
 * ------------------------------------------------------------------ */

describe("merge, split and extract answer what their engines do", () => {
  it("merged pages keep their own size and orientation", async () => {
    const letter = await pdfWithPages([[612, 792]]);
    const a4Doc = await PDFDocument.load(await pdfWithPages([[595, 842]]));
    a4Doc.getPage(0).setRotation({ type: "degrees", angle: 90 } as never);
    const a4 = await a4Doc.save();
    const merged = await PDFDocument.load(await mergePdfs([letter, a4]));
    expect(merged.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(merged.getPage(1).getSize()).toEqual({ width: 595, height: 842 });
    expect(merged.getPage(1).getRotation().angle).toBe(90);
    for (const tool of mounting("merge")) {
      expect(runnerSource(tool.slug)).toContain("mergePdfs(");
      const served = answer(tool.slug, /different page sizes/);
      expect(served).toMatch(/^Yes\b/);
      expect(served).toContain("keeps its own size and orientation");
    }
  });

  it("a locked PDF is turned away when it is added, and the page says so", async () => {
    /*
     * AMENDED at the merge of wave1/l06-copy-other (2026-09-28), history kept.
     * This used `lockedPdf()` — a trailer /Encrypt with no /O or /U — and
     * expected "password-protected". pdf-lib refuses on the /Encrypt entry
     * alone, but since L06 the loader asks pdf.js WHICH lock a file has, and
     * no reader can open that file, so the only true message for it is the
     * one true of both kinds. The FAQ's claim is about a password-protected
     * PDF, so it is now checked with a real one (Standard handler, a user
     * password); the unclassifiable file stays as a second case.
     */
    const locked = userPasswordEncryptedPdf();
    // Positive control: without the /Encrypt entry the same file loads.
    await expect(getPageCount(await pdfWithPages([[200, 200]]))).resolves.toBe(
      1,
    );
    await expect(getPageCount(locked)).rejects.toThrow(/password-protected/);
    await expect(mergePdfs([locked])).rejects.toThrow(/password-protected/);
    // A lock no reader can classify is turned away too, in words true of both.
    const unclassifiable = await lockedPdf();
    await expect(getPageCount(unclassifiable)).rejects.toThrow(
      PDF_ENCRYPTED_UNKNOWN_MESSAGE,
    );
    await expect(mergePdfs([unclassifiable])).rejects.toThrow(
      PDF_ENCRYPTED_UNKNOWN_MESSAGE,
    );
    for (const tool of mounting("merge")) {
      // The runner parses each file as it is added, and files the rejection
      // against that file — which is the "turned away when you add it".
      const src = runnerSource(tool.slug);
      expect(src).toMatch(
        /await getPageCount\(bytes\)[\s\S]{0,900}setRejections/,
      );
      const served = answer(tool.slug, /password-protected/);
      expect(served).toMatch(/^Not while they are locked\./);
      expect(served).toContain("Unlock PDF");
    }
  });

  it("the split names in the answer are the names the runner's chain produces", () => {
    // The runner: parseRanges(input) → buildSplitParts(baseName(file), …).
    const tool = mounting("split")[0]!;
    const src = runnerSource(tool.slug);
    expect(src).toMatch(/buildSplitParts\(base, parseRanges\(/);
    expect(src).toMatch(/const base = baseName\(pdf\.file\.name\)/);
    const chain = parseRanges("1-3, 4", 4);
    expect(SPLIT_NAME_EXAMPLES).toEqual(
      ["report-1-pages-1-3.pdf", "report-2-page-4.pdf"].slice(0, chain.length),
    );
    const served = answer(tool.slug, /named/);
    for (const name of SPLIT_NAME_EXAMPLES) expect(served).toContain(name);
    expect(served).toContain("More than one piece downloads as a ZIP");
  });

  it("extracted pages keep their original order", async () => {
    const bytes = await pdfWithPages([
      [100, 100],
      [200, 200],
      [300, 300],
    ]);
    const out = await PDFDocument.load(await extractPages(bytes, [2, 0]));
    expect(out.getPages().map((p) => p.getSize().width)).toEqual([100, 300]);
    for (const tool of mounting("extract-pages")) {
      expect(runnerSource(tool.slug)).toContain("extractPages(");
      expect(answer(tool.slug, /order/)).toMatch(/^No\. The new PDF keeps/);
    }
  });
});

describe("compress answers what each of its two paths does", () => {
  it("the browser step re-saves the same pages", async () => {
    const bytes = await pdfWithPages([
      [300, 400],
      [300, 400],
    ]);
    const { optimized } = await analyzePdf(bytes);
    const before = await PDFDocument.load(bytes);
    const after = await PDFDocument.load(optimized);
    expect(after.getPageCount()).toBe(before.getPageCount());
    for (let i = 0; i < before.getPageCount(); i += 1)
      expect(contentOf(after, i)).toBe(contentOf(before, i));
  });

  it("the worker step's levels are the ones the answer names, and the engine applies them", () => {
    const tool = mounting("compress")[0]!;
    expect(runnerSource(tool.slug)).toMatch(
      /const DEEP_QUALITY = DEEP_COMPRESSION_PRESETS/,
    );
    // Ghostscript is the engine the deep path prefers, and it downsamples to
    // exactly the DPI sent; every offered level is one the worker accepts.
    expect(DEEP_COMPRESSION_TOOLS[0]).toBe("ghostscript");
    const served = answer(tool.slug, /reduce the quality/);
    expect(served).toMatch(/^Not in your browser/);
    for (const preset of DEEP_COMPRESSION_PRESETS) {
      expect(served).toContain(`${preset.label} (${preset.dpi} DPI)`);
      expect(
        parseCompressionOptions({ profile: "deep", targetDpi: preset.dpi }).ok,
      ).toBe(true);
      expect(
        nativeArgs("ghostscript", "gs", "in", "out", preset.dpi).args,
      ).toContain(`-dColorImageResolution=${preset.dpi}`);
    }
  });

  it("the image-heavy share in the answer is the one the analysis switches on", () => {
    const at = (share: number) =>
      summarizeAnalysis({
        pageCount: 1,
        originalBytes: 1000,
        imageCount: 1,
        imageBytes: Math.round(share * 1000),
        optimizedBytes: 1000,
        // L12 (c27ec09) added this; an unsigned file is the case the
        // image-heavy share switches on.
        signatureCount: 0,
      }).recommendation;
    expect(at(IMAGE_HEAVY_SHARE)).toBe("needs-worker");
    expect(at(IMAGE_HEAVY_SHARE - 0.01)).toBe("already-lean");
    const tool = mounting("compress")[0]!;
    expect(runnerSource(tool.slug)).toMatch(
      /const canDownload = summary\.savedBytes > 0/,
    );
    expect(answer(tool.slug, /How much smaller/)).toContain(
      `${Math.round(IMAGE_HEAVY_SHARE * 100)}% or more`,
    );
  });
});

describe("sign, edit and annotate answer what they draw", () => {
  it("a signed file carries no digital signature, and only the chosen page changes", async () => {
    const bytes = await pdfWithPages([
      [300, 400],
      [300, 400],
      [300, 400],
    ]);
    const signedBytes = await signPdf(
      bytes,
      { kind: "typed", text: "Ada Lovelace", style: "print" },
      { pageIndex: 1, position: "bottom-right", width: 120 },
    );
    const signed = await PDFDocument.load(signedBytes);
    const original = await PDFDocument.load(bytes);
    const sigLike = dictionaries(signed).filter(
      (d) =>
        d.get(PDFName.of("ByteRange")) !== undefined ||
        d.get(PDFName.of("Type"))?.toString() === "/Sig" ||
        d.get(PDFName.of("FT"))?.toString() === "/Sig",
    );
    expect(sigLike).toEqual([]);
    expect(signed.catalog.get(PDFName.of("Perms"))).toBeUndefined();
    // Positive control for the walk: it does see the catalog's /Pages.
    expect(
      dictionaries(signed).some(
        (d) => d.get(PDFName.of("Type"))?.toString() === "/Pages",
      ),
    ).toBe(true);
    expect(contentOf(signed, 0)).toBe(contentOf(original, 0));
    expect(contentOf(signed, 2)).toBe(contentOf(original, 2));
    expect(contentOf(signed, 1)).not.toBe(contentOf(original, 1));
    for (const tool of mounting("sign")) {
      const src = runnerSource(tool.slug);
      expect(src).toContain("is not tamper-evident");
      expect(src).toMatch(/signPdf\(pdf\.bytes, input, \{ pageIndex,/);
      const binding = answer(tool.slug, /legally binding/);
      expect(binding).toContain("cannot decide it for you");
      expect(binding).toContain("not a certificate-based digital signature");
      expect(answer(tool.slug, /more than one page/)).toMatch(
        /^Each run places one signature/,
      );
    }
  });

  it("an edit leaves the original page content in place, even under a filled box", async () => {
    const bytes = await pdfWithPages([[300, 400]]);
    const before = await PDFDocument.load(bytes);
    const { bytes: edited } = await editPdf(bytes, [
      {
        type: "rect",
        page: 1,
        x: 10,
        y: 340,
        width: 200,
        height: 40,
        color: "#000000",
        filled: true,
      },
    ]);
    const after = await PDFDocument.load(edited);
    const original = contentOf(before, 0);
    expect(original).toMatch(/Tj/);
    expect(contentOf(after, 0)).toContain(original);
    expect(drawnText(after, 0)).toContain("Page 1");
    for (const tool of mounting("edit")) {
      const change = answer(tool.slug, /change the text already/);
      expect(change).toMatch(/^No\./);
      for (const t of EDIT_OP_TYPES) expect(change).toContain(EDIT_OP_FACT[t]);
      expect(answer(tool.slug, /cover something up/)).toContain(
        "still in the file",
      );
    }
  });

  it("annotations are drawn into the page, not added as comment objects", async () => {
    const bytes = await pdfWithPages([[300, 400]]);
    const { bytes: marked } = await annotatePdf(bytes, [
      {
        type: "highlight",
        page: 1,
        x: 10,
        y: 340,
        width: 100,
        height: 20,
        color: "#ffeb3b",
      },
      { type: "note", page: 1, x: 20, y: 200, text: "Check", color: "#000000" },
    ]);
    const doc = await PDFDocument.load(marked);
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
    expect(contentOf(doc, 0).length).toBeGreaterThan(
      contentOf(await PDFDocument.load(bytes), 0).length,
    );
    for (const tool of mounting("annotate")) {
      const served = answer(tool.slug, /comments/);
      expect(served).toMatch(/^No\./);
      for (const t of ANNOTATION_TYPES)
        expect(served).toContain(ANNOTATION_FACT[t]);
      expect(answer(tool.slug, /place a highlight/)).toContain(
        `${PT_PER_INCH} points to an inch`,
      );
    }
  });
});

describe("the stamping tools answer where and what they stamp", () => {
  it("a watermark is drawn text on every page — no layer, no comment", async () => {
    const bytes = await pdfWithPages([
      [300, 400],
      [300, 400],
    ]);
    const doc = await PDFDocument.load(await addWatermark(bytes, "DRAFT"));
    expect(doc.catalog.get(PDFName.of("OCProperties"))).toBeUndefined();
    for (let i = 0; i < 2; i += 1) {
      expect(doc.getPage(i).node.Annots()?.size() ?? 0).toBe(0);
      expect(drawnText(doc, i)).toContain("DRAFT");
    }
    for (const tool of mounting("watermark")) {
      // Text only: the engine takes a string, and the runner offers no image.
      // The runner calls `watermarkPdf` since L11 (8fa96e1), which returns
      // whether the text had to shrink; `addWatermark`, drawn above, is that
      // same engine returning the bytes alone.
      const src = runnerSource(tool.slug);
      expect(src).toMatch(/\bwatermarkPdf\(pdf\.bytes, text/);
      expect(src).not.toMatch(/\.png|image\/|embedRasterImage|<Dropzone/i);
      expect(answer(tool.slug, /image or logo/)).toMatch(/it draws text/);
      expect(answer(tool.slug, /remove the watermark/)).toMatch(
        /^Not by switching it off/,
      );
    }
  });

  it("page numbers start where “Start on page” says, and {total} is the last number printed", async () => {
    const bytes = await pdfWithPages(
      [
        [300, 400],
        [300, 400],
        [300, 400],
      ],
      "Body",
    );
    const before = await PDFDocument.load(bytes);
    const doc = await PDFDocument.load(
      await addPageNumbers(bytes, {
        format: "{n}/{total}",
        startPage: 2,
        startAt: 1,
      }),
    );
    expect(contentOf(doc, 0)).toBe(contentOf(before, 0));
    expect(drawnText(doc, 1)).toContain("1/2");
    expect(drawnText(doc, 2)).toContain("2/2");
    for (const tool of mounting("page-numbers")) {
      const src = runnerSource(tool.slug);
      expect(src).toContain("startPage,");
      expect(src).toContain("startAt,");
      expect(answer(tool.slug, /cover page/)).toContain(
        "{total} is the last number printed",
      );
    }
  });

  /*
   * ── HISTORY ─────────────────────────────────────────────────────────────
   * The answer above first shipped as "{total} is the last number printed, so
   * it counts only the numbered pages", and the test above passed it: its one
   * fixture uses startAt 1, the only value at which "last number printed" and
   * "count of numbered pages" agree. On the answer's own cover-page recipe —
   * start on page 2, first number 2 — the engine draws '2/3', '3/3': {total}
   * counts the unnumbered cover too. This test sweeps startAt so the two
   * readings are forced apart, and holds the served sentence to the formula
   * the engine computes rather than to the easier paraphrase.
   */
  it("{total} is “First number” plus the numbered pages minus one, not a count of them", async () => {
    const sizes: [number, number][] = [
      [300, 400],
      [300, 400],
      [300, 400],
    ];
    const bytes = await pdfWithPages(sizes, "Body");
    const pageCount = sizes.length;
    let readingsDisagree = 0;
    for (const startPage of [1, 2, 3]) {
      for (const startAt of [1, 2, 5]) {
        const doc = await PDFDocument.load(
          await addPageNumbers(bytes, {
            format: "{n}/{total}",
            startPage,
            startAt,
          }),
        );
        const numbered = pageCount - (startPage - 1);
        const total = startAt + numbered - 1;
        for (let i = startPage - 1; i < pageCount; i += 1) {
          expect(drawnText(doc, i)).toContain(
            `${startAt + i - (startPage - 1)}/${total}`,
          );
        }
        if (total !== numbered) readingsDisagree += 1;
        // The served recipe: “First number” equal to “Start on page” makes
        // {total} the whole document's page count, cover included.
        if (startAt === startPage) expect(total).toBe(pageCount);
      }
    }
    // Health: the sweep must contain cases where the two readings differ, or
    // it cannot tell the true clause from the false one.
    expect(readingsDisagree).toBeGreaterThan(0);

    // The reviewer's case, verbatim: a cover left unnumbered, then 2, 3.
    const cover = await PDFDocument.load(
      await addPageNumbers(bytes, {
        format: "{n}/{total}",
        startPage: 2,
        startAt: 2,
      }),
    );
    expect(drawnText(cover, 0)).not.toContain("1/3");
    expect(drawnText(cover, 1)).toContain("2/3");
    expect(drawnText(cover, 2)).toContain("3/3");

    for (const tool of mounting("page-numbers")) {
      const served = answer(tool.slug, /cover page/);
      expect(served).toContain(
        "{total} is the last number printed: “First number” plus the count of numbered pages, minus one.",
      );
      expect(served).toMatch(
        /“First number” to the same value as “Start on page”[^.]*\{total\} is the document's full page count/,
      );
      // The false clause, in any of the shapes it could come back in. The
      // sentence that shipped is the positive control: the ban must catch it.
      const onlyNumbered =
        /\{total\}[^.]*\b(counts?|is|equals)\b[^.]*\bonly\b[^.]*numbered pages/i;
      expect(
        "{total} is the last number printed, so it counts only the numbered pages.",
      ).toMatch(onlyNumbered);
      expect(served).not.toMatch(onlyNumbered);
      // Every control the answer names is one the runner renders.
      const src = runnerSource(tool.slug);
      const labels = [...served.matchAll(/“([^”]+)”/g)].map((m) => m[1]!);
      expect(new Set(labels)).toEqual(
        new Set(["Start on page", "First number"]),
      );
      for (const label of labels) expect(src).toContain(`label="${label}"`);
    }
  });

  it("header and footer tokens are the engine's, and the band goes on every page", async () => {
    expect(
      applyTokens("{n}|{total}|{date}", { n: 2, total: 5, date: "D" }),
    ).toBe("2|5|D");
    const bytes = await pdfWithPages([
      [300, 400],
      [300, 400],
      [300, 400],
    ]);
    const doc = await PDFDocument.load(
      await addHeaderFooter(bytes, { footer: { center: "{n}/{total}" } }),
    );
    for (let i = 0; i < 3; i += 1)
      expect(drawnText(doc, i)).toContain(`${i + 1}/3`);
    for (const tool of mounting("header-footer")) {
      const src = runnerSource(tool.slug);
      const served = answer(tool.slug, /What can a header/);
      for (const token of ["{n}", "{total}", "{date}"]) {
        expect(src).toContain(`token: "${token}"`);
        expect(served).toContain(token);
      }
      // WAS `expect(src).toContain("toLocaleDateString()")`. Since L13
      // (0a1f815) the runner resolves {date} through `resolveStampDate`, which
      // tries the device's own format first and falls back when no shipped
      // face can draw it beside the user's text — so the answer names the
      // fallbacks, and the first candidate must still be the device's format.
      expect(src).toContain("resolveStampDate(");
      const now = new Date(2026, 8, 27);
      expect(stampDateCandidates(now)[0]).toBe(now.toLocaleDateString());
      expect(served).toMatch(/the way your device writes dates/);
      expect(served).toMatch(/Latin digits/);
      expect(served).toContain("YYYY-MM-DD");
      expect(stampDateCandidates(now).at(-1)).toBe("2026-09-27");
      expect(answer(tool.slug, /first page without/)).toMatch(
        /go on every page/,
      );

      // The refusal answer said "a browser set to Persian writes the date in
      // Persian digits, which are refused like Arabic, so type the date by
      // hand there" for weeks after the runner stopped refusing it. Run the
      // runner's own resolver for the browsers it named, on a header that uses
      // {date} over the default footer: the locale form is NOT stamped, the
      // next candidate (Latin digits) is, and the answer quotes that value.
      // Then no served sentence may say a {date} is refused or must be typed
      // by hand; the shipped sentences are the caught corpus.
      for (const locale of ["fa-IR", "ar-EG"]) {
        const [own, latin] = stampDateCandidates(now, locale);
        // A template WITHOUT {date} resolves to the first candidate trivially
        // (nothing is substituted), so the header must use the field.
        const stamped = await resolveStampDate(
          ["Printed {date}", "Page {n} of {total}"],
          now,
          locale,
        );
        expect(stamped, locale).not.toBe(own);
        expect(stamped, locale).toBe(latin);
      }
      const refusal = answer(tool.slug, /refused/);
      expect(refusal).toContain(
        `writes 27 September 2026 as ${stampDateCandidates(new Date(2026, 8, 27, 12), "fa-IR")[1]}`,
      );
      const saysDateRefused = (x: string) =>
        /type the date by hand/.test(x) ||
        (/\{date\}[^.]*\brefused\b/.test(x) &&
          !/\{date\} is switched, not refused/.test(x));
      for (const shipped of [
        "{date} counts too: a browser set to Persian writes the date in Persian digits, which are refused like Arabic, so type the date by hand there.",
        "{date} counts too: a browser set to Persian writes the date in Persian digits, which are refused like Arabic.",
      ])
        expect(saysDateRefused(shipped), shipped).toBe(true);
      const sentences = [
        ...page(tool.slug).text.split(/(?<=[.!?])\s+/),
        ...page(tool.slug).faq.flatMap((e) => e.answer.split(/(?<=[.!?])\s+/)),
      ];
      expect(
        sentences.filter((x) => x.includes("{date}")).length,
      ).toBeGreaterThan(2);
      expect(sentences.filter(saysDateRefused)).toEqual([]);
    }
  });

  it("cropping hides by crop box; the content and the media box are untouched", async () => {
    const bytes = await pdfWithPages([[300, 400]]);
    const before = await PDFDocument.load(bytes);
    const doc = await PDFDocument.load(
      await cropPdf(bytes, {
        margins: { top: 10, right: 20, bottom: 30, left: 40 },
      }),
    );
    const page0 = doc.getPage(0);
    expect(page0.getMediaBox()).toEqual(before.getPage(0).getMediaBox());
    expect(page0.getCropBox()).toEqual({
      x: 40,
      y: 30,
      width: 240,
      height: 360,
    });
    expect(contentOf(doc, 0)).toBe(contentOf(before, 0));
    await expect(
      cropPdf(bytes, {
        margins: {
          top: 0,
          right: 300 - MIN_CROP_DIMENSION + 1,
          bottom: 0,
          left: 0,
        },
      }),
    ).rejects.toThrow(/larger than page 1/);
    for (const tool of mounting("crop")) {
      expect(answer(tool.slug, /delete what is outside/)).toMatch(
        /hidden, not removed/,
      );
      const units = answer(tool.slug, /units/);
      expect(units).toContain(`${PT_PER_INCH} points to an inch`);
      expect(units).toContain(`${MIN_CROP_DIMENSION} points`);
    }
  });
});

describe("the form tools answer what happens to the fields", () => {
  async function formPdf(withComment = false): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const p = doc.addPage([300, 400]);
    const field = doc.getForm().createTextField("name");
    field.setText("Ada");
    field.addToPage(p, { x: 20, y: 200, width: 200, height: 24 });
    if (withComment) {
      const note = doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Text",
          Rect: [10, 10, 30, 30],
          Contents: "A comment",
        }),
      );
      p.node.addAnnot(note);
    }
    return doc.save();
  }

  // Only the annotations that still resolve: pdf-lib's flatten deletes the
  // widget object but leaves its reference in /Annots, pointing at nothing.
  const subtypes = (doc: PDFDocument, i: number) =>
    (doc.getPage(i).node.Annots()?.asArray() ?? [])
      .map((ref) => doc.context.lookup(ref as PDFRef))
      .filter((obj): obj is PDFDict => obj instanceof PDFDict)
      .map((dict) => dict.get(PDFName.of("Subtype"))?.toString());

  it("flattening removes the fields and keeps comments", async () => {
    const bytes = await formPdf(true);
    const before = await PDFDocument.load(bytes);
    expect(subtypes(before, 0).sort()).toEqual(["/Text", "/Widget"]);
    const { bytes: flat } = await flattenPdf(bytes);
    const doc = await PDFDocument.load(flat);
    expect(doc.getForm().getFields()).toHaveLength(0);
    expect(subtypes(doc, 0)).toEqual(["/Text"]);

    // INVERTED 2026-10-06, history kept. This asserted /^No\./ of "Can a
    // flattened form be edited again?" — "No. Each field's current value is
    // drawn into the page and the field itself is removed" — on the fixture
    // above: one text field and a comment, which nothing can fail to flatten.
    // The engine always keeps a signature field and leaves an undrawable field
    // live (`flattenFormFields`), so the flat "No" was false of any form with
    // either, and this fixture licensed it. Measured here: the same form plus
    // an empty signature box keeps that box as a field.
    const withSignature = await PDFDocument.load(bytes);
    const signaturePage = withSignature.getPage(0);
    const signatureRef = withSignature.context.register(
      withSignature.context.obj({
        FT: "Sig",
        T: PDFString.of("Signature1"),
        Type: "Annot",
        Subtype: "Widget",
        Rect: [10, 10, 110, 40],
        F: 4,
        P: signaturePage.ref,
      }),
    );
    signaturePage.node.addAnnot(signatureRef);
    withSignature.getForm().acroForm.addField(signatureRef);
    const keptSignature = await PDFDocument.load(
      (await flattenPdf(await withSignature.save())).bytes,
    );
    expect(
      keptSignature
        .getForm()
        .getFields()
        .map((f) => f.getName()),
    ).toEqual(["Signature1"]);
    for (const tool of mounting("flatten")) {
      const editedAgain = answer(tool.slug, /edited again/);
      expect(editedAgain).toMatch(/^Not the fields that were flattened\b/);
      expect(editedAgain).toMatch(/\bSignature fields stay signature fields\b/);
      expect(answer(tool.slug, /comments and annotations/)).toMatch(
        /saved as they were/,
      );
    }
  });

  it("“Flatten after filling” is the only thing that removes the fields", async () => {
    const bytes = await formPdf();
    const kept = await PDFDocument.load(
      (await applyFormValues(bytes, { name: "Grace" })).bytes,
    );
    expect(kept.getForm().getTextField("name").getText()).toBe("Grace");
    const flat = await PDFDocument.load(
      (await applyFormValues(bytes, { name: "Grace" }, { flatten: true }))
        .bytes,
    );
    expect(flat.getForm().getFields()).toHaveLength(0);
    const plain = await inspectFormFields(await pdfWithPages([[300, 400]]));
    expect(plain.hasFields).toBe(false);
    for (const tool of mounting("fill-forms")) {
      expect(runnerSource(tool.slug)).toMatch(
        /applyFormValues\(pdf\.bytes, values, \{ flatten \}\)/,
      );
      expect(answer(tool.slug, /stop the answers/)).toMatch(
        /Leave it unticked and the fields stay fillable/,
      );
      expect(answer(tool.slug, /find no fields/)).toMatch(
        /^Because the PDF has no fillable form/,
      );
    }
  });

  it("new fields are the offered kinds, placed in points from the bottom-left", async () => {
    expect(NEW_FIELD_TYPES as readonly string[]).not.toContain("signature");
    const { bytes } = await createFormFields(await pdfWithPages([[300, 400]]), [
      {
        type: "text",
        name: "who",
        page: 1,
        x: 30,
        y: 50,
        width: 120,
        height: 20,
      },
    ]);
    const doc = await PDFDocument.load(bytes);
    const widget = doc.getForm().getTextField("who").acroField.getWidgets()[0]!;
    const rect = widget.getRectangle();
    // The widget is widened by half its border on each side; the placement is
    // still the x, y, width and height given, from the bottom-left corner.
    expect(Math.abs(rect.x - 30)).toBeLessThanOrEqual(1);
    expect(Math.abs(rect.y - 50)).toBeLessThanOrEqual(1);
    expect(Math.abs(rect.width - 120)).toBeLessThanOrEqual(2);
    expect(Math.abs(rect.height - 20)).toBeLessThanOrEqual(2);
    for (const tool of mounting("create-forms")) {
      const served = answer(tool.slug, /signature field/);
      expect(served).toMatch(/^No\./);
      for (const t of NEW_FIELD_TYPES)
        expect(served).toContain(FIELD_TYPE_FACT[t]);
      expect(answer(tool.slug, /place a field/)).toContain(
        "bottom-left corner",
      );
    }
  });
});

describe("the remaining in-browser tools answer what their engines do", () => {
  it("the overlay's first page lands on every page, sized by the offered modes", async () => {
    // One list: the engine re-exports the leaf the answer reads.
    expect(ENGINE_OVERLAY_FITS).toBe(OVERLAY_FITS);
    const base = await pdfWithPages([
      [300, 400],
      [300, 400],
      [300, 400],
    ]);
    const stamp = await pdfWithPages(
      [
        [100, 100],
        [100, 100],
      ],
      "Stamp",
    );
    const doc = await PDFDocument.load((await overlayPdf(base, stamp)).bytes);
    // Resolve each page's drawn XObject name to the object it names: pdf-lib
    // gives every page its own name for the one embedded overlay page.
    const drawn = [0, 1, 2].map((i) => {
      const names = [...contentOf(doc, i).matchAll(/\/(\S+) Do/g)].map(
        (m) => m[1]!,
      );
      const xobjects = doc
        .getPage(i)
        .node.Resources()!
        .lookup(PDFName.of("XObject"), PDFDict);
      return names.map((n) => String(xobjects.get(PDFName.of(n))));
    });
    for (const refs of drawn) expect(refs).toHaveLength(1);
    expect(
      new Set(drawn.flat()).size,
      "each page drew the same (first) page",
    ).toBe(1);
    for (const tool of mounting("overlay")) {
      expect(runnerSource(tool.slug)).toContain('label: "Cycle pages"');
      const sized = answer(tool.slug, /sized/);
      for (const f of OVERLAY_FITS)
        expect(sized).toContain(`${f.label}: ${f.hint}`);
      expect(answer(tool.slug, /letterhead/)).toMatch(
        /first page is drawn over every page/,
      );
    }
  });

  it("grayscale rebuilds every page from an image, at the offered presets", async () => {
    expect(ENGINE_GRAYSCALE_PRESETS).toBe(GRAYSCALE_DPI_PRESETS);
    // The engine rasterizes (it cannot run without a canvas here), so its
    // SHAPE is the precondition: pages come only from rendered page images.
    // Since L08 (85ee451) each is a one-channel plane stored as a JPEG or,
    // when smaller, losslessly — so the answer says "image", not "JPEG".
    // The engine is grayscale.ts AND the leaf it builds the output in: L13
    // (4d9eff2) moved the builder to `./grayscale-builder` so the e2e suite
    // could load it without the renderer. Followed from the import, not typed.
    const engineEntry = read("src/lib/pdf/grayscale.ts");
    const builders = [
      ...engineEntry.matchAll(/from "\.\/(grayscale-[a-z-]+)"/g),
    ].map((m) => m[1]!);
    expect(builders, "grayscale.ts imports no builder leaf").toEqual([
      "grayscale-builder",
    ]);
    const engine = withoutComments(
      [engineEntry, ...builders.map((b) => read(`src/lib/pdf/${b}.ts`))].join(
        "\n",
      ),
    );
    expect(engine).toMatch(/capturePdfPages\(bytes, \{/);
    expect(engine).toContain("PDFDocument.create()");
    expect(engine).not.toMatch(/copyPages|embedPage|embedPdf|drawText/);
    for (const tool of mounting("grayscale")) {
      const src = runnerSource(tool.slug);
      expect(src).toContain("GRAYSCALE_DPI_PRESETS.map(");
      expect(src).toContain("dpi: preset.dpi");
      const search = answer(tool.slug, /select and search/);
      expect(search).toMatch(/^No\./);
      expect(search, "the encoding is chosen per page").not.toMatch(/JPEG/);
      const res = answer(tool.slug, /resolution/);
      for (const p of GRAYSCALE_DPI_PRESETS)
        expect(res).toContain(`${p.label} (${p.dpi} DPI)`);
    }

    // What the builder WRITES, read back from its saved bytes, and every
    // served sentence held to it. Until this block the guard read only the
    // select-and-search answer, so the intro ("every page becomes a JPEG
    // picture ... titled \"Grayscale PDF\""), the preflight answer ("Probably
    // not ... RGB (DeviceRGB)") and the portal use case pointing at it all
    // described the canvas JPEG the builder replaced, beside a runner tile
    // saying DeviceGray.
    const builder = await createGrayscaleBuilder();
    const info = (index: number, width: number, height: number) => ({
      index,
      width,
      height,
      pageWidth: width,
      pageHeight: height,
    });
    // A flat page (text-like: lossless wins) and a noisy one (photo-like:
    // JPEG wins), so both encodings are exercised; a set of one would
    // certify the other unseen.
    // The photo plane is a wave plus noise, as in grayscale-output.test.ts.
    let seed = 12345;
    const photo = new Uint8Array(200 * 150);
    for (let p = 0; p < photo.length; p++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const wave =
        90 * Math.sin((p % 200) / 9) * Math.cos(Math.floor(p / 200) / 13);
      photo[p] = Math.max(0, Math.min(255, 128 + wave + (seed % 48)));
    }
    await builder.addPage(new Uint8Array(64 * 64).fill(255), info(0, 64, 64));
    await builder.addPage(photo, info(1, 200, 150));
    expect(new Set(builder.pages.map((p) => p.encoding))).toEqual(
      new Set(["flate", "jpeg"]),
    );
    const title = grayscaleTitle("Quarterly Report", "q3.pdf");
    const saved = await PDFDocument.load(await builder.save(title));
    const spaces = [...saved.context.enumerateIndirectObjects()]
      .map(([, o]) => o)
      .filter(
        (o): o is PDFRawStream =>
          o instanceof PDFRawStream &&
          o.dict.get(PDFName.of("Subtype"))?.toString() === "/Image",
      )
      .map((o) => o.dict.get(PDFName.of("ColorSpace"))?.toString());
    expect(spaces).toEqual(["/DeviceGray", "/DeviceGray"]);
    expect(saved.getTitle()).toBe("Quarterly Report (grayscale)");

    // Predicates over served sentences, each caught on the shipped sentence
    // it exists for (the corpus), each clean on every served page.
    // JPEG as what the output is made of; "JPEG 2000" is an INPUT codec the
    // renderer's decoder note names, so it is not a claim about the output.
    const outputJpeg = /\bJPEG\b(?! 2000)/;
    const saysAllJpeg = (x: string) =>
      outputJpeg.test(x) && !/lossless|whichever is smaller/i.test(x);
    const saysDeclaresRgb = (x: string) =>
      /DeviceRGB|report RGB|does not meet that requirement/.test(x);
    const saysFixedTitle = (x: string) =>
      /\btitled\b/.test(x) && !x.includes('"(grayscale)"');
    const shipped: [(x: string) => boolean, string][] = [
      [
        saysAllJpeg,
        "Because every page becomes a JPEG picture, the result is a copy for printing or submitting, not for editing.",
      ],
      [
        saysFixedTitle,
        'Selectable text, sharp vector lines, links, bookmarks and the original document title do not carry over (the new file is titled "Grayscale PDF"), and form fields or comments are painted in from their saved appearance, so they can no longer be filled in or clicked.',
      ],
      [
        saysDeclaresRgb,
        "Every pixel is a neutral gray, but the page images are written by the browser's own JPEG encoder, which in Chrome and Edge stores three color channels even when all of them are equal, and the PDF labels each image by the channels it carries: RGB (DeviceRGB).",
      ],
    ];
    for (const [caught, sentence] of shipped)
      expect(caught(sentence), sentence).toBe(true);
    for (const tool of mounting("grayscale")) {
      const served = [
        ...page(tool.slug).text.split(/(?<=[.!?])\s+/),
        ...page(tool.slug).faq.flatMap((e) => e.answer.split(/(?<=[.!?])\s+/)),
      ];
      expect(served.filter((x) => outputJpeg.test(x)).length).toBeGreaterThan(
        0,
      );
      expect(served.filter((x) => /\btitled\b/.test(x)).length).toBeGreaterThan(
        0,
      );
      expect(served.filter(saysAllJpeg)).toEqual([]);
      expect(served.filter(saysDeclaresRgb)).toEqual([]);
      expect(served.filter(saysFixedTitle)).toEqual([]);
      const preflight = answer(tool.slug, /preflight/);
      expect(preflight).toMatch(/^Yes\b/);
      expect(preflight).toContain("(DeviceGray)");
    }
  });

  it("images come out byte for byte, and each kind the answer names is skipped", async () => {
    const JPG_1X1 = Uint8Array.from(
      Buffer.from(
        "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ap//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8Qf//Z",
        "base64",
      ),
    );
    const doc = await PDFDocument.create();
    const jpg = await embedRasterImage(doc, JPG_1X1, "jpg");
    doc
      .addPage([200, 200])
      .drawImage(jpg, { x: 0, y: 0, width: 50, height: 50 });
    const out = await extractPdfImages(await doc.save());
    expect(out.images).toHaveLength(1);
    expect(Buffer.from(out.images[0]!.bytes).equals(Buffer.from(JPG_1X1))).toBe(
      true,
    );

    // Each kind the answer names, built and run: it must be skipped, and for
    // THAT kind's reason. History: until this was inverted the list named
    // "palette (indexed)" and built an Indexed image whose palette was the
    // name /xx. It was skipped, so the guard was green, but for "palette
    // can't be read", not for being a palette: the extractor has recovered
    // well-formed palettes over RGB or gray since 8e398575, and the page went
    // on telling readers they were skipped. The reason pattern is what makes
    // a malformed fixture fail instead of passing for the wrong reason, and a
    // well-formed palette is now a POSITIVE control that must be extracted.
    const palette = (ctx: PDFContext, base: string, entries: number[]) => {
      const cs = PDFArray.withContext(ctx);
      cs.push(PDFName.of("Indexed"));
      cs.push(PDFName.of(base));
      cs.push(PDFNumber.of(0));
      cs.push(PDFHexString.of(Buffer.from(entries).toString("hex")));
      return cs;
    };
    const kinds: {
      named: string;
      reason: RegExp;
      build: (ctx: PDFContext) => PDFRawStream;
    }[] = [
      {
        named: "JPEG 2000",
        reason: /^JPEG 2000/,
        build: (ctx) =>
          imageStream(ctx, {
            ColorSpace: "DeviceRGB",
            BitsPerComponent: 8,
            Filter: "JPXDecode",
          }),
      },
      {
        named: "CCITT",
        reason: /^CCITT/,
        build: (ctx) =>
          imageStream(ctx, {
            ColorSpace: "DeviceGray",
            BitsPerComponent: 1,
            Filter: "CCITTFaxDecode",
          }),
      },
      {
        named: "JBIG2",
        reason: /^JBIG2/,
        build: (ctx) =>
          imageStream(ctx, {
            ColorSpace: "DeviceGray",
            BitsPerComponent: 1,
            Filter: "JBIG2Decode",
          }),
      },
      {
        named: "CMYK",
        reason: /^CMYK/,
        build: (ctx) =>
          imageStream(ctx, {
            ColorSpace: "DeviceCMYK",
            BitsPerComponent: 8,
            Filter: "FlateDecode",
          }),
      },
      {
        named: "palette images built on them",
        reason: /^Indexed \(palette\) image over DeviceCMYK/,
        build: (ctx) => {
          const s = imageStream(ctx, { BitsPerComponent: 8 });
          s.dict.set(
            PDFName.of("ColorSpace"),
            palette(ctx, "DeviceCMYK", [0, 0, 0, 0]),
          );
          return s;
        },
      },
    ];
    const tool = mounting("extract-images")[0]!;
    const skippedAnswer = answer(tool.slug, /skipped/);
    for (const kind of kinds) {
      expect(skippedAnswer).toContain(kind.named);
      const d = await PDFDocument.create();
      const p = d.addPage([100, 100]);
      p.node.setXObject(
        PDFName.of("Im0"),
        d.context.register(kind.build(d.context)),
      );
      const r = await extractPdfImages(await d.save());
      expect(r.images, kind.named).toHaveLength(0);
      expect(r.skipped, kind.named).toHaveLength(1);
      expect(r.skipped[0]!.reason, kind.named).toMatch(kind.reason);
    }

    // Inline images: found in the drawing instructions and listed as skipped,
    // which the "skipped" answer and the "no images found" answer both say.
    const inline = await PDFDocument.create();
    inline
      .addPage([100, 100])
      .node.set(
        PDFName.of("Contents"),
        inline.context.register(
          inline.context.stream(
            "q 10 0 0 10 0 0 cm BI /W 1 /H 1 /CS /G /BPC 8 ID A EI Q",
          ),
        ),
      );
    const inlineRun = await extractPdfImages(await inline.save());
    expect(inlineRun.images).toHaveLength(0);
    expect(inlineRun.skipped.map((k) => k.reason)).toEqual([
      "Inline image (not yet supported)",
    ]);
    expect(skippedAnswer).toContain("images written inline");
    const noneFound = answer(tool.slug, /no images found/);
    expect(noneFound).toMatch(
      /written inline[^.]*: they appear in the skipped list/,
    );
    expect(noneFound).not.toMatch(/inline[^.]*not listed as skipped/);

    // A palette over RGB is recovered as a PNG. So no served sentence may put
    // "palette" in a not-recovered or skipped list without "built on them".
    // The corpus is the two shipped sentences that did, held to be caught,
    // and the served page, held to mention palettes at all and to be clean.
    const rgbPalette = await PDFDocument.create();
    const pctx = rgbPalette.context;
    const pal = imageStream(pctx, { BitsPerComponent: 8 });
    pal.dict.set(
      PDFName.of("ColorSpace"),
      palette(pctx, "DeviceRGB", [255, 0, 0]),
    );
    rgbPalette
      .addPage([100, 100])
      .node.setXObject(PDFName.of("Im0"), pctx.register(pal));
    const palRun = await extractPdfImages(await rgbPalette.save());
    expect(palRun.skipped).toEqual([]);
    expect(palRun.images.map((i) => i.format)).toEqual(["png"]);
    const saysPaletteSkipped = (sentence: string) =>
      /palette/i.test(sentence) &&
      /not recovered|skipped|cannot be turned back/i.test(sentence) &&
      !/palette[^.]*built on them/i.test(sentence);
    const shipped = [
      "Several kinds of image are not recovered yet: JPEG 2000, CCITT and JBIG2 fax-style bitmaps, palette (indexed) colour, CMYK pixel images, spot-colour and Lab images, other bit depths, stencil masks, and pixel images with a custom decode array.",
      "Some ways of storing an image cannot be turned back into an ordinary picture file faithfully — JPEG 2000, black-and-white fax images (CCITT and JBIG2), palette (indexed) images and CMYK images among them.",
    ];
    for (const sentence of shipped)
      expect(saysPaletteSkipped(sentence), sentence).toBe(true);
    const sentences = (t: string) => t.split(/(?<=[.!?])\s+/);
    const served = [
      ...sentences(page(tool.slug).text),
      ...page(tool.slug).faq.flatMap((e) => sentences(e.answer)),
    ];
    expect(served.filter((x) => /palette/i.test(x)).length).toBeGreaterThan(1);
    expect(served.filter(saysPaletteSkipped)).toEqual([]);

    // Transparency: a soft mask beside a pixel image becomes the PNG's alpha
    // (IHDR colour type 6, RGB + alpha); a masked JPEG is kept byte for byte,
    // opaque, and carries a note the runner lists. The answer says both.
    const masked = await PDFDocument.create();
    const mctx = masked.context;
    const smask = mctx.register(
      mctx.stream(new Uint8Array([128]), {
        Type: "XObject",
        Subtype: "Image",
        Width: 1,
        Height: 1,
        ColorSpace: "DeviceGray",
        BitsPerComponent: 8,
      } as never),
    );
    const rgb = mctx.stream(new Uint8Array([255, 0, 0]), {
      Type: "XObject",
      Subtype: "Image",
      Width: 1,
      Height: 1,
      ColorSpace: "DeviceRGB",
      BitsPerComponent: 8,
    } as never);
    rgb.dict.set(PDFName.of("SMask"), smask);
    const maskedJpg = await embedRasterImage(masked, JPG_1X1, "jpg");
    const mpage = masked.addPage([100, 100]);
    mpage.node.setXObject(PDFName.of("Im0"), mctx.register(rgb));
    mpage.drawImage(maskedJpg, { x: 0, y: 0, width: 10, height: 10 });
    await masked.flush();
    const jpgStream = mctx.lookup(maskedJpg.ref);
    if (!(jpgStream instanceof PDFRawStream)) {
      throw new Error("the embedded JPEG is not a raw stream");
    }
    jpgStream.dict.set(PDFName.of("SMask"), smask);
    const maskedRun = await extractPdfImages(await masked.save());
    const png = maskedRun.images.find((i) => i.format === "png")!;
    const jpeg = maskedRun.images.find((i) => i.format === "jpg")!;
    expect(png.bytes[25], "PNG colour type 6 = RGB + alpha").toBe(6);
    expect(png.note).toBeUndefined();
    expect(jpeg.note).toMatch(/^Saved without its transparency/);
    expect(runnerSource(tool.slug)).toContain("saved with a caveat");
    const transparency = answer(tool.slug, /transparency/);
    expect(transparency).toMatch(/^For PNGs, yes\./);
    expect(transparency).toContain(
      "masked JPEG comes out on a solid background",
    );
    expect(transparency).toContain("saved without its transparency");
    expect(answer(tool.slug, /full quality/)).toContain("byte for byte");
  });

  it("compare looks at selectable text, page count and size — nothing visual", () => {
    const text = (t: string, pageCount: number): ExtractedPdfText => ({
      pageCount,
      pages: [],
      text: t,
      characterCount: t.length,
      hasText: t.trim().length > 0,
    });
    const same = compareExtractedPdfText(
      { name: "a.pdf", size: 1000, extracted: text("Hello\nWorld", 1) },
      { name: "b.pdf", size: 9000, extracted: text("Hello\nWorld", 2) },
    );
    expect(same.identicalText).toBe(true);
    expect(same.pageDelta).toBe(1);
    expect(same.sizeDelta).toBe(8000);
    const scans = compareExtractedPdfText(
      { name: "a.pdf", size: 1, extracted: text("", 1) },
      { name: "b.pdf", size: 1, extracted: text(" ", 1) },
    );
    expect(scans.hasComparableText).toBe(false);
    expect(scans.report).toMatch(/Use OCR first/);
    for (const tool of mounting("compare")) {
      expect(answer(tool.slug, /What does .* compare/)).toMatch(
        /^The selectable text, line by line, plus the page count and the file size/,
      );
      expect(answer(tool.slug, /scanned/)).toContain("OCR PDF");
    }
  });

  it("the text converters say what they keep, from what they produce", () => {
    expect(
      joinPageTexts([
        { pageNumber: 1, text: "First page" },
        { pageNumber: 2, text: "Second page" },
      ]),
    ).toBe("First page\n\nSecond page");
    for (const tool of mounting("pdf-to-text")) {
      expect(runnerSource(tool.slug)).toContain("No selectable text found");
      expect(answer(tool.slug, /keep the layout/)).toContain(
        "with a blank line between pages",
      );
      expect(answer(tool.slug, /scanned/)).toMatch(/^Not on its own/);
    }

    // `lines: null` written out, as L10's PdfToMarkdownPage requires (ed6a206):
    // this block exercises the TEXT fallback the page's answer describes, so
    // it states that it carries no line geometry rather than omitting it.
    const extracted: PdfToMarkdownInput = {
      pageCount: 2,
      pages: [
        {
          pageNumber: 1,
          text: "Intro line one\nline two\n\n- a bullet",
          characterCount: 0,
          lines: null,
        },
        {
          pageNumber: 2,
          text: "1. numbered\nplain",
          characterCount: 0,
          lines: null,
        },
      ],
      text: "x",
      characterCount: 1,
      hasText: true,
    };
    const md = extractedTextToMarkdown(extracted, {
      sourceName: "report.pdf",
    }).markdown;
    expect(md.startsWith("# report\n")).toBe(true);
    expect(md).toContain("## Page 1");
    expect(md).toContain("## Page 2");
    expect(md).toContain("Intro line one line two");
    expect(md).toContain("\n- a bullet");
    expect(md).toContain("\n1. numbered");
    const single = extractedTextToMarkdown(
      { ...extracted, pageCount: 1, pages: extracted.pages.slice(0, 1) },
      { sourceName: "report.pdf" },
    ).markdown;
    expect(single).not.toContain("## Page");
    expect(
      extractedTextToMarkdown({ ...extracted, hasText: false }).hasMarkdown,
    ).toBe(false);
    for (const tool of mounting("pdf-to-markdown")) {
      const src = runnerSource(tool.slug);
      expect(src).toContain("extractedTextToMarkdown(");
      expect(src).not.toContain("includePageHeadings");
      expect(answer(tool.slug, /headings, bold/)).toContain(
        '"Page N" heading when there is more than one',
      );
    }
  });
});

/* ------------------------------------------------------------------ *
 *  3. The secure-worker and AI tools
 * ------------------------------------------------------------------ */

/**
 * A qpdf that answers the questions the engine asks. Since L02 (a214a10,
 * a50c54c) the engine gates on `requiresPassword` — which tells a file that
 * needs a password to OPEN from one that opens freely and only restricts
 * printing or copying — and a refused decrypt says WHY. `opensFreely` models
 * the second kind.
 */
function fakeQpdf(state: {
  encrypted: boolean;
  opensFreely?: boolean;
  wrongPassword?: boolean;
}): QpdfRunner & { protects: number } {
  const requirement = (input: Uint8Array): QpdfPasswordRequirement => {
    // The output of protect/unlock is judged by a marker byte we set below.
    if (input[input.length - 1] === 0xee) return "needs-password";
    if (input[input.length - 1] === 0xdd) return "not-encrypted";
    if (!state.encrypted) return "not-encrypted";
    return state.opensFreely ? "opens-freely" : "needs-password";
  };
  const runner = {
    protects: 0,
    async isEncrypted(input: Uint8Array) {
      return requirement(input) !== "not-encrypted";
    },
    async requiresPassword(input: Uint8Array) {
      return requirement(input);
    },
    async protect(input: Uint8Array) {
      runner.protects += 1;
      return Uint8Array.from([...input, 0xee]);
    },
    async unlock(input: Uint8Array): Promise<QpdfUnlockOutcome> {
      return state.wrongPassword
        ? { ok: false, reason: "wrong-password" }
        : { ok: true, output: Uint8Array.from([...input, 0xdd]) };
    },
  };
  return runner;
}

describe("the secure-worker tools answer what their engines do", () => {
  const INPUT = new Uint8Array([1, 2, 3]);
  const validate = () => true;

  it("protect: AES at every offered level, and a locked file is turned away", async () => {
    expect(PDF_ENCRYPTION_LEVELS.map((l) => l.keyLength).sort()).toEqual(
      [...PDF_KEY_LENGTHS].sort(),
    );
    for (const { keyLength } of PDF_ENCRYPTION_LEVELS) {
      const args = protectArgs("in", "out", {
        userPassword: "u",
        ownerPassword: "o",
        keyLength,
      });
      expect(args).toContain(String(keyLength));
      // bits=256 is AES by definition; 128 must force it.
      if (keyLength !== 256) expect(args).toContain("--use-aes=y");
    }
    const qpdf = fakeQpdf({ encrypted: true });
    const run = await runProtect(
      INPUT,
      { password: "x", ownerPassword: "x", keyLength: 256 },
      { qpdf, validate },
    );
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("already_encrypted");
    expect(qpdf.protects).toBe(0);
    // Positive control: an unlocked file is protected.
    const ok = await runProtect(
      INPUT,
      { password: "x", ownerPassword: "x", keyLength: 256 },
      { qpdf: fakeQpdf({ encrypted: false }), validate },
    );
    expect(ok.ok).toBe(true);
    // A PDF that opens freely but restricts printing or copying is turned
    // away too (L02), and the answer below says so.
    const restricted = fakeQpdf({ encrypted: true, opensFreely: true });
    const refused = await runProtect(
      INPUT,
      { password: "x", ownerPassword: "x", keyLength: 256 },
      { qpdf: restricted, validate },
    );
    expect(refused).toMatchObject({ ok: false, kind: "restrictions_only" });
    expect(restricted.protects).toBe(0);
    const tool = tools.find((t) => t.slug === "protect-pdf")!;
    const which = answer(tool.slug, /Which encryption/);
    for (const level of PDF_ENCRYPTION_LEVELS)
      expect(which).toContain(level.label);
    expect(which).toContain("RC4 cipher is never used");
    const already = answer(tool.slug, /already has a password/);
    expect(already).toMatch(/^No — it is turned away/);
    expect(already).toMatch(/owner \(permissions\) password/);
  });

  it("unlock: a wrong password or an unlocked file produces no file", async () => {
    const wrong = await runUnlock(
      INPUT,
      { password: "guess" },
      { qpdf: fakeQpdf({ encrypted: true, wrongPassword: true }), validate },
    );
    expect(wrong).toMatchObject({ ok: false, kind: "wrong_password" });
    expect("output" in wrong).toBe(false);
    const open = await runUnlock(
      INPUT,
      { password: "x" },
      { qpdf: fakeQpdf({ encrypted: false }), validate },
    );
    expect(open).toMatchObject({ ok: false, kind: "not_encrypted" });
    const right = await runUnlock(
      INPUT,
      { password: "x" },
      { qpdf: fakeQpdf({ encrypted: true }), validate },
    );
    expect(right.ok).toBe(true);
    // A PDF that opens freely DOES have a password — the owner's — and a
    // wrong one is refused as that, not as "nothing to unlock" (L02).
    const owner = await runUnlock(
      INPUT,
      { password: "guess" },
      {
        qpdf: fakeQpdf({
          encrypted: true,
          opensFreely: true,
          wrongPassword: true,
        }),
        validate,
      },
    );
    expect(owner).toMatchObject({ ok: false, kind: "owner_password_required" });
    const slug = "unlock-pdf";
    expect(answer(slug, /don't know/)).toContain(
      "does not guess or crack passwords",
    );
    const none = answer(slug, /no password/);
    expect(none).toMatch(/nothing to unlock/);
    expect(none).toMatch(/owner \(permissions\) password/);
  });

  it("optimize for web linearizes and nothing else", () => {
    expect(linearizeArgs("in.pdf", "out.pdf")).toEqual([
      "--linearize",
      "in.pdf",
      "out.pdf",
    ]);
    expect(answer("optimize-web", /smaller/)).toContain(
      "rearranges the file rather than compressing it",
    );
    expect(answer("optimize-web", /change\?/)).toContain("linearizes the PDF");
  });

  it("extract tables: the download, the grid rule and the scanned refusal are the engine's", async () => {
    const row = (y: number, cells: string[]) =>
      cells.map((text, i) => ({
        text,
        x: 50 + i * 120,
        y,
        width: 60,
        height: 10,
      }));
    const gridPage: PdfLayoutPage = {
      pageNumber: 3,
      width: 600,
      height: 800,
      items: [
        ...row(700, ["Item", "Qty", "Price"]),
        ...row(680, ["Pen", "2", "1.50"]),
        ...row(660, ["Ink", "1", "4.00"]),
      ],
    };
    const prosePage: PdfLayoutPage = {
      pageNumber: 1,
      width: 600,
      height: 800,
      items: [
        {
          text: "A single column of running prose.",
          x: 50,
          y: 700,
          width: 300,
          height: 10,
        },
        {
          text: "Another line of the same paragraph.",
          x: 50,
          y: 680,
          width: 300,
          height: 10,
        },
      ],
    };
    const layoutOf = (...p: PdfLayoutPage[]): PdfLayout => ({
      pageCount: p.length,
      pages: p,
    });
    const found = await runTableExtract(new Uint8Array([1]), {
      extractLayout: async () => layoutOf(prosePage, gridPage),
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const zip = await JSZip.loadAsync(found.output);
    expect(Object.keys(zip.files).sort()).toEqual([
      "table-1.csv",
      "tables.xlsx",
    ]);
    const xlsx = await JSZip.loadAsync(
      await zip.file("tables.xlsx")!.async("uint8array"),
    );
    expect(await xlsx.file("xl/workbook.xml")!.async("string")).toContain(
      'name="Table 1 (p3)"',
    );
    const prose = await runTableExtract(new Uint8Array([1]), {
      extractLayout: async () => layoutOf(prosePage),
    });
    expect(prose).toMatchObject({ ok: false, kind: "no_tables" });
    const scan = await runTableExtract(new Uint8Array([1]), {
      extractLayout: async () => layoutOf({ ...prosePage, items: [] }),
    });
    expect(scan).toMatchObject({ ok: false, kind: "no_text" });
    const slug = "extract-tables";
    const download = answer(slug, /download/);
    expect(download).toContain("table-1.csv");
    expect(download).toContain("tables.xlsx");
    expect(answer(slug, /find a table/)).toContain("By where the text sits");
    expect(answer(slug, /scanned/)).toMatch(/^No\./);
  });

  /*
   * REWRITTEN 2026-09-27 at the merge with L02 (ba4bfb0), history kept. This
   * ran the renderer with a fake filesystem and asserted it wrote ONE file,
   * input.html, and handed Chromium a file:// URL. L02 closed that path: the
   * upload is now served to Chromium from memory at HTML_DOCUMENT_URL, and
   * every other request goes through the render network's policy. The
   * property is unchanged — a relative link has nothing to resolve to — so it
   * is asked of the path that exists now. L08's
   * `unbundled-assets.chromium.test.ts` runs the same chain in a real Chromium.
   */
  it("HTML to PDF uploads the .html file alone — relative links have nothing to resolve to", async () => {
    const native = withoutComments(
      read("src/lib/workers/html-render/native.ts"),
    );
    // The upload is served once, as the main document, at one address.
    expect(native).toMatch(/p\.request\.url === HTML_DOCUMENT_URL/);
    const relative = new URL("images/logo.png", HTML_DOCUMENT_URL).href;
    expect(new URL(relative).host).toBe(new URL(HTML_DOCUMENT_URL).host);
    const fetched: string[] = [];
    const resolved: string[] = [];
    const network = createRenderNetwork({
      resolve: async (host) => {
        resolved.push(host);
        return [{ address: "93.184.215.14", family: 4 }];
      },
      fetch: async (url) => {
        fetched.push(String(url));
        return {
          status: 200,
          rawHeaders: ["content-type", "image/png"],
          body: new Uint8Array([1]),
        };
      },
    });
    const refused = await network.handle({
      url: relative,
      method: "GET",
      headers: {},
    });
    expect(refused.action).toBe("fail");
    // CONTROL: the same image at a full public address is fetched.
    const absolute = await network.handle({
      url: "https://example.com/images/logo.png",
      method: "GET",
      headers: {},
    });
    expect(absolute.action).toBe("fulfill");
    expect(fetched).toEqual(["https://example.com/images/logo.png"]);
    expect(resolved).toEqual(["example.com"]);
    const served = answer("html-to-pdf", /images and styles/);
    expect(served).toContain("the .html file is uploaded on its own");
    expect(served).toContain("files linked by a full web address, are loaded");
  });
});

describe("the AI tools answer what they offer, and that they can be wrong", () => {
  it("every AI page says its result can be wrong", () => {
    const ai = tools.filter((t) => capabilityForMode(t.processing) === "ai");
    expect(ai.length).toBeGreaterThanOrEqual(4);
    for (const tool of ai)
      expect(answer(tool.slug, /get things wrong/)).toMatch(
        /^Yes\. .*AI model/,
      );
  });

  it("summarize: every length and shape the answer names is one the job accepts and the panel offers", () => {
    const served = answer("summarize-pdf", /how long/);
    const panel = read("src/components/tools/summarize-worker-panel.tsx");
    for (const length of SUMMARY_LENGTHS) {
      expect(served).toContain(length);
      expect(panel).toContain(`value: "${length}"`);
      expect(parseSummarizeOptions({ length }).ok).toBe(true);
    }
    for (const format of SUMMARY_FORMATS) {
      expect(served).toContain(format);
      expect(panel).toContain(`value: "${format}"`);
      expect(parseSummarizeOptions({ format }).ok).toBe(true);
    }
    expect(parseSummarizeOptions({ length: "epic" }).ok).toBe(false);
  });

  it("chat: the number of remembered exchanges is the one the context builder keeps", () => {
    const exchanges = Array.from(
      { length: MAX_CONTEXT_EXCHANGES + 3 },
      (_, i) => ({
        question: `Q${i}`,
        answer: `A${i}`,
      }),
    );
    const context = buildChatContext(exchanges);
    expect(context.turns).toHaveLength(MAX_CONTEXT_EXCHANGES * 2);
    expect(context.droppedExchanges).toBe(3);
    const panel = read("src/components/tools/chat-with-pdf-worker-panel.tsx");
    expect(panel).toContain("left out");
    expect(panel).toContain("shortened");
    expect(answer("chat-with-pdf", /remember/)).toContain(
      `up to the last ${MAX_CONTEXT_EXCHANGES} questions and answers`,
    );
  });

  it("extract: the field cap and types are the contract's, and the package holds what the answer says", async () => {
    const fields = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ name: `f${i}`, type: "string" }));
    expect(
      parseExtractOptions({
        mode: "schema",
        schema: fields(MAX_EXTRACTION_FIELDS),
      }).ok,
    ).toBe(true);
    expect(
      parseExtractOptions({
        mode: "schema",
        schema: fields(MAX_EXTRACTION_FIELDS + 1),
      }).ok,
    ).toBe(false);
    for (const type of EXTRACTION_FIELD_TYPES)
      expect(
        parseExtractOptions({ mode: "schema", schema: [{ name: "x", type }] })
          .ok,
      ).toBe(true);
    const provider: AiProvider = {
      id: "anthropic",
      model: "claude-sonnet-5",
      complete: vi.fn(async () => ({
        ok: true as const,
        text: '{"total": 5}',
        model: "claude-sonnet-5",
        usage: { inputTokens: 10, outputTokens: 5 },
      })),
    };
    const run = await runAiExtract(
      new Uint8Array([1, 2, 3]),
      { mode: "prompt", prompt: "The total." },
      {
        extract: async () => ({
          pageCount: 1,
          pages: [],
          text: "Total: 5",
          characterCount: 8,
          hasText: true,
        }),
        provider,
      },
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const zip = await JSZip.loadAsync(run.output);
    for (const name of ["extraction.json", "extraction.md", "manifest.json"])
      expect(zip.file(name), name).not.toBeNull();
    // The page's own "What is inside the ZIP" answer names every file the
    // engine WROTE — read off the ZIP, not typed. It named four of five
    // (model-output.json was added under it) until 2026-10-06.
    const written = Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name);
    expect(written.length, "implausibly few files").toBeGreaterThanOrEqual(4);
    const inside = answer("ai-extract", /inside the ZIP/i);
    expect(written.filter((name) => !inside.includes(name))).toEqual([]);
    const served = answer("ai-extract", /pull out/);
    expect(served).toContain(`up to ${MAX_EXTRACTION_FIELDS}`);
    for (const type of EXTRACTION_FIELD_TYPES) expect(served).toContain(type);
    expect(served).toContain("JSON");
    expect(served).toContain("Markdown");
    expect(served).toContain("manifest");
  });
});

/* ------------------------------------------------------------------ *
 *  Local helpers
 * ------------------------------------------------------------------ */

function imageStream(
  ctx: PDFContext,
  dict: Record<string, unknown>,
): PDFRawStream {
  return ctx.stream(new Uint8Array([0, 0, 0, 0]), {
    Type: "XObject",
    Subtype: "Image",
    Width: 1,
    Height: 1,
    ...dict,
  } as never);
}

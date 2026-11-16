// @vitest-environment node
// @native-canvas
/**
 * A tool page may not promise a capability the tool, as shipped, does not have.
 *
 * ── THE DEFECTS THIS WAS BUILT ON (audit at 67e8d0f, re-verified at d1b579e) ──
 *
 * Nine tool pages described a product that does not exist, and every one of
 * those sentences reached Google three times over — as the H1 subtitle, as
 * `<meta name="description">`, and as the WebApplication/HowTo/FAQPage JSON-LD:
 *
 *   request-signatures  "Collect legally-binding e-signatures." / "Send a
 *                       document to others, track status, and collect audited
 *                       e-signatures in order." — the worker wires no delivery
 *                       provider; the engine's own manifest says the package
 *                       "was NOT delivered to signers".
 *   jpg-to-pdf          "with control over orientation, margins, and page
 *                       size" — the runner renders no such control and the
 *                       engine hard-codes one US Letter portrait page.
 *   pdf-to-png          "with a transparent or white background" — the runner
 *                       never passes a background; the rasterizer paints white.
 *   watermark-pdf       "text or image watermark … and tiling" — one text
 *                       string, drawn once per page. (Both built 2026-10-24;
 *                       the rule is retired into a positive output check.)
 *   html-to-pdf         "HTML files or snippets" + "Choose your options." —
 *                       one file picker, and `{}` as the job's options.
 *   pdf-to-word         "while preserving layout and text flow" — one bare
 *                       `<w:p>` per extracted line.
 *   pdf-to-excel        "tables … with rows and columns intact" — every line
 *                       is a row, blank cells are dropped, commas split cells.
 *   pdf-to-powerpoint   "Turn PDFs into editable slides." — one unpositioned
 *                       text box per slide, no pictures.
 *   merge-pdf           "Drag pages or files into the order you want." — the
 *                       engine takes whole files, and so does the runner.
 *                       (Since 2026-10-24 a file may give only SOME of its
 *                       pages, but always in its own order: the probe asks
 *                       for a reversed selection and reads the order back.)
 *   word-to-pdf         "DOCX and DOC into pixel-perfect PDF." / "…while
 *                       preserving layout, fonts, and formatting." — LibreOffice
 *                       lays it out, and the worker image installs no
 *                       Word-metric faces (rule added 2026-09-27).
 *
 * Nothing caught any of them because every existing copy guard asked a
 * different question — is it too long, does it say "upload", does it hedge —
 * and none asked the only one that matters here: IS IT TRUE OF THE TOOL?
 *
 * ── THE PROPERTY, NOT THE MECHANISM (house rule 2) ──────────────────────────
 *
 * Each rule below pairs a CLAIM SHAPE with a CAPABILITY PROBE, and the probe
 * asks the tool, never the copy:
 *
 *   - where the engine can run under Node, it is RUN and its output DECODED
 *     (the DOCX/XLSX/PPTX parts, the PDF page box and draw matrix, the merged
 *     page order) — the thing a user downloads, not the function that makes it;
 *   - where the capability is a request field, the request is captured ON THE
 *     WIRE through the real client with a stub transport (html-to-pdf);
 *   - where it is a worker dependency, the production dependency factory is
 *     called (`signatureRequestDeps()`);
 *   - only where the capability lives in a browser component is the source
 *     read — and then the component is REACHED through the dispatch the page
 *     itself uses (registry → tool-runner switch → module, or the tool page's
 *     panel ternary), never named here.
 *
 * When a probe finds the capability, the rule does NOT lift quietly: it goes
 * red with "re-evaluate", because a capability arriving is exactly the moment
 * someone must decide what the copy may now say. A guard that silently stopped
 * guarding on that day would license whatever copy happened to be lying around.
 *
 * ── THE SUBJECTS ARE DISCOVERED, AND SO IS THE COPY (house rule 4) ──────────
 *
 * No tool slug below is typed as a subject. Each rule derives its subject set
 * from the thing that must already be true for the tool to work: the runner
 * registry's kind, the engine's own tool constant, the panel the tool page
 * mounts. The copy is read through the functions the pages call — the
 * JSON-LD builders, `toolFacts`, the `@/lib/tools/page-copy` accessors (the
 * authored title, description, intro, use cases, steps and FAQ the tool page
 * renders), and every guide whose `tools` field names the subject — so the
 * corpus is what a crawler and a reader receive. It read `howToSteps` and
 * `toolFaq` until the authored content landed (seo/content); from then those
 * were no longer what the page served, and the corpus scanned copy no reader
 * received.
 *
 * The page modules themselves are NOT imported: importing the tool page
 * evaluates every worker panel, and one panel test mocks its client, so under
 * `isolate: false` this file would re-import a panel cached bound to that stub
 * (`src/tests/mock-isolation.test.ts` said so on the first run). The meta tags
 * are covered instead by reading WHICH fields each page's `generateMetadata`
 * hands to `buildMetadata` — a test below fails if a page starts serving a
 * field this corpus does not read.
 *
 * ── WHOSE SENTENCE IS IT? ───────────────────────────────────────────────────
 *
 * A guide about merging legitimately says "Organize Pages rearranges pages";
 * a guide about signing legitimately says Sign PDF does self-signing. So a
 * sentence is attributed to a subject only if it names the subject, or names
 * no tool at all inside the subject's own page, its primary guide, or a
 * paragraph whose last named tool was the subject (so "use Request Signatures
 * instead — it sends…" and a following "It prepares…" are both attributed).
 * Tool names are masked before the claim shapes run, so the tool called
 * "Extract Tables" is not read as a claim to extract tables. Questions are not
 * claims — a FAQ question is answered by its answer, which IS scanned — and
 * that exemption has its own control below.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { createRequire } from "node:module";
import {
  concatTransformationMatrix,
  drawObject,
  PDFDocument,
  PDFArray,
  PDFRawStream,
  decodePDFRawStream,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingRgbColor,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { tools, getToolBySlug } from "@/lib/tools";
import { guides } from "@/lib/guides";
import type { Guide } from "@/lib/guides";
import type { Tool } from "./types";
import { PDF_TO_WORD_KEEPS, toolFacts } from "./tool-facts";
import {
  cardSummary,
  pageDescription,
  pageFaq,
  pageIntro,
  pageSteps,
  pageTitle,
  pageUseCases,
} from "./page-copy";
import { withoutComments } from "./copy-surface";
import {
  articleSchema,
  faqPageSchema,
  howToSchema,
  toolApplicationSchema,
} from "@/lib/structured-data";
import { getRunnerKind, supportedToolSlugs } from "@/lib/pdf/registry";
import { imagesToPdf } from "@/lib/pdf/image-to-pdf";
import {
  DEFAULT_IMAGE_PAGE_OPTIONS,
  IMAGE_MARGINS,
  IMAGE_PAGE_SIZES,
  imagePageSizeById,
} from "@/lib/pdf/image-page-layout";
import { imagePageSizeForLocales } from "@/lib/pdf/image-page-defaults";
import { mergePdfs } from "@/lib/pdf/engine";
import { addWatermark } from "@/lib/pdf/watermark";
import { signatureRequestDeps } from "@/lib/workers/request-signatures/native";
import {
  PDF_OFFICE_EXPORT_TOOLS,
  PDF_TO_EXCEL_TOOL,
  PDF_TO_POWERPOINT_TOOL,
  PDF_TO_WORD_TOOL,
  runPdfOfficeExport,
  type PdfFlowExtractor,
  type PdfOfficeExportTool,
} from "@/lib/workers/pdf-office-export/engine";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { flowText } from "@/lib/workers/pdf-text/flow";
import { readDocxStructure } from "@/lib/workers/pdf-office-export/docx-structure";
import { parseBboxFlow } from "@/lib/workers/pdf-text/parse";
import { OFFICE_METRIC_CLONES } from "@/lib/workers/office-conversion/fonts";
import {
  MAX_PICTURE_SIDE,
  scanPdfPages,
} from "@/lib/workers/pdf-office-export/page-scan";
import {
  docxTypefaceOf,
  OFFICE_FAMILIES,
  typefaceFor,
} from "@/lib/workers/pdf-office-export/typeface";
import {
  DOCX_TABLE_WRAPS_PROBE,
  DOCX_TYPEFACES_PROBE,
  docxTableWrapsProbePdf,
  docxTypefacesProbePdf,
} from "@/lib/workers/pdf-office-export/capability";
import {
  MAX_DECODED_IMAGE_PIXELS,
  MAX_DOCX_PICTURES,
} from "@/lib/workers/pdf-office-export/picture-limits";
import { getToolContent } from "./content";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import {
  cellGridPdf,
  ceilingPairPdf,
  damageContentStreams,
  imageCaptionPdf,
  junkAfterEofPdf,
  linesPdf,
  repairStandIn,
} from "@/tests/pptx-fidelity-fixtures";
import { encryptPdf } from "@/tests/encrypted-pdf";
import { readDeck } from "@/tests/pptx-deck-read";
import { noPictures } from "@/tests/page-scan-stubs";
import {
  boldItalicPdf,
  coveredPicturePdf,
  inlineImagesPdf,
  repeatedPicturesPdf,
  stencilPicturePdf,
} from "@/tests/docx-picture-fixtures";
import { flowStandIn } from "@/tests/poppler-flow-standin";
import { readDocxBody } from "@/lib/workers/pdf-office-export/docx-read";
import { SPANNING_TABLE_BBOX, TWO_COLUMN_BBOX } from "@/tests/poppler-samples";
import { runWorkerHtmlToPdf } from "@/lib/workers/html-render-client";
import type { FetchLike } from "@/lib/workers/pdf-security-client";
import { resetUploadedThisSessionForTests } from "@/lib/uploads/session-uploads";
import { ADVERTISED_WORKER_CAPABILITIES } from "@/lib/workers/observability";
import { panelDispatchArms, panelFile } from "@/tests/worker-panel-dispatch";
import { runnerModuleOf } from "@/tests/tool-panel-modules";
import { compareExtractedPdfText } from "@/components/tools/runner/compare/compare-result";
import {
  comparablePdf,
  linesPdf as compareLinesPdf,
  body as compareBody,
  pageHeaderPair,
} from "@/tests/compare-fixtures";
import { rangeText, runCompareViewChain } from "@/tests/compare-view-chain";
import { overlayFirstPage } from "@/tests/compare-overlay-chain";
import {
  REDLINE_CSP,
  buildRedlineHtml,
} from "@/components/tools/runner/compare/redline-html";
import { JSDOM } from "jsdom";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/* ------------------------------------------------------------------ *
 *  Discovery: which component serves which slug.
 * ------------------------------------------------------------------ */

const RUNNER_DIR = "src/components/tools/runner";
const TOOL_PAGE = "src/app/tools/[slug]/page.tsx";

/** registry kind → runner module path, through the switch the page mounts. */
function runnerFileForKind(kind: string): string | undefined {
  const dispatch = read(`${RUNNER_DIR}/tool-runner.tsx`);
  const component = new RegExp(
    `case\\s+"${kind}":[\\s\\S]{0,200}?<([A-Z][A-Za-z]*)`,
  ).exec(dispatch)?.[1];
  if (!component) return undefined;
  // Through the dispatcher's own bindings — a static import, or the
  // `next/dynamic` loader every runner has been since 2026-10-09 — to the
  // module that defines it. (An import regex here went blind to the loaders.)
  return runnerModuleOf(component);
}

/** Runner slugs of one registry kind — the registry is what the page reads. */
function slugsOfKind(kind: string): string[] {
  return supportedToolSlugs.filter((slug) => getRunnerKind(slug) === kind);
}

/**
 * Panel component → the slugs the tool page mounts it for, read from the
 * registry the page indexes (`@/components/tools/worker-panels`) through the
 * one parse every source-reading guard shares.
 *
 * WAS a private parse of the page's own ternary chain (`tool.slug === "a" ||
 * tool.slug === "b" ? (<ErrorBoundary …><Panel`). The chain became a registry
 * (WP-06, 2026-10-10); a private copy of the old parse would have found no
 * arms at all and handed every rule below an empty subject list.
 */
function panelMounts(): Map<string, string[]> {
  return new Map(panelDispatchArms().map((arm) => [arm.component, arm.slugs]));
}

/** A panel component's module file, as the registry imports it. */
function panelModule(component: string): string | undefined {
  const arm = panelDispatchArms().find((a) => a.component === component);
  return arm ? panelFile(arm) : undefined;
}

/**
 * Every component module a panel's page can load, walked from the panel
 * module through its static AND dynamic (`import("./x")`, `next/dynamic`)
 * imports of other modules under `src/components/` — so a capability that
 * lives in a lazily loaded child is seen. A specifier under
 * `src/components/` that resolves to no file is FATAL (a walk that silently
 * dropped an edge would report a smaller panel than ships).
 */
function panelGraph(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = read(file);
    const dir = path.posix.dirname(file);
    for (const m of source.matchAll(
      /(?:from\s+|import\s*\(\s*)["']((?:\.{1,2}\/|@\/components\/)[^"']+)["']/g,
    )) {
      const spec = m[1]!;
      const base = spec.startsWith("@/")
        ? `src/${spec.slice(2)}`
        : path.posix.normalize(`${dir}/${spec}`);
      if (!base.startsWith("src/components/")) continue;
      const hit = [".tsx", ".ts", "/index.tsx", "/index.ts"]
        .map((ext) => base + ext)
        .find((f) => existsSync(path.join(ROOT, f)));
      if (!hit) throw new Error(`${file}: ${spec} resolves to no module`);
      visit(hit);
    }
  };
  visit(entry);
  return [...seen];
}

/* ------------------------------------------------------------------ *
 *  The served corpus.
 * ------------------------------------------------------------------ */

/** Every human-language string leaf of a value (metadata, JSON-LD). */
function prose(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    // A leaf with no space is an id, a URL, a type or a date — never a claim,
    // and `/tools/x/opengraph-image` would otherwise read as "image".
    if (/\s/.test(value.trim())) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) prose(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) prose(v, out);
  }
  return out;
}

interface Container {
  readonly where: string;
  /** The subject a tool-less sentence belongs to here, if any. */
  readonly home: string | null;
  readonly texts: readonly string[];
}

const GUIDE_PAGE = "src/app/guides/[slug]/page.tsx";

/**
 * The `<entity>.<field>` reads inside a page's `generateMetadata` — what its
 * meta tags are built from. The containers below read the same fields, and the
 * test "the meta fields a page serves are all in the corpus" holds the two
 * together.
 */
function metadataFields(pageFile: string, entity: string): string[] {
  const source = withoutComments(read(pageFile));
  const body =
    // The whole function, not the first call: its first `buildMetadata` is
    // the not-found branch, which reads no field at all.
    /export async function generateMetadata[\s\S]*?\n\}\r?\n/.exec(source)?.[0];
  if (!body || !body.includes("buildMetadata("))
    throw new Error(`${pageFile}: no generateMetadata/buildMetadata found`);
  return [
    ...new Set([
      ...[...body.matchAll(new RegExp(`\\b${entity}\\.(\\w+)`, "g"))].map(
        (m) => m[1]!,
      ),
      // A copy accessor handed the entity (`pageTitle(tool)`) is a field too:
      // the tool page's title and description come through
      // `@/lib/tools/page-copy`, and a direct-field scan alone misses them.
      ...[...body.matchAll(new RegExp(`\\b(\\w+)\\(${entity}\\)`, "g"))].map(
        (m) => `${m[1]!}()`,
      ),
    ]),
  ].sort();
}

/** Fields of each entity the containers read as served meta copy. */
const TOOL_META_FIELDS = [
  "keywords",
  "name",
  "pageDescription()",
  "pageTitle()",
  "slug",
  "tagline",
];
const GUIDE_META_FIELDS = ["description", "keywords", "slug", "title"];

async function toolContainer(tool: Tool): Promise<Container> {
  const texts = [
    // <title> and og:title, and the meta description, as the page serves them.
    pageTitle(tool),
    pageDescription(tool),
    tool.tagline,
    // The home page card's line (the tagline, or the plain summary that
    // stands in for it there).
    cardSummary(tool),
    tool.description,
    // og:image:alt, exactly as the page composes it.
    `${tool.name} — ${tool.tagline}`,
    ...tool.keywords,
    ...toolFacts(tool.slug).flatMap((f) => [f.label, f.value]),
    ...prose(toolApplicationSchema(tool)),
    // "About this tool": the authored intro and use cases.
    ...pageIntro(tool),
    ...pageUseCases(tool).flatMap((u) => [u.title, u.body]),
    ...prose(howToSchema(tool.name, pageSteps(tool))),
    ...prose(
      faqPageSchema(pageFaq(tool).map((e) => ({ q: e.question, a: e.answer }))),
    ),
  ];
  return { where: `/tools/${tool.slug}`, home: tool.slug, texts };
}

async function guideContainer(
  guide: Guide,
  subject: string,
): Promise<Container> {
  const texts = [
    guide.title,
    guide.description,
    ...guide.keywords,
    ...prose(articleSchema(guide)),
    ...prose(howToSchema(guide.title, guide.steps)),
    ...prose(
      faqPageSchema(guide.faq.map((e) => ({ q: e.question, a: e.answer }))),
    ),
    ...guide.intro,
    ...guide.sections.flatMap((s) => [s.heading, ...s.body]),
  ];
  return {
    where: `/guides/${guide.slug}`,
    home: guide.tools[0] === subject ? subject : null,
    texts,
  };
}

async function containersFor(subject: string): Promise<Container[]> {
  const tool = getToolBySlug(subject);
  if (!tool) throw new Error(`subject "${subject}" is not in the catalogue`);
  const out = [await toolContainer(tool)];
  // Every guide that lists the tool, AND every guide that NAMES it. Until
  // 2026-11-15 only the first: the Edit PDF guide's "it exports the PDF's
  // selectable text ... as plain paragraphs" about PDF to Word was served
  // for a day after the PDF to Word guides had been corrected, because no
  // guide set this function built held it (CLAUDE.md rule 4: a named set
  // cannot see what it does not name). A guide that only names the tool is
  // not its home, so only the sentences that name it are attributed.
  for (const guide of guides) {
    const container = await guideContainer(guide, subject);
    if (
      guide.tools.includes(subject) ||
      container.texts.some((t) => t.includes(tool.name))
    )
      out.push(container);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Attribution.
 * ------------------------------------------------------------------ */

/** Tool names, longest first, so a name inside a longer name masks as the longer. */
const NAMES = tools
  .map((t) => ({ name: t.name, slug: t.slug }))
  .sort((a, b) => b.name.length - a.name.length);

const MASK = "\u27e6tool\u27e7";

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

interface Attributed {
  readonly sentence: string;
  /** The sentence with every tool name masked — what the shapes run against. */
  readonly masked: string;
}

/**
 * The sentences of `container` that make a statement about `subject`.
 * The controls below run THIS function, not a copy of it.
 */
function attributedTo(container: Container, subject: string): Attributed[] {
  const out: Attributed[] = [];
  for (const text of container.texts) {
    let current: string | null = container.home;
    for (const sentence of sentencesOf(text)) {
      let masked = sentence;
      const named: string[] = [];
      for (const { name, slug } of NAMES) {
        if (masked.includes(name)) {
          named.push(slug);
          masked = masked.split(name).join(MASK);
        }
      }
      if (named.includes(subject)) current = subject;
      else if (named.length > 0) current = named[0]!;
      if (current !== subject) continue;
      // A question asserts nothing; its answer is a separate text and is read.
      if (sentence.endsWith("?")) continue;
      out.push({ sentence, masked });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Engine fixtures — the outputs a user would download.
 * ------------------------------------------------------------------ */

const JPG_1X1 = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ap//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8Qf//Z",
    "base64",
  ),
);

/**
 * A JPEG whose frame header declares `width`×`height`. pdf-lib embeds JPEG
 * bytes as-is (DCTDecode) and sizes them from the SOF marker, so the page
 * geometry it produces is exactly the geometry a real photo of that size gets.
 */
function jpegOfSize(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(JPG_1X1);
  for (let i = 0; i < bytes.length - 8; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xc0) {
      bytes[i + 5] = height >> 8;
      bytes[i + 6] = height & 0xff;
      bytes[i + 7] = width >> 8;
      bytes[i + 8] = width & 0xff;
      // Zero bytes (legal scan data) before the end marker, so the header's
      // size is one the data could hold: raster-check.ts refuses a header
      // claiming more than 2,048 px a byte of scan (hostile matrix CI-02).
      const pad = Math.ceil((width * height) / 2048);
      const out = new Uint8Array(bytes.length + pad);
      out.set(bytes.subarray(0, -2));
      out.set(bytes.subarray(-2), bytes.length - 2 + pad);
      return out;
    }
  }
  throw new Error("fixture has no SOF0 marker");
}

type Matrix = [number, number, number, number, number, number];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

/** Decode page 1 of a PDF: its size, and the box every image XObject is drawn in. */
async function decodeFirstPage(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const { width, height } = page.getSize();
  const contents = page.node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  let ops = "";
  for (const stream of streams) {
    if (stream instanceof PDFRawStream)
      ops += new TextDecoder().decode(decodePDFRawStream(stream).decode());
  }
  const images: { x: number; y: number; w: number; h: number }[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const tokens = ops.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const op = tokens[i]!;
    if (op === "q") stack.push(ctm);
    else if (op === "Q") ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (op === "cm") {
      const m = tokens.slice(i - 6, i).map(Number) as Matrix;
      ctm = multiply(m, ctm);
    } else if (op === "Do" && tokens[i - 1]?.startsWith("/Image")) {
      images.push({ x: ctm[4], y: ctm[5], w: ctm[0], h: ctm[3] });
    }
  }
  return { width, height, images };
}

function stubExtract(pages: string[]): () => Promise<ExtractedPdfText> {
  const text = pages.join("\n\f");
  return async () =>
    ({
      pageCount: pages.length,
      pages: pages.map((t, i) => ({ pageNumber: i + 1, text: t })),
      text,
      characterCount: text.length,
      hasText: true,
    }) as unknown as ExtractedPdfText;
}

/**
 * Both extractors, as production wires them. PDF to Word reads `extractFlow`
 * since the wave-1 L03 merge (2026-09-28) and answers `unsupported` without
 * it; by default it is served each page's lines as one-cell paragraphs, and a
 * probe about Word's LAYOUT passes poppler's real output instead. Since
 * 2026-10-17 Word also reads the page reader: over that stub (bytes that are
 * not a PDF) a reader that finds no picture; with `picture`, a real PDF of
 * the lines with a picture on page 1, read by the real reader, its text in
 * poppler's frame (stood in for).
 */
async function officeParts(
  tool: PdfOfficeExportTool,
  pages: string[],
  extractFlow?: PdfFlowExtractor,
  { picture = false }: { picture?: boolean } = {},
): Promise<Record<string, string>> {
  const word = tool === PDF_TO_WORD_TOOL;
  const flow: PdfFlowExtractor =
    word && picture
      ? flowStandIn
      : (extractFlow ??
        (async () => ({
          pageCount: pages.length,
          pages: pages.map((t, i) => ({
            pageNumber: i + 1,
            paragraphs: t
              .split("\n")
              .filter((l) => l.trim())
              .map((l) => [l.trim()]),
          })),
        })));
  // PowerPoint reads the pages themselves since 2026-10-10: its probe is a
  // real PDF of these lines (and, with a picture on page 1, the thing the
  // owner reported missing) through the real page reader. The stub
  // extraction alone answers `unsupported` for it.
  const input =
    tool === PDF_TO_POWERPOINT_TOOL || (word && picture)
      ? (
          await linesPdf(
            pages.map((t) =>
              t
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean),
            ),
            { picture: true },
          )
        ).pdf
      : new Uint8Array([1]);
  const run = await runPdfOfficeExport(tool, input, {
    extract: stubExtract(pages),
    extractFlow: flow,
    scanPages: word && !picture ? noPictures : scanPdfPages,
  });
  if (!run.ok) throw new Error(`${tool} export failed: ${run.message}`);
  const zip = await JSZip.loadAsync(run.output);
  const parts: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) {
    const file = zip.file(name);
    if (file) parts[name] = await file.async("string");
  }
  return parts;
}

/**
 * Cell text by reference (A1, B2…) from the exported sheet — inline strings
 * AND number cells.
 *
 * It read inline strings only until the wave-1 L03 merge (2026-09-28), when
 * the engine began writing amounts as numbers (`<v>`). Those cells were then
 * invisible here, and the "rows and columns intact" probe below stayed
 * "absent" because the price it looked for had become a number, not because
 * the column was wrong: a pass in the convenient direction.
 */
async function sheetCells(lines: string[]): Promise<Map<string, string>> {
  const parts = await officeParts(PDF_TO_EXCEL_TOOL, [lines.join("\n")]);
  const sheet = parts["xl/worksheets/sheet1.xml"] ?? "";
  const cells = new Map<string, string>();
  for (const m of sheet.matchAll(
    /<c r="([A-Z]+\d+)"[^>]*>(?:<is><t[^>]*>([^<]*)<\/t><\/is>|<v>([^<]*)<\/v>)/g,
  ))
    cells.set(m[1]!, m[2] ?? m[3]!);
  return cells;
}

/** The `options` object the real html-to-pdf client puts on the wire. */
async function htmlJobOptionsOnTheWire(): Promise<Record<string, unknown>> {
  let body: { options?: Record<string, unknown> } | undefined;
  const reply = (status: number, value: unknown) => ({
    ok: status < 400,
    status,
    json: async () => value,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  const fetchImpl = (async (input, init) => {
    if (input === "/api/uploads")
      return reply(200, {
        slots: [
          {
            fileId: "f1",
            filename: "page.html",
            url: "https://upload.invalid/slot",
            method: "PUT",
            headers: {},
          },
        ],
      });
    if (input === "https://upload.invalid/slot") return reply(200, {});
    if (input === "/api/jobs") {
      body = JSON.parse(new TextDecoder().decode(init?.body));
      return reply(400, { error: { code: "stop", message: "captured" } });
    }
    throw new Error(`unexpected request to ${input}`);
  }) as FetchLike;
  try {
    await runWorkerHtmlToPdf(
      {
        filename: "page.html",
        bytes: new TextEncoder().encode("<p>hello</p>"),
      },
      { fetchImpl },
    );
  } finally {
    // The client flags "a file left this device" in module state, and vitest
    // runs files in a shared module cache: leave nothing behind.
    resetUploadedThisSessionForTests();
  }
  if (!body) throw new Error("the client never created the job");
  return body.options ?? {};
}

/* ------------------------------------------------------------------ *
 *  The rules.
 * ------------------------------------------------------------------ */

interface Probe {
  /** True when the tool, as shipped, HAS the capability the shapes describe. */
  readonly present: boolean;
  readonly evidence: string;
}

interface ClaimRule {
  readonly id: string;
  /** Derived, never typed. */
  readonly subjects: () => string[];
  /** The claim, by shape. */
  readonly shapes: Readonly<Record<string, RegExp>>;
  /**
   * Sentences that ARE the claim. Every shape must catch at least one and
   * every entry must be caught (rule 1). `shipped` ones are verbatim from the
   * audit base; the rest are the synonyms a rewrite would reach for.
   */
  readonly shipped: readonly string[];
  readonly synonyms: readonly string[];
  /** Honest near-misses the rewrite relies on: none may be caught. */
  readonly honest: readonly string[];
  readonly probe: () => Promise<Probe>;
}

const PPTX_EDITABLE_RULE = "PDF to PowerPoint slides are editable";

/**
 * INVERTED 2026-10-24 (history kept). This rule sat in RULES from the audit
 * at 67e8d0f — the catalogue promised "control over orientation, margins,
 * and page size" over an engine that drew one fixed US Letter page — and its
 * probe asked the runner for any control naming those settings. On
 * 2026-10-24 the runner gained Page size, Orientation and Margin chips
 * (pdf/image-page-layout.ts) and the probe went red, as it was written to.
 *
 * Its claims are now TRUE, so it no longer bans them: it pins them. The
 * corpus still has to be caught in both directions (rule 1), the probe must
 * now find the controls, and the shipped sentences are checked against the
 * engine's output in "the replacement copy states what the output actually
 * is" below — a size or margin the copy names must be one the runner offers
 * and the engine draws.
 */
const IMAGE_PAGE_SETUP_RULE: ClaimRule = {
  id: "image-to-PDF offers page size, orientation or margin controls",
  subjects: () => slugsOfKind("image-to-pdf"),
  shapes: {
    "control over":
      /\bcontrols?\s+(?:over\s+)?(?:the\s+)?(?:page size|orientation|margins?)\b/i,
    "set/choose/adjust":
      /\b(?:set|choose|adjust|pick|change)\s+(?:the\s+|your\s+)?(?:page size|orientation|margins?)\b/i,
    "a setting that decides":
      /\b(?:page size|orientation|margins?)\s+(?:sets?|decides?|controls?)\b/i,
    "the three settings": /\bthree\s+settings\b|\bset all three\b/i,
  },
  shipped: [
    "Combine JPG images into a PDF with control over orientation, margins, and page size.",
    "Control page size, margins, and orientation.",
    "The tool combines your JPGs into one tidy PDF and gives you control over page size, orientation, and margins along the way.",
    "Set the page size for the finished PDF.",
    "Choose the orientation, so pages run tall or wide to match your photos.",
    "Adjust the margins to control how much space surrounds each image.",
    "Three settings shape the finished PDF.",
    "Page size sets the dimensions of the pages your images are placed on.",
    "Orientation decides whether those pages run tall or wide — useful when some photos were shot sideways.",
    "Margins control the breathing room between each image and the edge of the page.",
    "Set all three before you run the conversion.",
    "It assembles your JPG images into a single PDF, with control over the page size, orientation, and margins of the result.",
  ],
  synonyms: ["Pick your page size before converting."],
  // Once the honest replacements; the second is now FALSE and is the
  // corpus of the fixed-layout rule in RULES.
  honest: [
    "Every image goes on its own US Letter page in portrait orientation, centred with a half-inch white margin.",
  ],
  probe: async () => {
    const found = imageRunnerPageSetup();
    return { present: found.length > 0, evidence: found.join("; ") };
  },
};

/**
 * The page-setup controls the image runner offers, read from the module the
 * page mounts (slug → registry → dispatcher → runner), comments stripped.
 */
function imageRunnerPageSetup(): string[] {
  const kinds = new Set(
    slugsOfKind("image-to-pdf").map((s) => getRunnerKind(s)!),
  );
  const found: string[] = [];
  for (const kind of kinds) {
    const file = runnerFileForKind(kind);
    if (!file) throw new Error(`no runner module for kind ${kind}`);
    found.push(...pageSetupWords(read(file)).map((w) => `${file}: "${w}"`));
  }
  return found;
}

function pageSetupWords(source: string): string[] {
  return [
    ...withoutComments(source).matchAll(/page size|orientation|margin/gi),
  ].map((m) => m[0]);
}

const RULES: readonly ClaimRule[] = [
  {
    id: "signature requests are sent, tracked, collected or legally binding",
    subjects: () => {
      const mounts = panelMounts().get("RequestSignaturesWorkerPanel") ?? [];
      return mounts;
    },
    shapes: {
      "the tool sends":
        /\b(?:it|which|that|tool)\s+(?:sends|emails|delivers|routes)\b/i,
      "send a document to": /\bsends?\s+(?:a|the|your)\s+document\s+to\b/i,
      "tracks status": /\btracks?\s+(?:the\s+|signing\s+)?status\b/i,
      "collects e-signatures":
        /\bcollects?\s+(?:[\w-]+\s+){0,2}e-?signatures?\b/i,
      "legally binding": /\blegally[- ]binding\b/i,
      "audited e-signatures": /\baudited\s+e-?signatures?\b/i,
    },
    shipped: [
      "Collect legally-binding e-signatures.",
      "Send a document to others, track status, and collect audited e-signatures in order.",
      "When the signature you need is someone else's, use Request Signatures instead — it sends a document to others, tracks status, and collects audited e-signatures in order.",
      "To collect signatures from others, use the Request Signatures tool, which sends a document to recipients, tracks status, and collects audited e-signatures in order.",
    ],
    synonyms: ["The tool emails each signer and routes the PDF in order."],
    honest: [
      "You send it yourself.",
      "Download the ZIP with the prepared PDF, manifest and audit trail, then send the PDF to your signers yourself.",
      "pdf.xyz does not deliver, track, or certify the signatures.",
      "Nothing is emailed or tracked for you.",
    ],
    probe: async () => {
      // THE PROPERTY: can anything be delivered to a signer? The production
      // dependency factory is what the worker runtime calls; a provider wired
      // there is the only way a request can leave the package.
      const deps = signatureRequestDeps();
      return {
        present: deps.delivery !== undefined,
        evidence: `signatureRequestDeps().delivery = ${JSON.stringify(deps.delivery)}`,
      };
    },
  },
  {
    // THE INVERSE of the rule this slot held until 2026-10-24 ("image-to-PDF
    // offers page size, orientation or margin controls", now
    // IMAGE_PAGE_SETUP_RULE above): the controls arrived, so the claim that
    // went false is the replacement copy's — "the page is fixed". Its corpus
    // is what the pages served while that was true.
    id: "image-to-PDF says its page size, orientation or margin is fixed",
    subjects: () => slugsOfKind("image-to-pdf"),
    shapes: {
      "no setting":
        /\bno\s+(?:page[- ]size|orientation|margin)\b[^.]*\bsettings?\b/i,
      "is fixed":
        /\b(?:page size|page|layout|orientation|margins?)\b[^.]{0,40}\b(?:are|is)\s+fixed\b/i,
      "the same for every image":
        /\b(?:the page is the same for every|every page comes out the same shape)\b/i,
    },
    shipped: [
      "There is no page-size, orientation or margin setting.",
      "The tool has no page-size, orientation or margin settings today.",
      "Every page comes out the same shape: a white, portrait US Letter page.",
      "There is no page-size, orientation or margin setting: the page is the same for every photo, which keeps a stack of mismatched pictures reading as one document.",
      "The page size, orientation and margin are fixed — there is no setting to change them.",
    ],
    synonyms: ["The layout is fixed.", "There are no page size settings."],
    honest: [
      // Was "that page is US Letter (8.5 × 11 in) portrait with a 0.5 in
      // margin." until 2026-11-07, when the paper began following the
      // browser's region (audit jpg-to-pdf#1).
      "Unless you change the page setup, that page is portrait with a 0.5 in margin, and its size is A4 (8.27 × 11.69 in), or US Letter (8.5 × 11 in) if your browser's preferred language is set for a country that uses Letter paper, such as the United States, Canada, Mexico or the Philippines.",
      "Fit to image makes each page the size of its image instead, plus the margin.",
      // Was "smaller ones are never enlarged." until 2026-11-08, when the
      // Small images choice arrived (audits jpg-to-pdf#4 / png-to-pdf#4).
      "Larger images are scaled down to fit; smaller ones keep their own size unless you choose Enlarge to fit under Small images, which scales them up to the margin.",
    ],
    probe: async () => {
      // "Fixed" is true only while the runner offers none of the settings.
      const found = imageRunnerPageSetup();
      return {
        present: found.length === 0,
        evidence: found.length
          ? `the runner offers: ${found.join("; ")}`
          : "no page-setup control in the runner",
      };
    },
  },
  // RETIRED 2026-11-07, history kept: "PDF to PNG produces a transparent
  // background". It held "transparent" and "alpha channel" off the PDF to PNG
  // page (the shipped sentence was "Render PDF pages as crisp, lossless PNG
  // images with a transparent or white background.") while the runner passed
  // no background and capturePdfPages defaulted to "#ffffff". Its probe read
  // both halves, and audit pdf-to-png#5 made it go true, as it was built to:
  // the runner now offers RASTER_BACKGROUNDS and passes `transparent`, and
  // capturePdfPages hands pdf.js an alpha context. What the page may claim is
  // pinned on a real output instead — src/lib/pdf/render-transparent.test.ts
  // reads alpha 0 off a rendered PNG, pdf-to-image-chain.test.tsx reads the
  // choice at pdf.js's render call, and tool-page-substance.test.ts holds the
  // page's wording to the runner's labels.
  // RETIRED 2026-10-24, history kept: "watermarks can be images, logos, or
  // tiled". It held "text or image watermark … and tiling" off every page
  // while WatermarkOptions had no image or tile key, and its probe read that
  // type. The engine now takes `image` (PNG or JPEG) and `position: "tile"`,
  // so the probe went true, as it was built to. Per the rule's own message,
  // the copy may now claim both, and what it may claim is pinned on a real
  // output instead — "Add Watermark: the page says image and tiling exactly
  // when the engine draws them", in the positive section below.
  // CHANGED 2026-11-14 (competitor audit #26), history kept: this rule was
  // "HTML to PDF takes pasted markup or rendering options", with two more
  // shapes — `snippets` and `paste markup` — and a probe that also asked
  // whether the panel had a <textarea>. It read ONE file, the panel module,
  // and so would have certified the new paste box absent forever: the box
  // lives in the panel's lazily loaded children (`html-source-area.tsx` →
  // `html-paste-box.tsx`), a file it did not read (rule 4: the right command
  // over the wrong set). The probe now walks the panel's module graph
  // (`panelGraph`), finds the box, and the paste half went red, as built to.
  // What the copy may claim instead is pinned in the positive section
  // ("HTML to PDF says paste exactly when its panel has a paste box"); the
  // vague "choose your options" stays banned here on its own probe.
  {
    id: "HTML to PDF takes rendering options",
    subjects: () => panelMounts().get("HtmlRenderWorkerPanel") ?? [],
    shapes: {
      "choose options":
        /\b(?:choose|set|pick|adjust)\s+(?:your\s+|the\s+)?options\b/i,
    },
    shipped: ["Choose your options."],
    synonyms: ["Set the options and render it."],
    honest: [
      "Paste a public http(s) URL.",
      "Upload one .html or .htm file over an encrypted connection.",
      "Paste your HTML markup and render it.",
    ],
    probe: async () => {
      // On the wire: the options the real client sends with a plain job.
      const options = await htmlJobOptionsOnTheWire();
      return {
        present: Object.keys(options).length > 0,
        evidence: `job options on the wire: ${JSON.stringify(options)}`,
      };
    },
  },
  {
    id: "PDF to Word preserves layout",
    subjects: () =>
      PDF_OFFICE_EXPORT_TOOLS.filter((t) => t === PDF_TO_WORD_TOOL).map(String),
    shapes: {
      "preserves layout":
        /\bpreserv\w*\s+(?:the\s+)?(?:original\s+)?(?:page\s+)?layout\b/i,
      "layout-preserving": /\blayout[- ]preserving\b/i,
      "text flow": /\btext flow\b/i,
      "carries the layout": /\bcarr(?:y|ies)\s+the\s+layout\b/i,
      "keeps its structure":
        /\bkeeps?\s+(?:its|the)\s+(?:layout|structure|formatting)\b/i,
      "reads like the original": /\breads the way the original\b/i,
      "follows the structure": /\bfollows\s+the\s+structure\b/i,
      "looks like the original":
        /\blooks?\s+like\s+(?:your|the|my)\s+original\b/i,
    },
    shipped: [
      "Convert PDFs into editable Word documents while preserving layout and text flow.",
      "The conversion turns the PDF into an editable Word document while preserving layout and text flow, so you edit the text instead of retyping it.",
      "Open the downloaded DOCX in Word and start editing — the conversion preserves layout and text flow.",
      "The conversion preserves layout and text flow, so the document keeps its structure and reads the way the original did — but the text is live, so you can rewrite a paragraph, fix a date, or restructure a section directly in Word.",
      "That is the point of converting rather than copying and pasting: pasted text loses its arrangement on the page, while the converted DOCX carries the layout with it.",
      "The conversion is built to preserve layout and text flow, so the DOCX follows the structure of the original while staying fully editable.",
    ],
    synonyms: [
      "A layout-preserving PDF to Word conversion.",
      "The DOCX will look like your original PDF.",
    ],
    honest: [
      "Images, fonts, tables and page layout are not recreated.",
      "No — it carries over the text, not the look.",
    ],
    probe: async () => {
      // RE-EVALUATED 2026-10-17, as this rule asks, the day it went red: the
      // .docx began carrying pictures (`<w:drawing>`, `word/media/`) and a
      // section with the PDF's first page size (`<w:sectPr>` with children),
      // and the old detector counted each as layout. Neither is: an INLINE
      // picture flows with the text wherever Word breaks its lines, and a
      // page size says nothing about where anything sits on the page. So the
      // banned shapes stay banned, and the property is now what layout IS —
      // text or pictures placed at the page's positions (anchors, frames,
      // tabs, indents, alignment, spacing), its columns, its tables as
      // tables, its fonts and sizes, a styles or font table part. Asked of
      // a real two-column page as poppler reads it AND of a real page with a
      // picture, so the new markup is in what the detector reads.
      const columns = await officeParts(PDF_TO_WORD_TOOL, [""], async () =>
        flowText(parseBboxFlow(TWO_COLUMN_BBOX)),
      );
      const pictured = await officeParts(
        PDF_TO_WORD_TOOL,
        ["Quarterly report\nThe chart below shows the quarter."],
        undefined,
        { picture: true },
      );
      // RE-EVALUATED 2026-11-15, when each word began to keep its size
      // (`<w:sz>` on its run, `../workers/pdf-office-export/docx-run-style`).
      // In the style of the 2026-10-17 note above: a run's size is a property
      // of a WORD, not a position on the page — it flows wherever Word breaks
      // the line, exactly like an inline picture — so its presence cannot
      // license "preserves layout", and `sz` leaves the detector. Everything
      // else stays: positions (frames, tabs, indents, alignment, spacing),
      // columns, tables as tables, the typeface (`rFonts`), anchors, and a
      // styles or font table part. The banned shapes and the shipped corpus
      // are unchanged.
      // RE-EVALUATED 2026-11-15 again, when tables began to be written as
      // Word tables (backlog #28 slice 2, `w:tbl`): a Word table is a
      // structure that flows with the text wherever Word breaks the page,
      // like an inline picture; its column widths are proportional, not
      // positions on the page, so its presence cannot license "preserves
      // layout", and `tbl` leaves the detector. A third real export (the
      // quarterly table, through the real page reader) is read so the new
      // markup is in what the detector sees.
      // RE-EVALUATED 2026-11-15 a third time, when each word began to be set
      // in an Office family of its kind (backlog #28 slice 4, `w:rFonts` on
      // its run): in the style of the `sz` and `tbl` notes above, a run's
      // typeface is a property of a WORD, not a position on the page — it
      // flows wherever Word breaks the line — so its presence cannot license
      // "preserves layout", and `rFonts` leaves the detector. Whether the
      // PDF's OWN font reaches the file is the "PDF to Word keeps the fonts"
      // rule's question, below.
      const LAYOUT = /<w:(?:cols|framePr|tabs|ind|jc|spacing)\b|<wp:anchor\b/g;
      const { quarterlyTablePdf } = await import("@/tests/pdf-office-fixtures");
      const { TABLE_BBOX } = await import("@/tests/poppler-samples");
      const tableRun = await runPdfOfficeExport(
        PDF_TO_WORD_TOOL,
        await quarterlyTablePdf(),
        {
          extractFlow: async () => flowText(parseBboxFlow(TABLE_BBOX)),
          scanPages: scanPdfPages,
        },
      );
      if (!tableRun.ok) throw new Error(tableRun.message);
      const tabled = {
        "word/document.xml": await (
          await JSZip.loadAsync(tableRun.output)
        )
          .file("word/document.xml")!
          .async("string"),
      };
      if (!/<w:tbl>/.test(tabled["word/document.xml"]))
        throw new Error("the table probe's .docx carries no Word table");
      // The table's own markup is not layout, and none of it may match.
      for (const tag of [
        "<w:tblW",
        "<w:tblGrid",
        "<w:tblLayout",
        "<w:tab/>",
        // Since 2026-11-15 (see LAYOUT above): a word's typeface.
        '<w:rFonts w:ascii="Arial"/>',
      ])
        if ([...tag.matchAll(LAYOUT)].length > 0)
          throw new Error(`the layout detector counts ${tag} as layout`);
      const STYLED = /styles|fontTable/;
      const detect = (parts: Record<string, string>) => [
        ...[...(parts["word/document.xml"] ?? "").matchAll(LAYOUT)].map(
          (m) => m[0],
        ),
        ...Object.keys(parts).filter((p) => STYLED.test(p)),
      ];
      // Health: the picture run carries its picture, so the detector reads
      // the markup the change added; and the detector sees each layout
      // element, through the same function, in a body that has one.
      if (!/<w:drawing>/.test(pictured["word/document.xml"] ?? ""))
        throw new Error("the picture probe's .docx carries no picture");
      for (const tag of [
        // "<w:tbl><w:tr/></w:tbl>" until 2026-11-15 (see LAYOUT above).
        '<w:p><w:pPr><w:ind w:left="720"/></w:pPr></w:p>',
        // Was a `<w:sz>` run until 2026-11-15 (see LAYOUT above).
        '<w:p><w:pPr><w:spacing w:after="240"/></w:pPr></w:p>',
        '<w:p><w:pPr><w:framePr w:x="1440" w:y="1440"/></w:pPr></w:p>',
        "<w:drawing><wp:anchor/></w:drawing>",
      ])
        if (detect({ "word/document.xml": tag }).length === 0)
          throw new Error(`the layout detector misses ${tag}`);
      const found = [
        ...detect(columns),
        ...detect(pictured),
        ...detect(tabled),
      ];
      return {
        present: found.length > 0,
        evidence: `layout elements and parts in three real exports: [${found.join(", ")}]`,
      };
    },
  },
  // Added 2026-11-15 with per-word formatting (backlog #28, slice 1). The
  // page now says each word keeps its bold, italics, size and colour — and
  // the next sentence a rewrite reaches for is "…and its fonts". The writer
  // names no typeface (no `<w:rFonts>`; typefaces are slice 4), so a page
  // that says the fonts are kept is false of every download. NOTHING like it
  // has shipped: `shipped` holds the sentence that rewrite would ship, so the
  // attribution control has a claim to run through, and the synonyms the
  // rest. The probe is the consumer's artifact: a real export of a PDF drawn
  // in three faces, decoded.
  //
  // RE-EVALUATED 2026-11-15 (#28 slice 4, key `docxTypefaces`). Until then
  // the probe's exit condition was the MECHANISM — a run naming a typeface
  // (`<w:rFonts>` present) — and slice 4 makes that true of every download:
  // each matched word now names an Office family. Read as permission, it
  // would have licensed "uses the same fonts as your PDF", which is false
  // for every PDF set in a face Windows and Office do not ship (Helvetica,
  // Minion, a corporate face: each is written as a SUBSTITUTE of its kind).
  // House rule 2: the exit condition names the PROPERTY. The property this
  // rule guards is that the PDF's OWN font reaches the .docx — by name (a
  // `w:rFonts` value that is not an Office family) or by embedding (a
  // `word/fonts/` part, `w:embedRegular`/`w:embedBold`/…, or a font table
  // part). The probe is the typefaces probe's PDF (Helvetica, Times and
  // Courier — none of them an Office family) through the real engine, read
  // back. A writer that passed the PDF's family through (`typeface:
  // run.family`) turns it present, and this rule red. The shapes and
  // `shipped` stay: they are the rewrite this rule exists for.
  {
    id: "PDF to Word keeps the fonts",
    subjects: () =>
      PDF_OFFICE_EXPORT_TOOLS.filter((t) => t === PDF_TO_WORD_TOOL).map(String),
    shapes: {
      "same fonts": /\bsame (?:fonts?|typefaces?)\b/i,
      "original fonts": /\boriginal (?:fonts?|typefaces?)\b/i,
      "keeps the typeface":
        /\b(?:keeps?|keeping|preserv\w*|retain\w*)\s+(?:its\s+|the\s+|their\s+)?(?:fonts?|typefaces?)\b/i,
      "fonts carry over":
        /\b(?:fonts?|typefaces?)\b[^.;]{0,40}?\b(?:carr(?:y|ies) (?:over|across)|are kept|come through)\b/i,
    },
    shipped: [
      "Each word keeps its bold, italics, size and colour, and the document keeps the original fonts.",
    ],
    synonyms: [
      "The Word file uses the same fonts as your PDF.",
      "Words keep their typeface.",
      "Fonts carry over along with sizes and colours.",
    ],
    // Until 2026-11-15 (#28 slice 4) these were the page's, each a DENIAL
    // of the typeface and false since that day (every matched word names an
    // Office family): "The typeface and drawings made of lines and shapes
    // are not carried across, and text recognised by OCR comes through in
    // Word's default style."; "Each word keeps its bold, italics, size and
    // color where they can be matched; the typeface, drawings made of lines
    // and shapes elsewhere on the page, and the page layout are not carried
    // over."; "Typefaces and layout are not recreated; for a scan, tick
    // “Recognise text in scans (OCR)”."; "Open the downloaded DOCX in Word
    // and finish the formatting — the words arrive as paragraphs in reading
    // order, with their bold, italics, sizes and colours where they could be
    // matched, in Word's default typeface." What replaced them, each of
    // which the shapes must let through (reworded in review round 2 to say
    // the kind is a substitute's and when it can be told):
    honest: [
      "A word it matches is also set in a font that comes with Windows or Office, when our reader can tell which: the PDF's own font when it is one of those, such as Arial or Georgia, the one a free look-alike such as Liberation Sans or Carlito was drawn to match, and otherwise Arial, Times New Roman or Courier New, a substitute of the same kind as the PDF's font (sans-serif, serif or monospaced), judged by the font's name or by how the PDF marks it. A word whose font shows neither keeps Word's default font.",
      "The PDF's font files are not copied into the document.",
      "Words in other alphabets, such as Greek, Bengali or Chinese, and symbols carry no font name, so Word picks one, and text recognised by OCR comes through in Word's default style.",
      "Words are set in fonts that come with Windows or Office, a substitute of the same kind as the PDF's font (serif, sans-serif or monospaced) wherever its name or the PDF says which kind it is, and otherwise in Word's default font; the PDF's font files are not copied into the document.",
      "Each word keeps its bold, italics, size and color where they can be matched, and such a word in the Latin alphabet is set in a font that comes with Windows or Office, a substitute of the same kind as the PDF's font where our reader can tell its kind; drawings made of lines and shapes elsewhere on the page, and the page layout, are not carried over.",
      "Turn PDF text and pictures into editable Word (DOCX) in reading order and Office fonts.",
      "Open the downloaded DOCX in Word and finish the formatting — the words arrive as paragraphs in reading order, with their bold, italics, sizes and colours where they could be matched, each set in a font that comes with Windows or Office, a substitute of the same kind as the PDF's where its kind can be told.",
    ],
    probe: async () => {
      const OFFICE = new Set<string>(OFFICE_FAMILIES);
      /** The PDF's own font in a .docx: a non-Office name, or an embedding. */
      const ownFonts = async (bytes: Uint8Array) => {
        const zip = await JSZip.loadAsync(bytes);
        const parts = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir);
        const embedded = parts.filter((n) =>
          /^word\/fonts\/|fontTable/i.test(n),
        );
        for (const n of parts.filter((x) => /\.(?:xml|rels)$/i.test(x)))
          if (
            /<w:embed(?:Regular|Bold|Italic|BoldItalic)\b/.test(
              await zip.file(n)!.async("string"),
            )
          )
            embedded.push(`${n} (w:embed*)`);
        const runs = zip.file("word/document.xml")
          ? (await readDocxStructure(bytes)).blocks.flatMap((b) =>
              b.kind === "p" ? b.runs : [],
            )
          : [];
        const foreign = runs
          .flatMap((r) =>
            [r.fonts, r.fontsHAnsi, r.fontsCs, r.fontsEastAsia].filter(
              (f): f is string => f !== undefined,
            ),
          )
          .filter((f) => !OFFICE.has(f));
        return { runs, embedded, foreign };
      };
      const run = await runPdfOfficeExport(
        PDF_TO_WORD_TOOL,
        await docxTypefacesProbePdf(),
        { extractFlow: flowStandIn, scanPages: scanPdfPages },
      );
      if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
      const real = await ownFonts(run.output);
      // Health: the export DOES name typefaces, so the probe reads the
      // markup slice 4 added (a probe over a body with no w:rFonts would
      // report "absent" for the wrong reason).
      if (!real.runs.some((r) => r.fonts !== undefined))
        throw new Error("the fonts probe's .docx names no typeface");
      // Controls, through the same function: a non-Office name, and an
      // embedded font part, each read as present.
      const doc = (rPr: string) =>
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr>${rPr}</w:rPr><w:t>x</w:t></w:r></w:p></w:body></w:document>`;
      const named = new JSZip();
      named.file("word/document.xml", doc('<w:rFonts w:ascii="Helvetica"/>'));
      const embeddedZip = new JSZip();
      embeddedZip.file("word/document.xml", doc('<w:rFonts w:ascii="Arial"/>'));
      embeddedZip.file("word/fonts/font1.odttf", "x");
      const asBytes = async (z: JSZip) =>
        new Uint8Array(await z.generateAsync({ type: "uint8array" }));
      if ((await ownFonts(await asBytes(named))).foreign.length === 0)
        throw new Error("the fonts detector misses a non-Office w:rFonts");
      if ((await ownFonts(await asBytes(embeddedZip))).embedded.length === 0)
        throw new Error("the fonts detector misses an embedded font part");
      return {
        present: real.foreign.length > 0 || real.embedded.length > 0,
        evidence: `in a real export of Helvetica, Times and Courier: non-Office names [${real.foreign.join(", ")}], embedded [${real.embedded.join(", ")}]`,
      };
    },
  },
  {
    id: "PDF to Excel keeps tables with rows and columns intact",
    subjects: () =>
      PDF_OFFICE_EXPORT_TOOLS.filter((t) => t === PDF_TO_EXCEL_TOOL).map(
        String,
      ),
    shapes: {
      intact: /\bintact\b/i,
      "rows and columns": /\brows and columns\b/i,
      "converts tables": /\b(?:convert|extract|turn)s?\s+(?:the\s+)?tables?\b/i,
      "tables inside PDFs":
        /\btables?\s+(?:inside|in|from)\s+(?:your\s+)?PDFs?\b/i,
    },
    shipped: [
      "Extract tables into spreadsheets.",
      "Convert tables inside PDFs into editable Excel spreadsheets with rows and columns intact.",
    ],
    synonyms: ["Turn the tables in your PDF into a workbook."],
    honest: [
      "Export a PDF’s selectable text to an XLSX sheet: one row per line, cells split at tabs, wide gaps and commas.",
      "Blank cells are dropped, so a value can shift left into the wrong column.",
    ],
    probe: async () => {
      // HISTORY: this asked only whether a blank middle cell kept the price in
      // column C. Since the wave-1 L03 merge (2026-09-28) it does — so, as
      // this rule says, the copy was re-evaluated, and "intact" is still not
      // true: one cell running across two columns MERGES them for the table
      // (layout-grid.ts lists it as not promised; the page says so in
      // XLSX_MERGE_CAVEAT). The property is now both: blanks kept AND a
      // straddling cell leaving the header's three columns apart.
      const blank = await sheetCells([
        "Item      Qty      Price",
        "Pear               4.00",
      ]);
      const straddle = await sheetCells([
        "Item      Qty      Price",
        "A very long description here  2   4.00",
        "Pear      1        3.00",
      ]);
      // Health: the price was decoded in SOME column. A reader blind to
      // number cells (this file's, until the fix above) finds it in neither,
      // and "absent" would then be the reader's answer, not the engine's.
      if (!blank.has("B2") && !blank.has("C2"))
        throw new Error("the probe row's price was decoded in no column");
      const blanksKept = blank.get("C2") === "4.00" && !blank.has("B2");
      const headersApart =
        straddle.get("A1") === "Item" &&
        straddle.get("B1") === "Qty" &&
        straddle.get("C1") === "Price";
      return {
        present: blanksKept && headersApart,
        evidence: `blank row → B2=${JSON.stringify(blank.get("B2"))}, C2=${JSON.stringify(blank.get("C2"))}; straddled header → A1=${JSON.stringify(straddle.get("A1"))}, B1=${JSON.stringify(straddle.get("B1"))}`,
      };
    },
  },
  {
    id: "Merge PDF reorders individual pages",
    subjects: () => slugsOfKind("merge"),
    shapes: {
      "drag pages":
        /\b(?:drag|reorder|rearrange|move|interleave)\w*\s+(?:individual\s+|the\s+|single\s+)?pages\b/i,
      "pages or files": /\bpages or files\b|\bfiles or pages\b/i,
    },
    shipped: [
      "Drag pages or files into the order you want.",
      "Drag pages or files into the order you want; the combined PDF follows your list from top to bottom.",
    ],
    synonyms: ["Reorder individual pages before merging."],
    honest: [
      "Drag files, or use each row's move buttons, to set the order you want.",
      "Drag files into the order you want; the combined PDF follows your list from top to bottom.",
    ],
    probe: async () => {
      // What the engine is ABLE to do: its input is whole files, and every
      // file's pages come out contiguous and in their own order.
      const make = async (widths: number[]) => {
        const d = await PDFDocument.create();
        for (const w of widths) d.addPage([w, 500]);
        return d.save();
      };
      const merged = await PDFDocument.load(
        await mergePdfs([await make([101, 102]), await make([201, 202])]),
      );
      const order = merged.getPages().map((p) => p.getSize().width);
      // Per-file page selection, asked for pages in REVERSE: a selection
      // picks pages, so the file's own order must come back.
      const picked = await PDFDocument.load(
        await mergePdfs([await make([101, 102]), await make([201, 202])], {
          pages: [[1, 0], [1]],
        }),
      );
      const pickedOrder = picked.getPages().map((p) => p.getSize().width);
      const wholeFiles =
        mergePdfs.length === 1 &&
        order.join() === "101,102,201,202" &&
        pickedOrder.join() === "101,102,202";
      return {
        present: !wholeFiles,
        evidence: `mergePdfs takes ${mergePdfs.length} required argument(s); merged page order ${order.join(",")}; reversed selection gave ${pickedOrder.join(",")}`,
      };
    },
  },
  {
    id: "Office to PDF is pixel-perfect or keeps the document's fonts",
    // The tools the page mounts the LibreOffice conversion panel for.
    subjects: () => panelMounts().get("OfficeConversionWorkerPanel") ?? [],
    shapes: {
      // "not a pixel-perfect visual diff" is compare-pdf's honest disclaimer.
      "pixel-perfect": /(?<!\bnot (?:a )?)\bpixel[- ]perfect\b/i,
      "preserves fonts":
        /\b(?:preserv|keep|retain)\w*\s+(?:[\w-]+,?\s+){0,3}(?:and\s+)?fonts\b/i,
      "fonts are kept":
        /\bfonts\s+(?:are|stay|remain)\s+(?:\w+\s+){0,2}(?:kept|preserved|intact|unchanged)\b/i,
      // The same fidelity promise without the word "font": a layout the
      // worker cannot set in the workbook's own faces is not a faithful one.
      faithful: /\bfaithful(?:ly)?\b/i,
    },
    shipped: [
      "DOCX and DOC into pixel-perfect PDF.",
      "Convert Microsoft Word documents to PDF while preserving layout, fonts, and formatting.",
      "Convert Excel workbooks to PDF with faithful table layout and print areas — rendered by LibreOffice on a secure worker that deletes the input when the job finishes.",
    ],
    synonyms: [
      "A pixel perfect copy of your document.",
      "Your fonts are kept exactly as they were.",
      "It keeps your fonts and spacing.",
    ],
    honest: [
      "This is not a pixel-perfect visual comparison.",
      "Scanned pages need OCR first; this is not a pixel-perfect visual diff.",
      "Fonts the worker lacks are substituted.",
      "Images, fonts, tables and page layout are not recreated.",
    ],
    probe: async () => {
      // THE PROPERTY: can the worker lay a Word document out in the faces it
      // was written in? LibreOffice, not Word, does the layout, so the only
      // way it keeps Office line breaks is a metric-compatible face installed
      // in the image that runs the job. The stage is found by what it runs
      // (`worker:daemon`), not by its name.
      //
      // RE-EVALUATED at the wave-1 L03 merge (2026-09-28), as this rule asked
      // the day the Dockerfile gained Carlito and Caladea. What may the copy
      // now claim? Still none of the banned shapes: the clones are
      // SUBSTITUTES with the same metrics, not the document's fonts; there is
      // no clone for Aptos, Word's default face since 2023
      // (office-conversion/fonts.ts leaves it out on purpose); and the
      // running worker has them only once its image is rebuilt, which no test
      // here can see. So "present" now needs every Office default a document
      // is likely to be set in — Aptos included — to have a clone in the
      // image. When that changes, prove it on a real output and decide again.
      const dockerfile = read("Dockerfile");
      const stage = dockerfile
        .split(/^FROM\s/m)
        .find((s) => /^CMD\s.*worker:daemon/m.test(s));
      if (!stage) throw new Error("no Dockerfile stage runs worker:daemon");
      if (!/\blibreoffice\b/.test(stage))
        throw new Error("the worker stage no longer installs libreoffice");
      const fonts: string[] = [...(stage.match(/\bfonts-[a-z0-9-]+/g) ?? [])];
      const installed = OFFICE_METRIC_CLONES.filter((c) =>
        fonts.includes(c.debianPackage),
      ).map((c) => c.office);
      // Health: the list and the image agree on what they have — a probe
      // reading an empty list would report "absent" for the wrong reason.
      if (installed.length === 0)
        throw new Error("no metric clone the font list names is installed");
      const OFFICE_DEFAULTS = ["Calibri", "Cambria", "Aptos"];
      const uncovered = OFFICE_DEFAULTS.filter((f) => !installed.includes(f));
      return {
        present: uncovered.length === 0,
        evidence: `worker stage font packages: ${fonts.join(", ") || "none"}; clones installed for ${installed.join(", ")}; no clone for ${uncovered.join(", ") || "none"}`,
      };
    },
  },
  {
    // Added 2026-10-09. The catalogue description said "its own editable
    // PowerPoint slide" (served as JSON-LD and in site search), and so did
    // the operations row's promise, while the one PowerPoint check this repo
    // has (scripts/prove-pptx-opens.ts) opens every file READ-ONLY with
    // alerts off. Nothing caught it: the "text only" test below asks what the
    // slides lack, capability-hedges reads deferrals, and "editable" is
    // neither.
    id: PPTX_EDITABLE_RULE,
    subjects: () =>
      PDF_OFFICE_EXPORT_TOOLS.filter((t) => t === PDF_TO_POWERPOINT_TOOL).map(
        String,
      ),
    shapes: {
      "editable slide": /\beditable\s+(?:PowerPoint\s+)?slides?\b/i,
      "a slide you can edit":
        /\bslides?\s+(?:you\s+can|you['’]ll\s+be\s+able\s+to|ready\s+to)\s+edit\b/i,
      "edit it in PowerPoint":
        /\bedit(?:able|ing)?\b(?:\s+\w+){0,3}\s+in\s+PowerPoint\b/i,
    },
    shipped: [
      // catalog.ts description, until 2026-10-09.
      "Put each PDF page’s selectable text on its own editable PowerPoint slide. Text only: images, charts and page layout are not carried over.",
      // The audit base's tagline and description (see the docblock).
      "Turn PDFs into editable slides.",
      "Convert each PDF page into an editable PowerPoint slide, rebuilt from the page’s selectable text — on a secure worker that deletes the input when the job finishes.",
      // The operations row's promise for pptxPresentationChain, until 2026-10-09.
      "PDF to PowerPoint turns each page into an editable slide in a complete presentation (slide master, layout and theme), not the slides-only package PowerPoint for Windows refuses as corrupted",
    ],
    synonyms: [
      "Each page becomes a slide you can edit.",
      "Open the .pptx and edit the text in PowerPoint.",
    ],
    honest: [
      "To keep the look instead, PDF to JPG renders each page as an image in your browser that you can place on a slide, though its text will not be editable.",
      "Editing the exported slides has not been tested.",
      "Each slide holds that page's selectable text in a single text box, one paragraph per line.",
    ],
    probe: async () => {
      // THE PROPERTY: a .pptx downloaded from production, edited and saved
      // in PowerPoint, reopens with no repair prompt. Only a person in
      // PowerPoint's own window can check that, and nobody has. What this
      // repo CAN see is its one PowerPoint instrument, and that opens every
      // file read-only (`Presentations.Open(path, ReadOnly = $msoTrue, …)`),
      // so it has never edited one. The day it opens a file writable this
      // goes red. That is NOT the property arriving, only the moment to
      // decide: edit and save a real download in PowerPoint, reopen it, and
      // only then let the copy say "editable".
      const source = read("scripts/prove-pptx-opens.ts");
      const opens = [
        ...source.matchAll(/\bPresentations\.Open\(([^)]*)\)/g),
      ].map((m) => m[1]!.split(",").map((arg) => arg.trim()));
      // Health: a probe that found no call would report "absent" for the
      // wrong reason.
      if (opens.length === 0)
        throw new Error(
          "scripts/prove-pptx-opens.ts no longer calls Presentations.Open",
        );
      const writable = opens.filter((args) => args[1] !== "$msoTrue");
      return {
        present: writable.length > 0,
        evidence: `Presentations.Open calls: ${opens.map((args) => `(${args.join(", ")})`).join("; ")}`,
      };
    },
  },
];

/* ------------------------------------------------------------------ *
 *  The tests.
 * ------------------------------------------------------------------ */

async function offendersOf(rule: ClaimRule, subject: string) {
  const offenders: string[] = [];
  let seen = 0;
  for (const container of await containersFor(subject)) {
    for (const { sentence, masked } of attributedTo(container, subject)) {
      seen += 1;
      for (const [name, shape] of Object.entries(rule.shapes)) {
        if (shape.test(masked))
          offenders.push(`${container.where} [${name}]: "${sentence}"`);
      }
    }
  }
  return { offenders, seen };
}

describe("tool pages do not promise capabilities the tool does not have", () => {
  it("every rule discovers a plausible subject set", () => {
    for (const rule of RULES) {
      const subjects = rule.subjects();
      expect(
        subjects.length,
        `${rule.id}: no subjects discovered`,
      ).toBeGreaterThan(0);
      expect(
        subjects.length,
        `${rule.id}: implausibly many subjects`,
      ).toBeLessThanOrEqual(4);
      for (const slug of subjects)
        expect(getToolBySlug(slug), `${rule.id}: ${slug}`).toBeDefined();
    }
  });

  it("the meta fields a page serves are all in the corpus", () => {
    // If a page starts building its meta tags from a field the containers do
    // not read, that field's copy would reach Google unscanned.
    expect(metadataFields(TOOL_PAGE, "tool")).toEqual(TOOL_META_FIELDS);
    expect(metadataFields(GUIDE_PAGE, "guide")).toEqual(GUIDE_META_FIELDS);
  });

  it("the page's panel dispatch and the engine agree on the PDF→Office set", () => {
    // Two independent derivations of one set. If either drifts, a guard keyed
    // on the other would silently stop covering a tool.
    const mounts = panelMounts();
    expect(
      mounts.size,
      "the tool page's panel chain parsed to nothing",
    ).toBeGreaterThanOrEqual(8);
    expect(
      [...(mounts.get("PdfOfficeExportWorkerPanel") ?? [])].sort(),
    ).toEqual([...PDF_OFFICE_EXPORT_TOOLS].sort());
  });

  it.each(RULES)(
    "$id: every shape catches a claim, and every claim is caught",
    (rule) => {
      const claims = [...rule.shipped, ...rule.synonyms];
      expect(rule.shipped.length).toBeGreaterThan(0);
      const idle = Object.entries(rule.shapes)
        .filter(([, re]) => !claims.some((c) => re.test(c)))
        .map(([name]) => name);
      expect(
        idle,
        `shapes nothing exercises — decoration: ${idle.join(", ")}`,
      ).toEqual([]);
      const missed = claims.filter(
        (c) => !Object.values(rule.shapes).some((re) => re.test(c)),
      );
      expect(
        missed,
        `claims no shape catches — holes: ${missed.join(" | ")}`,
      ).toEqual([]);
      const noisy = rule.honest.filter((h) =>
        Object.values(rule.shapes).some((re) => re.test(h)),
      );
      expect(
        noisy,
        `honest copy the shapes would ban: ${noisy.join(" | ")}`,
      ).toEqual([]);
    },
  );

  it.each(RULES)(
    "$id: the shipped claims are caught THROUGH the attribution, on the subject's own page",
    (rule) => {
      // Positive control through the same pipeline the live check uses — a
      // control that tests the regex beside the pipeline proves nothing
      // about the pipeline.
      const subject = rule.subjects()[0]!;
      const synthetic: Container = {
        where: "control",
        home: subject,
        texts: rule.shipped,
      };
      const caught = attributedTo(synthetic, subject).filter(({ masked }) =>
        Object.values(rule.shapes).some((re) => re.test(masked)),
      );
      expect(caught.length).toBe(rule.shipped.length);
    },
  );

  it("attribution: another tool's sentence in a shared guide is not the subject's", () => {
    const merge = slugsOfKind("merge")[0]!;
    const organize = getToolBySlug("organize-pages")!;
    const guideLike: Container = {
      where: "control",
      home: merge,
      texts: [
        `If you later need the reverse, ${organize.name} rearranges pages inside a single document.`,
        "Drag pages or files into the order you want.",
      ],
    };
    const got = attributedTo(guideLike, merge).map((a) => a.sentence);
    expect(got).toEqual(["Drag pages or files into the order you want."]);
  });

  it("attribution: a pronoun after the subject is the subject's, in someone else's guide", () => {
    const subject = panelMounts().get("RequestSignaturesWorkerPanel")![0]!;
    const name = getToolBySlug(subject)!.name;
    const secondary: Container = {
      where: "control",
      home: null,
      texts: [
        `Sign PDF covers self-signing. Use ${name} instead. It sends a document to others.`,
      ],
    };
    const got = attributedTo(secondary, subject).map((a) => a.sentence);
    expect(got).toEqual([
      `Use ${name} instead.`,
      "It sends a document to others.",
    ]);
  });

  it("attribution: a question is exempt, but the same words as a statement are not", () => {
    const subject = PDF_TO_WORD_TOOL;
    const c: Container = {
      where: "control",
      home: subject,
      texts: [
        "Will the Word document look like my original PDF?",
        "The Word document will look like my original PDF.",
      ],
    };
    expect(attributedTo(c, subject).map((a) => a.sentence)).toEqual([
      "The Word document will look like my original PDF.",
    ]);
  });

  it.each(RULES)(
    "$id: the capability is still absent (else re-evaluate the copy)",
    async (rule) => {
      const probe = await rule.probe();
      expect(
        probe.present,
        `the tool now appears to HAVE this capability (${probe.evidence}). ` +
          "Do not just delete this rule: decide what the copy may now claim, prove it on a real output, and rewrite the rule to pin THAT.",
      ).toBe(false);
    },
  );

  it.each(RULES)("$id: no served sentence makes the claim", async (rule) => {
    for (const subject of rule.subjects()) {
      const { offenders, seen } = await offendersOf(rule, subject);
      // Health: the page alone yields far more than this; a collapse to a
      // handful means the corpus or the attribution went blind.
      expect(
        seen,
        `${subject}: only ${seen} sentences attributed`,
      ).toBeGreaterThanOrEqual(15);
      expect(
        offenders,
        `${subject} promises something the tool cannot do — this copy is the H1 subtitle, the meta description and JSON-LD:\n  ${offenders.join("\n  ")}`,
      ).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------------ *
 *  Positive statements that replaced the claims — true of the output.
 * ------------------------------------------------------------------ */

describe("the replacement copy states what the output actually is", () => {
  it("HTML to PDF says paste exactly when its panel has a paste box", async () => {
    // The CAPABILITY, from the panel's whole module graph (its lazy children
    // included): a <textarea> somewhere a reader of /tools/html-to-pdf can
    // open it. `html-source-area.test.tsx` opens it through the panel.
    const subject = "html-to-pdf";
    const panelName = [...panelMounts().entries()].find(([, slugs]) =>
      slugs.includes(subject),
    )?.[0];
    const entry = panelName ? panelModule(panelName) : undefined;
    if (!entry) throw new Error(`no panel mounted for ${subject}`);
    const graph = panelGraph(entry);
    // Health: the walk reached past the panel module itself.
    expect(graph.length, graph.join(", ")).toBeGreaterThanOrEqual(5);
    const boxes = graph.filter((f) =>
      /<textarea\b/.test(withoutComments(read(f))),
    );
    // THE CLAIM, read through the same attribution the bans use.
    const paste =
      /\bpaste\w*\s+(?:your\s+|the\s+|some\s+)?(?:html|markup|code)\b/i;
    const claims: string[] = [];
    for (const container of await containersFor(subject))
      for (const { sentence, masked } of attributedTo(container, subject))
        if (paste.test(masked)) claims.push(sentence);
    // Both ways: copy that says paste needs a box, and a box needs copy
    // that says so (or the feature is invisible to everyone who reads first).
    expect({ box: boxes.length > 0, claim: claims.length > 0 }).toEqual({
      box: true,
      claim: true,
    });
  });

  /**
   * Published paper sizes in points — an outside table, NOT the runner's
   * (`IMAGE_PAGE_SIZES`), so a wrong constant there cannot agree with itself.
   * Wider than what the runner offers on purpose: a page that names Tabloid
   * must fail, not be skipped.
   */
  const PAPER: Record<string, [number, number]> = {
    "US Letter": [612, 792],
    A4: [595.28, 841.89],
    "US Legal": [612, 1008],
    A3: [841.89, 1190.55],
    A5: [419.53, 595.28],
    A2: [1190.55, 1683.78],
    Tabloid: [792, 1224],
  };
  const MARGIN_WORDS: Record<string, number> = {
    "quarter-inch": 18,
    "half-inch": 36,
    "one-inch": 72,
    "0.25 in": 18,
    "0.5 in": 36,
    "1 in margin": 72,
  };

  async function served(subject: string): Promise<string> {
    const all: string[] = [];
    for (const c of await containersFor(subject))
      all.push(...attributedTo(c, subject).map((a) => a.sentence));
    return all.join(" ");
  }

  it("Add Watermark: the page says image and tiling exactly when the engine draws them", async () => {
    // The shapes the retired rule banned, now required — and the engine must
    // really paint a picture and really repeat the mark for the copy to keep
    // saying so.
    const IMAGE = /\b(?:image|logo|picture)s?\b/i;
    const TILED = /\btil(?:e|es|ed|ing)\b|\brepeat(?:s|ed|ing)?\b/i;
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]);
    const blank = await doc.save();
    const pictured = await decodeFirstPage(
      await addWatermark(blank, "", {
        image: { bytes: jpegOfSize(40, 20), scale: 20 },
        position: "tile",
      }),
    );
    const plain = await decodeFirstPage(await addWatermark(blank, "DRAFT"));
    // Health: the decoder sees images at all, and none on a text mark.
    expect(plain.images).toEqual([]);
    expect(pictured.images.length).toBeGreaterThan(1);
    for (const subject of slugsOfKind("watermark")) {
      const text = await served(subject);
      expect(text.length, subject).toBeGreaterThan(500);
      expect(text, `${subject} no longer says it takes an image`).toMatch(
        IMAGE,
      );
      expect(text, `${subject} no longer says it tiles`).toMatch(TILED);
    }
  });

  const names = (text: string, table: Record<string, unknown>) =>
    Object.keys(table).filter((k) =>
      new RegExp(
        `(?<![\\w-])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`,
      ).test(text),
    );

  /** What the engine draws for one image under `options`: page and box. */
  async function drawn(
    w: number,
    h: number,
    options?: Parameters<typeof imagesToPdf>[2],
  ) {
    const page = await decodeFirstPage(
      await imagesToPdf(
        "jpg",
        [{ name: "p.jpg", type: "image/jpeg", bytes: jpegOfSize(w, h) }],
        options,
      ),
    );
    expect(page.images, "the decoder found the one image").toHaveLength(1);
    return { ...page, image: page.images[0]! };
  }

  /**
   * Every paper and margin `text` names, held to the runner's offer AND to
   * the engine's output: a size it names must be a chip the runner shows,
   * and that chip must draw the published size; likewise a margin.
   */
  async function setupProblems(text: string): Promise<string[]> {
    const problems: string[] = [];
    for (const paper of names(text, PAPER)) {
      const offered = IMAGE_PAGE_SIZES.find((s) => s.label === paper);
      if (!offered) {
        problems.push(`names ${paper}, which the runner does not offer`);
        continue;
      }
      const page = await drawn(800, 1200, {
        pageSize: offered.id,
        orientation: "portrait",
        margin: "none",
      });
      const [pw, ph] = PAPER[paper]!;
      if (Math.abs(page.width - pw) > 0.5 || Math.abs(page.height - ph) > 0.5)
        problems.push(
          `names ${paper}; the engine draws ${page.width}×${page.height}`,
        );
    }
    for (const phrase of names(text, MARGIN_WORDS)) {
      const points = MARGIN_WORDS[phrase]!;
      const offered = IMAGE_MARGINS.find((m) => m.points === points);
      if (!offered) {
        problems.push(
          `names a ${phrase} margin, which the runner does not offer`,
        );
        continue;
      }
      // A wide photo on A4: the binding side touches the margin.
      const page = await drawn(4000, 1000, {
        pageSize: "a4",
        orientation: "portrait",
        margin: offered.id,
      });
      if (Math.abs(page.image.x - points) > 0.1)
        problems.push(
          `names a ${phrase} margin; the engine draws ${page.image.x}`,
        );
    }
    return problems;
  }

  it("image-to-PDF: every paper size and margin the copy names is offered, and drawn as named", async () => {
    for (const subject of slugsOfKind("image-to-pdf")) {
      const text = await served(subject);
      expect(await setupProblems(text), subject).toEqual([]);
    }
    // The copy must still SAY which page a reader gets: the jpg page names
    // a paper size and a margin (a page that named none would pass above).
    const jpg = await served(
      slugsOfKind("image-to-pdf").find((s) =>
        getToolBySlug(s)!.accept.includes("JPG"),
      )!,
    );
    expect(names(jpg, PAPER).length).toBeGreaterThan(0);
    expect(names(jpg, MARGIN_WORDS).length).toBeGreaterThan(0);
  });

  it("image-to-PDF: the default the copy states is what the runner starts on", async () => {
    // Was the whole test while the layout was fixed: Letter, portrait, 36pt.
    // Until 2026-11-07 it held the copy to the engine's no-options page;
    // since audit jpg-to-pdf#1 the RUNNER starts on the paper of the
    // browser's region, so the papers a default sentence names must be
    // exactly the ones the runner can start on, each drawn as named.
    const regions = [["en-US"], ["en-GB"], ["bn-BD"], ["fr-CA"], ["de"]];
    const starts = new Map<string, [number, number]>();
    for (const locales of regions) {
      const pageSize = imagePageSizeForLocales(locales);
      const page = await drawn(2000, 4000, {
        ...DEFAULT_IMAGE_PAGE_OPTIONS,
        pageSize,
      });
      starts.set(imagePageSizeById(pageSize).label, [page.width, page.height]);
    }
    // Health: the regions above reach both papers, so "exactly" has teeth.
    expect(starts.size).toBe(2);
    for (const [label, size] of starts)
      expect(size, `${label} is drawn as named`).toEqual(PAPER[label]);
    const wide = await drawn(4000, 2000);
    const tall = await drawn(2000, 4000);
    const margin = Math.min(wide.image.x, tall.image.y);
    expect(
      Math.abs(wide.image.x - (wide.width - wide.image.x - wide.image.w)),
    ).toBeLessThan(0.01);
    for (const subject of slugsOfKind("image-to-pdf")) {
      const text = await served(subject);
      const defaults = text
        .split(/(?<=[.!?])\s+/)
        .filter((s) => /\bunless you change\b|\bleft alone\b/i.test(s));
      expect(defaults.length, `${subject} states no default`).toBeGreaterThan(
        0,
      );
      for (const sentence of defaults) {
        const papers = names(sentence, PAPER);
        if (papers.length > 0)
          expect([...papers].sort(), `${subject}: "${sentence}"`).toEqual(
            [...starts.keys()].sort(),
          );
        for (const phrase of names(sentence, MARGIN_WORDS))
          expect(margin, `${subject}: "${sentence}"`).toBeCloseTo(
            MARGIN_WORDS[phrase]!,
            1,
          );
        if (/\bportrait\b/i.test(sentence))
          expect(wide.height, `${subject} says portrait`).toBeGreaterThan(
            wide.width,
          );
      }
    }
  });

  it("image-to-PDF: the relationship catches an unoffered paper and a wrong margin (positive controls)", async () => {
    expect(await setupProblems("Pick Tabloid pages.")).toHaveLength(1);
    expect(
      await setupProblems("Each photo gets a one-inch margin."),
    ).toHaveLength(1);
    // And passes what is offered and drawn.
    expect(
      await setupProblems("A4 or US Legal, with a 0.25 in margin."),
    ).toEqual([]);
    const page = await drawn(800, 600);
    expect([page.width, page.height]).not.toEqual(PAPER.A4);
  });

  it("image-to-PDF: the page-setup claims are true now — the corpus is caught, and the runner offers every setting", async () => {
    const rule = IMAGE_PAGE_SETUP_RULE;
    const claims = [...rule.shipped, ...rule.synonyms];
    const idle = Object.entries(rule.shapes)
      .filter(([, re]) => !claims.some((c) => re.test(c)))
      .map(([name]) => name);
    expect(idle, "shapes nothing exercises").toEqual([]);
    expect(
      claims.filter(
        (c) => !Object.values(rule.shapes).some((re) => re.test(c)),
      ),
      "claims no shape catches",
    ).toEqual([]);
    const probe = await rule.probe();
    expect(probe.present, probe.evidence).toBe(true);
    // Each of the three settings is offered by name — not just one of them.
    const found = imageRunnerPageSetup().join(" ").toLowerCase();
    for (const setting of ["page size", "orientation", "margin"])
      expect(found, setting).toContain(setting);
    // Positive control for the probe's reader: a runner with no such
    // control reads as none, and a comment does not count.
    expect(
      pageSetupWords(
        ["const x = 1;", "/* page size */", "// margin"].join("\n"),
      ),
    ).toEqual([]);
    expect(pageSetupWords('title="Page size"')).toEqual(["Page size"]);
  });

  it("PDF to Excel: the description names exactly the separators the engine splits on", async () => {
    const tool = getToolBySlug(PDF_TO_EXCEL_TOOL)!;
    const splits = async (line: string) => (await sheetCells([line])).size > 1;
    const separators: Record<string, { probe: string; word: RegExp }> = {
      tab: { probe: "a\tb", word: /\btabs?\b/i },
      "wide gap": { probe: "a    b", word: /\b(?:wide\s+)?gaps?\b/i },
      comma: { probe: "1,234", word: /\bcommas?\b/i },
      "single space": {
        probe: "a b",
        word: /\bsingle spaces?\b|\bevery space\b/i,
      },
    };
    const wrong: string[] = [];
    let splitting = 0;
    for (const [name, { probe, word }] of Object.entries(separators)) {
      const engineSplits = await splits(probe);
      if (engineSplits) splitting += 1;
      const copySays = word.test(tool.description);
      if (engineSplits !== copySays)
        wrong.push(
          `${name}: engine splits=${engineSplits}, description says=${copySays}`,
        );
    }
    // Health: the engine does split on something; a probe that never split
    // would make "the description names none" look correct.
    expect(splitting).toBeGreaterThan(0);
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  it("PDF to Excel: the page says blank cells shift values exactly while the engine shifts them", async () => {
    // INVERTED at the wave-1 L03 merge (2026-09-28). This required the
    // warning because the engine dropped blank cells; L03 placed cells by
    // column, the control "the probe row no longer shifts" fired as written,
    // and the engine was re-read. The warning is now a claim the engine
    // contradicts, so the rule is the relationship: say it iff it happens.
    const cells = await sheetCells([
      "Item      Qty      Price",
      "Pear               4.00",
    ]);
    // Health: the probe row was decoded at all.
    expect(cells.get("A2")).toBe("Pear");
    const shifts = cells.get("B2") === "4.00";
    const tool = getToolBySlug(PDF_TO_EXCEL_TOOL)!;
    const said = [
      tool.description,
      ...toolFacts(tool.slug).map((f) => f.value),
    ].some((t) =>
      /\bblank cells? (?:are|is) dropped\b|\bshift left\b/i.test(t),
    );
    expect(said, `engine shifts: ${shifts}`).toBe(shifts);
    // POSITIVE CONTROL: the sentence shipped while the engine shifted is seen.
    expect(
      /\bblank cells? (?:are|is) dropped\b|\bshift left\b/i.test(
        "Every line of text becomes a row. Blank cells are dropped, so a value can shift left into the wrong column — there is no table detection.",
      ),
    ).toBe(true);
  });

  it("PDF to Excel: a cell straddling two columns merges them, as the page warns", async () => {
    const cells = await sheetCells([
      "Item      Qty      Price",
      "A very long description here  2   4.00",
      "Pear      1        3.00",
    ]);
    // The header's three runs share one cell once a row straddles its gutters.
    expect(cells.get("A1")).toBe("Item Qty Price");
    const tool = getToolBySlug(PDF_TO_EXCEL_TOOL)!;
    expect(
      toolFacts(tool.slug)
        .map((f) => f.value)
        .join(" "),
    ).toContain("columns can merge");
  });

  /**
   * REPLACED 2026-10-10. This was "while slides carry no pictures or
   * positions, the description says text only", and it asserted NOTHING: its
   * `textOnly` was `!/<p:pic\b|<a:xfrm\b/` over every slide, and the writer
   * has put an `a:xfrm` on every text box since 2026-09-27, so `textOnly` was
   * always false and the `if` that held the description never ran — green
   * over a catalogue it never read. Its "positive control" tested a string
   * literal, not the branch.
   *
   * Now the relationship runs BOTH ways, and each way is exercised: the
   * engine is run on a page with a picture and decoded; pictures on the
   * slides ⇒ the description and facts may not say "text only" or "not
   * carried over"; no pictures ⇒ they must. The controls run the same
   * predicate over the descriptions shipped on either side of the change.
   */
  it("PDF to PowerPoint: the description says text only exactly when the slides carry no pictures", async () => {
    const parts = await officeParts(PDF_TO_POWERPOINT_TOOL, [
      "Revenue      $4.2M",
      "Second page",
    ]);
    const slides = Object.entries(parts).filter(([n]) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(n),
    );
    // Health: one slide per page, decoded, and the probe page HAS a picture,
    // so a deck without one is the engine's doing and not the input's.
    expect(slides).toHaveLength(2);
    const pictures = slides.filter(([, xml]) => /<p:pic\b/.test(xml)).length;
    const QUALIFIER =
      /\btext only\b|\bnot carried over\b|\bstay(?:s)? behind\b|\bimages?\b[^.]{0,40}\bnot (?:kept|included)\b/i;
    const tool = getToolBySlug(PDF_TO_POWERPOINT_TOOL)!;
    const said = [
      tool.description,
      ...toolFacts(tool.slug).map((f) => f.value),
    ];
    const qualifies = said.some((t) => QUALIFIER.test(t));
    expect(
      qualifies,
      pictures > 0
        ? `the slides carry ${pictures} picture(s) — the copy may not say they are left out`
        : "every slide is text only — the copy must say so",
    ).toBe(pictures === 0);
    // Controls, through the same predicate: the description shipped until
    // 2026-10-10 qualifies; the audit base's did not (it claimed editable
    // slides instead, which is the rule above's business).
    expect(
      QUALIFIER.test(
        "Put each PDF page’s selectable text on its own slide in a .pptx file. Text only: images, charts and page layout are not carried over.",
      ),
    ).toBe(true);
    expect(
      QUALIFIER.test(
        "Convert each PDF page into an editable PowerPoint slide, rebuilt from the page’s selectable text — on a secure worker that deletes the input when the job finishes.",
      ),
    ).toBe(false);
  });

  it("PDF to PowerPoint: the operations row promises no more than the page does", () => {
    // The row is read where an operator receives it: the promise
    // ADVERTISED_WORKER_CAPABILITIES carries, not a copy of the literal. It
    // said "an editable slide" until 2026-10-09, beside a page that no
    // longer did.
    const rule = RULES.find((r) => r.id === PPTX_EDITABLE_RULE)!;
    const subject = rule.subjects()[0]!;
    const caught = (texts: readonly string[]) =>
      attributedTo({ where: "operations", home: null, texts }, subject)
        .filter(({ masked }) =>
          Object.values(rule.shapes).some((re) => re.test(masked)),
        )
        .map(({ sentence }) => sentence);
    const row = ADVERTISED_WORKER_CAPABILITIES.find(
      (c) => c.key === "pptxPresentationChain",
    );
    expect(row, "no operations row for pptxPresentationChain").toBeDefined();
    if (!row) return;
    // Health: the promise names the tool, so it is read as the tool's sentence
    // at all — attributed to nothing, it would pass vacuously.
    expect(
      attributedTo(
        { where: "operations", home: null, texts: [row.promise] },
        subject,
      ),
    ).not.toEqual([]);
    expect(caught([row.promise])).toEqual([]);
    // Positive control, through the same path: the promise it replaced.
    const before = rule.shipped.find((s) => s.startsWith("PDF to PowerPoint"));
    expect(before).toBeDefined();
    expect(caught([before!])).toEqual([before]);
  });
});

/**
 * The faces Windows 10/11 and Microsoft 365 install: a fact about the
 * outside world, written down here, not derived from the code it judges.
 * Module scope since 2026-11-15: PDF to Word's typeface sentences are held
 * to the same fact (#28 slice 4).
 */
const WINDOWS_OR_OFFICE = new Set([
  "Aptos",
  "Arial",
  "Arial Black",
  "Arial Narrow",
  "Bahnschrift",
  "Book Antiqua",
  "Bookman Old Style",
  "Calibri",
  "Calibri Light",
  "Cambria",
  "Candara",
  "Century",
  "Century Gothic",
  "Comic Sans MS",
  "Consolas",
  "Constantia",
  "Corbel",
  "Courier New",
  "Franklin Gothic Medium",
  "Garamond",
  "Georgia",
  "Gill Sans MT",
  "Impact",
  "Lucida Console",
  "Lucida Sans Unicode",
  "Palatino Linotype",
  "Segoe UI",
  "Segoe UI Symbol",
  "Symbol",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Webdings",
  "Wingdings",
  "Wingdings 2",
  "Wingdings 3",
]);

/**
 * PDF to PowerPoint's picture and font sentences, held to the engine (added
 * 2026-10-11, from the review of the faithful export). Each sentence was
 * true of the common case and false of an input the review built:
 *
 *  - "a JPEG photo is carried into the .pptx byte for byte, at the
 *    resolution the PDF holds it": only up to MAX_PICTURE_SIDE on its long
 *    side — every 4032 × 3024 phone photo is re-encoded and scaled down;
 *  - "a font PowerPoint is likely to have … keeps its name": the deck kept
 *    Liberation, Carlito, Caladea, DejaVu and Noto by name, the faces of
 *    every PDF LibreOffice writes on Linux, and PowerPoint for Windows ships
 *    none of them;
 *  - "Every picture on a page lands on its slide as a picture of its own":
 *    a stencil mask is drawn into the drawing pictures, not placed alone.
 */
describe("PDF to PowerPoint: the picture and font sentences hold of the engine", () => {
  /**
   * Every string the tool's page and its structured data serve, each one
   * whole (a paragraph, a step, an answer), through `toolContainer` — the
   * accessors the page itself renders.
   *
   * CHANGED 2026-10-11 (the second review). This read the content module
   * and `toolFacts("pdf-to-powerpoint")`, and `toolFacts` is EMPTY for this
   * tool: the derived answer the page serves under "What goes on each
   * slide?" (`workerFaq` in tool-facts.ts) was never read, so the review
   * found it promising "a picture of its own" beside a page the engine
   * draws as one picture, under a guard that could not see it.
   */
  const served = async () =>
    (await toolContainer(getToolBySlug(PDF_TO_POWERPOINT_TOOL)!)).texts;
  const pageText = async () => (await served()).join("\n");

  it("the corpus holds the page's authored copy and its derived answers", async () => {
    const texts = await served();
    const ppt = getToolContent("pdf-to-powerpoint")!;
    for (const part of [
      ...ppt.intro,
      ...ppt.useCases.map((u) => u.body),
      ...ppt.faqs.map((f) => f.a),
    ])
      expect(texts, part.slice(0, 60)).toContain(part);
    // A derived answer the content module does not hold.
    const derived = pageFaq(getToolBySlug(PDF_TO_POWERPOINT_TOOL)!).filter(
      (f) => !ppt.faqs.some((a) => a.q === f.question),
    );
    expect(derived.map((f) => f.question)).toContain(
      "What goes on each slide?",
    );
    for (const f of derived) expect(texts).toContain(f.answer);
  });

  it("every font the deck names is one Windows or Office ships; a free clone becomes the face it copies", async () => {
    const families = [
      ...OFFICE_METRIC_CLONES.flatMap((c) => [c.office, c.clone]),
      "DejaVu Sans",
      "DejaVu Serif",
      "DejaVu Sans Mono",
      "Noto Sans",
      "Noto Serif",
      "Noto Sans Mono",
      "Segoe UI",
      "Helvetica",
      "Times",
      "Courier",
      "Some Unknown Grotesk",
    ];
    const named = families.map((family) =>
      typefaceFor({ family, fontClass: "sans", text: "Abc" }),
    );
    expect(
      named.filter((n) => !WINDOWS_OR_OFFICE.has(n)),
      "the deck asks PowerPoint for a font Windows and Office do not ship",
    ).toEqual([]);
    for (const c of OFFICE_METRIC_CLONES)
      expect(
        typefaceFor({ family: c.clone, fontClass: "sans", text: "Abc" }),
        c.clone,
      ).toBe(c.office);
    // The page says exactly that, and no longer says "likely to have".
    const text = await pageText();
    expect(text).toMatch(/comes with Windows or Office[^.]*keeps its name/);
    expect(text).toMatch(/becomes the font it copies/);
    expect(text).not.toMatch(/likely to have/);
  });

  it("a JPEG is copied byte for byte only up to the size the page names; a larger one is scaled down to it", async () => {
    // Two plain JPEGs, one each side of the limit, made by the canvas
    // pdf.js itself paints with.
    const canvas = createRequire(
      createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
    )("@napi-rs/canvas") as {
      createCanvas(
        w: number,
        h: number,
      ): {
        getContext(k: "2d"): {
          fillStyle: string;
          fillRect(x: number, y: number, w: number, h: number): void;
        };
        toBuffer(m: "image/jpeg", q: number): Uint8Array;
      };
    };
    const jpeg = (w: number, h: number) => {
      const c = canvas.createCanvas(w, h);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#3366cc";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#cc3333";
      ctx.fillRect(0, 0, w / 2, h);
      return new Uint8Array(c.toBuffer("image/jpeg", 85));
    };
    const doc = await PDFDocument.create();
    const page = doc.addPage([720, 540]);
    const small = jpeg(MAX_PICTURE_SIDE, 60);
    const large = jpeg(MAX_PICTURE_SIDE + 400, 60);
    for (const [bytes, y] of [
      [small, 100],
      [large, 300],
    ] as const)
      await drawRasterImage(page, await embedRasterImage(doc, bytes, "jpg"), {
        x: 40,
        y,
        width: 600,
        height: 40,
      });
    const run = await runPdfOfficeExport(
      PDF_TO_POWERPOINT_TOOL,
      await doc.save(),
      { extract: stubExtract([""]), scanPages: scanPdfPages },
    );
    if (!run.ok) throw new Error(run.message);
    const zip = await JSZip.loadAsync(run.output);
    const media = await Promise.all(
      Object.keys(zip.files)
        .filter((n) => n.startsWith("ppt/media/") && !zip.files[n]!.dir)
        .map((n) => zip.file(n)!.async("uint8array")),
    );
    const same = (a: Uint8Array, b: Uint8Array) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    expect(
      media.some((m) => same(m, small)),
      "the small JPEG, byte for byte",
    ).toBe(true);
    expect(
      media.some((m) => same(m, large)),
      "the large JPEG was copied",
    ).toBe(false);
    // The page names the limit, from the constant that applies it.
    const px = MAX_PICTURE_SIDE.toLocaleString("en-US");
    const text = await pageText();
    expect(text).toMatch(new RegExp(`up to ${px} pixels[^;]*byte for byte`));
    expect(text).toMatch(new RegExp(`scaled down to ${px} pixels`));
    expect(text).not.toMatch(
      /byte for byte, at the resolution the PDF holds it/,
    );
  });

  it("a stencilled picture is drawn with the drawing, so the page does not promise every picture alone", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const bits = new Uint8Array(8 * 64).fill(0xaa);
    const ref = doc.context.register(
      doc.context.flateStream(bits, {
        Type: "XObject",
        Subtype: "Image",
        Width: 64,
        Height: 64,
        ImageMask: true,
        BitsPerComponent: 1,
      }),
    );
    const name = page.node.newXObject("Im", ref);
    page.pushOperators(
      pushGraphicsState(),
      setFillingRgbColor(0.8, 0.1, 0.1),
      concatTransformationMatrix(200, 0, 0, 200, 100, 50),
      drawObject(name),
      popGraphicsState(),
    );
    const run = await runPdfOfficeExport(
      PDF_TO_POWERPOINT_TOOL,
      await doc.save(),
      { extract: stubExtract([""]), scanPages: scanPdfPages },
    );
    if (!run.ok) throw new Error(run.message);
    const slide = await (
      await JSZip.loadAsync(run.output)
    )
      .file("ppt/slides/slide1.xml")!
      .async("string");
    // Health: the stencil is ON the slide — as drawing, not as a picture.
    expect(slide).toMatch(/name="Drawing /);
    expect(slide).not.toMatch(/name="Picture /);
    expect(await pageText()).not.toMatch(
      /\bevery picture on (?:a|the) page (?:lands|is)\b/i,
    );
  });

  /**
   * A PAGE DRAWN AS ONE PICTURE (2026-10-11, the second review). Past
   * MAX_LAYERS_PER_PAGE layers a page's slide is ONE picture of the page,
   * its text in invisible boxes over it — a table of 40 cells, each painting
   * its text before its border, is enough — while the page said pictures
   * arrive "as separate pictures, not flattened into one image of the page"
   * and every line of text is a box "in its size, weight and colour". Held
   * both ways: the number the page states is run through the engine on
   * each side of it, and every served entry that promises separate
   * pictures or styled text carries the exception in the same entry.
   */
  it("a page drawn as one picture: the page states the engine's threshold beside every promise it breaks", async () => {
    const OWN_PICTURE =
      /\bpictures? of (?:its|their) own\b|\bseparate pictures\b|\bnot flattened\b/i;
    const STYLED_TEXT =
      /\btext box(?:es)? at (?:its|their) place\b[^.]*\bcolou?r\b/i;
    const CLAIMS = [OWN_PICTURE, STYLED_TEXT];
    const EXCEPTION =
      /\bmore than ([\d,]+) (?:such )?pictures\b[^.]*\bone picture of the page\b[^.]*\binvisible text boxes\b/i;
    const unqualified = (entries: readonly string[]) =>
      entries.filter(
        (e) => CLAIMS.some((re) => re.test(e)) && !EXCEPTION.test(e),
      );
    // The corpus, in both directions: what the page shipped until this
    // change — each caught by a shape, each shape catching one — and each
    // fails the rule (the positive control).
    const SHIPPED = [
      "A photo or screenshot on a page lands on its slide as a picture of its own, where the page shows it and at the size it is shown, cut to the shape the page shows it through",
      "Every line of selectable text becomes a text box at its place, in its size, weight and colour, set in a font matched to the PDF's",
      "Pictures arrive on their slides as separate pictures, not flattened into one image of the page.",
      "A photo or screenshot on the page is a picture of its own on the slide, where the page shows it; every line of selectable text is a text box at its place, in its size, weight and colour, with its font matched rather than copied",
      "Each slide is the shape of the first page, each picture sits where the page shows it, and each line of text is a text box at its place with its size, weight and colour.",
    ];
    for (const sentence of SHIPPED)
      expect(
        CLAIMS.some((re) => re.test(sentence)),
        sentence,
      ).toBe(true);
    for (const re of CLAIMS)
      expect(
        SHIPPED.some((sentence) => re.test(sentence)),
        String(re),
      ).toBe(true);
    expect(unqualified(SHIPPED)).toEqual(SHIPPED);

    const texts = await served();
    // Health: the page still makes these promises, so "none unqualified"
    // is not "none made".
    expect(
      texts.filter((e) => CLAIMS.some((re) => re.test(e))).length,
    ).toBeGreaterThanOrEqual(3);
    expect(unqualified(texts)).toEqual([]);

    // The number the page states, held to the engine from both sides.
    const stated = new Set(
      texts.flatMap((e) => {
        const m = EXCEPTION.exec(e);
        return m ? [Number(m[1]!.replace(/,/g, ""))] : [];
      }),
    );
    expect([...stated], "the page states one threshold").toHaveLength(1);
    const n = [...stated][0]!;
    const deckFor = async (cells: number) => {
      const run = await runPdfOfficeExport(
        PDF_TO_POWERPOINT_TOOL,
        (await cellGridPdf(cells)).pdf,
        { extract: stubExtract(["0"]), scanPages: scanPdfPages },
      );
      if (!run.ok) throw new Error(run.message);
      return { run, slide: (await readDeck(run.output)).slides[0]! };
    };
    const kept = await deckFor(n);
    expect(kept.run.coverage).toMatchObject({ flattenedPageCount: 0 });
    expect(kept.slide.pictures).toHaveLength(n);
    expect(
      kept.slide.texts.every((t) => t.runs.every((r) => !r.invisible)),
    ).toBe(true);
    const flat = await deckFor(n + 1);
    expect(flat.run.coverage).toMatchObject({ flattenedPageCount: 1 });
    expect(flat.slide.pictures).toHaveLength(1);
    // Health: the text is on the slide, and none of it shows.
    expect(flat.slide.texts.length).toBeGreaterThanOrEqual(n + 1);
    expect(
      flat.slide.texts.every((t) => t.runs.every((r) => r.invisible)),
    ).toBe(true);
  }, 60_000);

  /**
   * A PICTURE LEFT OUT WITH NO NOTE (2026-10-11, the second review). The
   * page reader cannot read an encrypted file's page content, so where
   * pdf.js removes a picture over its ceiling, nothing can say whether the
   * page painted it, and the result — rightly — counts nothing it did not
   * see. Every served sentence promising that the note names a page that
   * lost a picture is then false of that file, unless it says so.
   *
   * The size the page states is held to the engine at its WORST case. Such
   * a page's ceiling is the floor, raised only as far as everything the
   * page can reach fits the page budget, so the size below which no picture
   * is ever lost unnoted is the floor itself. With a budget that admits
   * nothing, the ceiling IS the floor; then, in both encrypted layouts, a
   * picture of exactly the stated size must be named and one a row larger
   * on no slide and named nowhere. (Run at the production budget, the pair
   * moves the ceiling up to the first picture whatever the page states: a
   * copy saying 65 megapixels passed that way, the mutation check found.)
   *
   * CHANGED the same day (the second re-review). The exception named
   * encrypted files and a size — "except in an encrypted or damaged PDF,
   * where a picture over 64 megapixels can be left out with no note" — and
   * neither survived. The size was the floor of a ceiling with no bound
   * under it: one locked page of six 8000² photos decoded 2.2 GB
   * (`page-scan.rss.test.ts`). And the reader now reads an encrypted page
   * (`standard-security.ts`), so a locked file is noted like any other.
   * What is left is a page the reader cannot read before pdf.js draws it —
   * a damaged one — and there the ceiling is the page budget over all the
   * page can reach, so no size can be promised. Held both ways, on one
   * pair of pictures: damaged, the exception HAPPENS (page 2's picture is
   * on no slide and named nowhere), so the page must state it; locked, in
   * both layouts, it does NOT (both are named), so the page may not
   * except encrypted files.
   */
  it("a picture the worker cannot see itself lose: the page says where, and only where it happens", async () => {
    const NOTE =
      /\b(?:left out|could not be put on its slide)\b[^.]*\bnote beside (?:the download|it) names\b/i;
    const EXCEPTION =
      /\bcannot read before (?:it is drawn|drawing)\b[^.]*\bno note\b/i;
    const OVERCLAIM = /\bencrypted\b[^.]*\bno note\b/i;
    const unqualified = (entries: readonly string[]) =>
      entries.filter((e) => NOTE.test(e) && !EXCEPTION.test(e));
    // The corpus: the promises shipped until this change, each caught, each
    // failing the rule. A note sentence about pages with no text is not this
    // promise (those pages are always found), and is not caught.
    const SHIPPED = [
      "a picture too large for the worker to handle, or one it cannot decode, is left out, and a note beside the download names its page.",
      "If some pages had no selectable text, or a picture could not be put on its slide, a note beside it names those pages.",
      "A picture too large for the worker, or one it cannot decode, is left out, and the note beside the download names its page.",
      // The second review's exception: qualified then, false now.
      "A picture too large for the worker to handle, or one it cannot decode, is left out, and a note beside the download names its page, except in an encrypted or damaged PDF, where a picture over 64 megapixels can be left out with no note.",
    ];
    for (const sentence of SHIPPED)
      expect(NOTE.test(sentence), sentence).toBe(true);
    expect(unqualified(SHIPPED)).toEqual(SHIPPED);
    expect(SHIPPED.filter((e) => OVERCLAIM.test(e))).toEqual([SHIPPED[3]]);
    expect(
      NOTE.test(
        "its slide carries the page as a picture and those words are not editable text; the note beside the download names the pages it happened to.",
      ),
    ).toBe(false);

    const texts = await served();
    expect(texts.filter((e) => NOTE.test(e)).length).toBeGreaterThanOrEqual(2);
    expect(unqualified(texts)).toEqual([]);
    expect(texts.filter((e) => OVERCLAIM.test(e))).toEqual([]);

    // A pair either side of pdf.js's floor ceiling: one fits the page
    // budget, the two together do not.
    const fixture = await ceilingPairPdf(MAX_DECODED_IMAGE_PIXELS);
    const run = async (pdf: Uint8Array) => {
      const result = await runPdfOfficeExport(PDF_TO_POWERPOINT_TOOL, pdf, {
        extract: stubExtract(["", ""]),
        scanPages: scanPdfPages,
      });
      if (!result.ok) throw new Error(`${result.kind}: ${result.message}`);
      const deck = await readDeck(result.output);
      return {
        // Neither picture is ever on a slide: their data is noise.
        pictures: deck.slides.map((sl) => sl.pictures.length),
        named: result.coverage?.pagesMissingPictures,
      };
    };
    // Damaged: the exception happens — page 2's picture is lost unnamed.
    expect(await run(await damageContentStreams(fixture.pdf))).toEqual({
      pictures: [0, 0],
      named: [1],
    });
    // Locked: it does not — both are named, as for the plain file.
    for (const pdf of [
      fixture.pdf,
      ...(await Promise.all(
        [false, true].map((objectStreams) =>
          encryptPdf(fixture.pdf, {
            userPassword: "",
            ownerPassword: "owner",
            objectStreams,
          }),
        ),
      )),
    ])
      expect(await run(pdf)).toEqual({ pictures: [0, 0], named: [1, 2] });
  }, 60_000);

  /**
   * A DAMAGED PDF (2026-10-11, after the second re-review). A file the page
   * reader cannot read ahead — pdf-lib cannot load it, or pdf.js finds a page
   * its page tree does not hold — was scanned with no decode bound. Now it
   * is rebuilt first, the way Repair PDF does, and converted from the rebuilt
   * copy with a note saying so; and if it cannot be rebuilt into a file the
   * reader can read, it is refused, pointing to Repair PDF. The page says
   * both, and each sentence is held to a run: the junk-after-%%EOF file
   * through the engine with a rebuild (a stand-in for qpdf) and without one.
   */
  it("a damaged PDF: the page says it is rebuilt first or not converted, and the engine does exactly that", async () => {
    const REBUILT =
      /\brebuilds?\b[^.]*\bthe way Repair PDF does\b[^.]*\bnote\b[^.]*\bsays so\b/i;
    const REFUSED = /\bnot converted\b[^.]*\bRepair PDF\b/i;
    const texts = await served();
    expect(
      texts.some((e) => REBUILT.test(e)),
      "the rebuild",
    ).toBe(true);
    expect(
      texts.some((e) => REFUSED.test(e)),
      "the refusal",
    ).toBe(true);

    const fixture = await imageCaptionPdf();
    const damaged = junkAfterEofPdf(fixture.pdf);
    const deps = {
      extract: stubExtract(["Open the portal"]),
      scanPages: scanPdfPages,
    };
    const rebuilt = await runPdfOfficeExport(PDF_TO_POWERPOINT_TOOL, damaged, {
      ...deps,
      repairPdf: repairStandIn,
    });
    if (!rebuilt.ok) throw new Error(`${rebuilt.kind}: ${rebuilt.message}`);
    expect(rebuilt.coverage.repairedBeforeConversion).toBe(true);
    const refused = await runPdfOfficeExport(
      PDF_TO_POWERPOINT_TOOL,
      damaged,
      deps,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.kind).toBe("unreadable");
    expect(refused.message).toMatch(/\bRepair PDF\b/);
  }, 60_000);
});

/**
 * PDF to Word's picture sentences, held to the engine (added 2026-10-17).
 *
 * On that day production returned the owner's 33-page tutorial as a .docx
 * with none of its 37 pictures, and the page said so, truthfully: "Images
 * … are not recreated", "colours and images are not carried across", "Its
 * selectable text, and nothing else". The engine now carries every raster
 * picture, and each of those sentences became false. Nothing here was red
 * for it: the layout rule above asked about layout, and no rule asked about
 * pictures at all. This one asks, both ways: the engine is run on a real
 * page with a picture and its .docx decoded; pictures in the .docx ⇒ no
 * sentence attributed to PDF to Word may deny them, and none in it ⇒ one
 * must. The shapes are held to the sentences that shipped, in both
 * directions, and to the honest sentences that replaced them.
 */
describe("PDF to Word: the picture sentences hold of the engine", () => {
  const DENIES: Record<string, RegExp> = {
    // 120, not 60: the mutation check of 2026-10-17 put "Images," back at
    // the head of the current, longer list ("Images, tables, fonts, colors,
    // drawings made of lines and shapes, and the page layout are not
    // carried over") and at 60 it walked past. That sentence is a synonym
    // below, so the window is exercised at its length.
    "pictures are not carried":
      /\b(?:images?|pictures?|photos?)\b[^.;]{0,120}?\b(?:are|is) not (?:carried|recreated|kept|included|exported)\b/i,
    "pictures stay behind":
      /\b(?:images?|pictures?)\b[^.;]{0,60}\bstay(?:s)? behind\b/i,
    "and nothing else": /\band nothing else\b/i,
    "image-only pages add nothing":
      /\b(?:image-only|scanned|picture-only) pages? adds? nothing\b/i,
    "text only": /\btext only\b/i,
  };
  /** Each one shipped on the PDF to Word surfaces until 2026-10-17. */
  const SHIPPED = [
    // The catalogue description.
    "Turn a PDF's selectable text into editable Word (DOCX) paragraphs, in reading order. Images, fonts, tables and layout are not recreated; scans need OCR first.",
    // The page's intro and its look FAQ.
    "Fonts, bold and italics, colours and images are not carried across.",
    "No. The DOCX carries the words as plain paragraphs; fonts, sizes, colours, images and link targets stay behind.",
    // PDF_TO_WORD_KEEPS, and the derived answer it was served in.
    "Images, tables, fonts, colors and the page layout are not carried over, so the text arrives unstyled, ready to format in Word — not as a copy of the page.",
    "Its selectable text, and nothing else.",
    // The partly-scanned FAQ.
    "The image-only pages add nothing to the DOCX and nothing inside the file marks where they were, but beside the download the panel says how many pages had text and names the ones that had none (up to 50, then a count of the rest).",
    // The edit guide's pointer to PDF to Word.
    "Images, fonts, tables and page layout are not recreated, so it suits documents where the words matter more than the look.",
  ];
  const SYNONYMS = [
    "Text only: pictures are left behind.",
    "Images, tables, fonts, colors, drawings made of lines and shapes, and the page layout are not carried over, and bold or italics only where a whole paragraph is set in them.",
  ];
  /** What the page says now, which no shape may catch. */
  const HONEST = [
    "A picture too large for the worker, or one it cannot decode, is left out, and the note beside the download names its page.",
    "Fonts and layout are not recreated; scans need OCR first.",
    "Arrows and boxes drawn on top are lines and shapes, so they do not come across.",
    // Until 2026-11-15 also "The DOCX carries the words as plain paragraphs,
    // with the pictures on lines of their own between them; fonts, sizes,
    // colours, tables as tables, link targets and drawings made of lines and
    // shapes stay behind." — no longer the page's: sizes and colours are
    // kept on each word now. What replaced it:
    // Until 2026-11-15 (#28 slice 2) also the sentence before this one with
    // "tables as tables" / "tables," in its list — no longer the page's:
    // a table whose cells fit on one line is a Word table now.
    // Until 2026-11-15 (#28 slice 4) this said "the typeface, link targets
    // and drawings …" — no longer the page's: each word is set in an Office
    // font of its kind now.
    "Words keep their bold, italics, size and colour where our reader matches them, and a table whose cells each fit on one line, with a column of figures, comes through as a Word table; link targets and drawings made of lines and shapes stay behind, and the page's positions, indentation and spacing are not kept.",
    "The pictures sit on lines of their own between the paragraphs, and a picture painted over another, or over text, comes through on its own line instead of on top.",
    // Until 2026-11-15 (#28 slice 2) also the sentence before this one with
    // "tables as tables" / "tables," in its list — no longer the page's:
    // a table whose cells fit on one line is a Word table now.
    // Until 2026-11-15 (#28 slice 4) also "The typeface and drawings made
    // of lines and shapes are not carried across, and text recognised by OCR
    // comes through in Word's default style." — no longer the page's.
    "Drawings made of lines and shapes are not carried across.",
  ];
  const denies = (text: string) =>
    Object.values(DENIES).some((re) => re.test(text));

  it("the shapes and the shipped sentences cover each other, and the honest ones pass", () => {
    const claims = [...SHIPPED, ...SYNONYMS];
    for (const [name, re] of Object.entries(DENIES))
      expect(
        claims.some((c) => re.test(c)),
        `${name} catches nothing shipped`,
      ).toBe(true);
    expect(claims.filter((c) => !denies(c))).toEqual([]);
    expect(HONEST.filter(denies)).toEqual([]);
  });

  async function wordSentences(): Promise<string[]> {
    const out: string[] = [];
    for (const container of await containersFor(PDF_TO_WORD_TOOL))
      for (const { sentence, masked } of attributedTo(
        container,
        PDF_TO_WORD_TOOL,
      ))
        if (denies(masked)) out.push(`${container.where}: ${sentence}`);
    return out;
  }

  it("the page says pictures are left out exactly when the .docx carries none", async () => {
    const parts = await officeParts(
      PDF_TO_WORD_TOOL,
      ["Quarterly report\nThe chart below shows the quarter."],
      undefined,
      { picture: true },
    );
    const doc = parts["word/document.xml"] ?? "";
    // Health: the body was decoded, and its text is there, so a .docx with
    // no picture would be the engine's doing, not an empty export.
    expect(doc).toContain("Quarterly report");
    const pictures = (doc.match(/<w:drawing>/g) ?? []).length;
    const media = Object.keys(parts).filter((n) =>
      /^word\/media\/.+\.(?:png|jpeg)$/.test(n),
    );
    const offenders = await wordSentences();
    expect(
      offenders.length > 0,
      pictures > 0
        ? `the .docx carries ${pictures} picture(s) (${media.join(", ")}) — the page may not say they are left out:\n  ${offenders.join("\n  ")}`
        : "the .docx carries no picture — the page must say so",
    ).toBe(pictures === 0);
    // Positive control, through the same attribution the live check uses:
    // every sentence that shipped is attributed to the tool and caught.
    const caught = attributedTo(
      { where: "control", home: PDF_TO_WORD_TOOL, texts: SHIPPED },
      PDF_TO_WORD_TOOL,
    ).filter(({ masked }) => denies(masked));
    expect(caught).toHaveLength(SHIPPED.length);
  }, 60_000);

  it("a JPEG goes into the .docx byte for byte only up to the size the page names; a larger one is scaled down to it", async () => {
    const canvas = createRequire(
      createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
    )("@napi-rs/canvas") as {
      createCanvas(
        w: number,
        h: number,
      ): {
        getContext(k: "2d"): {
          fillStyle: string;
          fillRect(x: number, y: number, w: number, h: number): void;
        };
        toBuffer(m: "image/jpeg", q: number): Uint8Array;
      };
    };
    const jpeg = (w: number, h: number) => {
      const c = canvas.createCanvas(w, h);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#3366cc";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#cc3333";
      ctx.fillRect(0, 0, w / 2, h);
      return new Uint8Array(c.toBuffer("image/jpeg", 85));
    };
    // A line of text above both, so the PDF is not refused as having none.
    const { pdf: words } = await linesPdf([["Two photographs of the site"]]);
    const doc = await PDFDocument.load(words);
    const target = doc.getPage(0);
    const small = jpeg(MAX_PICTURE_SIDE, 60);
    const large = jpeg(MAX_PICTURE_SIDE + 400, 60);
    for (const [bytes, y] of [
      [small, 100],
      [large, 300],
    ] as const)
      await drawRasterImage(target, await embedRasterImage(doc, bytes, "jpg"), {
        x: 40,
        y,
        width: 600,
        height: 40,
      });
    const run = await runPdfOfficeExport(PDF_TO_WORD_TOOL, await doc.save(), {
      extractFlow: flowStandIn,
      scanPages: scanPdfPages,
    });
    if (!run.ok) throw new Error(run.message);
    const body = await readDocxBody(run.output);
    const same = (a: Uint8Array, b: Uint8Array) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    // Health: both pictures are in the document.
    expect(body.pictures).toHaveLength(2);
    expect(
      body.pictures.some((p) => p.bytes && same(p.bytes, small)),
      "the small JPEG, byte for byte",
    ).toBe(true);
    expect(
      body.pictures.some((p) => p.bytes && same(p.bytes, large)),
      "the large JPEG was copied",
    ).toBe(false);
    const px = MAX_PICTURE_SIDE.toLocaleString("en-US");
    const text = (
      await toolContainer(getToolBySlug(PDF_TO_WORD_TOOL)!)
    ).texts.join("\n");
    expect(text).toMatch(new RegExp(`up to ${px} pixels[^.]*byte for byte`));
    expect(text).toMatch(new RegExp(`scaled down to ${px} pixels`));
  }, 60_000);

  /**
   * BOLD AND ITALICS ON EACH WORD — INVERTED 2026-11-15.
   *
   * HISTORY. From 2026-10-17 this test asked about WHOLE paragraphs: the page
   * said "bold or italics only where a whole paragraph is set in them", and
   * "a bold word inside a sentence does not" keep it, and the rule was "a
   * wholly bold paragraph that comes through bold ⇒ no sentence may deny
   * bold". Those sentences were honest then and are DENIALS now: since
   * `docx-run-style.ts` each word keeps its own bold.
   *
   * NOW, per run, on the mixed sentence of `boldItalicPdf` ("Regular words
   * with" then "a bold ending" in a bold face): the page may say a word keeps
   * its bold ONLY IF the bold words' run has `w:b` AND the regular words' run
   * does not — read back by `docx-structure.ts`, not by matching the
   * writer's strings. Otherwise it must deny it, and may not claim it. Both
   * corpora run both ways: every pattern catches a sentence, every sentence
   * is caught by its side, and no honest sentence by the other.
   */
  it("the page says a bold word inside a sentence stays bold exactly when its run is bold and its neighbours' are not", async () => {
    const DENIES_STYLE: Record<string, RegExp> = {
      // 80: the list between "bold" and its verb ran to 70 characters in
      // the third sentence shipped; at 40 that sentence walked past.
      "bold is not carried": /\bbold\b[^.;]{0,80}?\b(?:are|is) not carried\b/i,
      unstyled: /\bunstyled\b/i,
      "only whole paragraphs":
        /\bbold or italics only where a whole paragraph\b/i,
      "a bold word does not": /\ba bold word inside a sentence does not\b/i,
      // Added 2026-11-15 (review round 1): sentences the product DID ship,
      // each walking past the four patterns above — one of them still
      // served by the Edit PDF guide after the how-to guide's copy of it
      // was rewritten.
      "selectable text as plain paragraphs":
        /\b(?:selectable text|the words)\b[^.;]{0,100}?\bas plain paragraphs\b/i,
      "default Normal style": /\bin Word[’']s default Normal style\b/i,
      "arrives in the default style":
        /\b(?:text|words) arrives? in Word[’']s default style\b/i,
      "formatting is not rebuilt": /\bformatting is not rebuilt\b/i,
      "sizes and colours stay behind":
        /\bsizes, colou?rs\b[^.;]{0,80}?\bstay behind\b/i,
    };
    const CLAIMS_STYLE: Record<string, RegExp> = {
      "a bold word stays bold": /\ba bold word inside a sentence stays bold\b/i,
      "each word keeps its bold":
        /\b(?:each word keeps its|words keep their|each word keeping its)\s+bold\b/i,
      "with their bold": /\bwith their bold, italics, sizes and colou?rs\b/i,
    };
    const SHIPPED_STYLE = [
      "Fonts, bold and italics, colours and images are not carried across.",
      "Images, tables, fonts, colors and the page layout are not carried over, so the text arrives unstyled, ready to format in Word — not as a copy of the page.",
      "Fonts, bold and italics, colours, tables, and drawings made of lines and shapes are not carried across.",
      // Honest from 2026-10-17 to 2026-11-15; denials since.
      "Fonts, colours, tables, and drawings made of lines and shapes are not carried across, and bold or italics only where a whole paragraph is set in them, such as a heading.",
      "A paragraph set wholly in bold or italics keeps it; a bold word inside a sentence does not.",
      // Shipped until 2026-11-15, each caught by none of the four patterns
      // that stood then (review round 1). The first was still served by
      // the Edit PDF guide ("Changing the text that is already there").
      "To rework the wording itself, convert the file with PDF to Word: it exports the PDF's selectable text as an editable Word document, as plain paragraphs in reading order, with each picture between them.",
      "The conversion carries the PDF's selectable text into Word as plain paragraphs in reading order, so you edit the words instead of retyping them — the formatting is not rebuilt.",
      "It is not a page replica: lines the PDF wrapped are joined back into paragraphs in Word's default Normal style, each picture sits on a line of its own between the paragraphs printed above and below it, and each PDF page with text or a picture starts on a new Word page.",
      "Tables, fonts, colors, drawings made of lines and shapes elsewhere on the page, and the page layout are not carried over, and bold or italics only where a whole paragraph is set in them, so the text arrives in Word's default style, ready to format — not as a copy of the page.",
      "The DOCX carries the words as plain paragraphs, with the pictures on lines of their own between them; fonts, sizes, colours, tables as tables, link targets and drawings made of lines and shapes stay behind.",
    ];
    /** What the page says since 2026-11-15. */
    const HONEST_STYLE = [
      "Each word keeps its bold, italics, text size and colour wherever our reader matches it to the PDF's text, so a bold word inside a sentence stays bold.",
      // Until 2026-11-15 (#28 slice 2) also the sentence before this one with
      // "tables as tables" / "tables," in its list — no longer the page's:
      // a table whose cells fit on one line is a Word table now.
      // Until 2026-11-15 (#28 slice 4) this said "the typeface, link targets
      // and drawings …" — no longer the page's: each word is set in an Office
      // font of its kind now.
      "Words keep their bold, italics, size and colour where our reader matches them, and a table whose cells each fit on one line, with a column of figures, comes through as a Word table; link targets and drawings made of lines and shapes stay behind, and the page's positions, indentation and spacing are not kept.",
      // Until 2026-11-15 (#28 slice 2) also the sentence before this one with
      // "tables as tables" / "tables," in its list — no longer the page's:
      // a table whose cells fit on one line is a Word table now.
      // Until 2026-11-15 (#28 slice 4) this said "…where they can be matched;
      // the typeface, drawings made of lines and shapes …" — no longer the page's.
      "Each word keeps its bold, italics, size and color where they can be matched, and such a word in the Latin alphabet is set in a font that comes with Windows or Office, a substitute of the same kind as the PDF's font where our reader can tell its kind; drawings made of lines and shapes elsewhere on the page, and the page layout, are not carried over.",
      // Until 2026-11-15 (#28 slice 4) this ended "…, in Word's default
      // typeface." — no longer the guide's.
      "Open the downloaded DOCX in Word and finish the formatting — the words arrive as paragraphs in reading order, with their bold, italics, sizes and colours where they could be matched, each set in a font that comes with Windows or Office, a substitute of the same kind as the PDF's where its kind can be told.",
      "To rework the wording itself, convert the file with PDF to Word: it exports the PDF's selectable text as an editable Word document, in reading order, each word keeping its bold, italics, size and colour where our reader matches it, with each picture between the paragraphs.",
    ];
    const denies = (t: string) =>
      Object.values(DENIES_STYLE).some((re) => re.test(t));
    const claims = (t: string) =>
      Object.values(CLAIMS_STYLE).some((re) => re.test(t));
    for (const [name, re] of Object.entries(DENIES_STYLE))
      expect(
        SHIPPED_STYLE.some((s) => re.test(s)),
        `${name} catches nothing shipped`,
      ).toBe(true);
    for (const [name, re] of Object.entries(CLAIMS_STYLE))
      expect(
        HONEST_STYLE.some((s) => re.test(s)),
        `${name} catches nothing the page says`,
      ).toBe(true);
    expect(SHIPPED_STYLE.filter((s) => !denies(s))).toEqual([]);
    expect(SHIPPED_STYLE.filter(claims)).toEqual([]);
    expect(HONEST_STYLE.filter((s) => !claims(s))).toEqual([]);
    expect(HONEST_STYLE.filter(denies)).toEqual([]);

    const { pdf, paragraph } = await boldItalicPdf();
    const run = await runPdfOfficeExport(PDF_TO_WORD_TOOL, pdf, {
      extractFlow: flowStandIn,
      scanPages: scanPdfPages,
    });
    if (!run.ok) throw new Error(run.message);
    const body = await readDocxStructure(run.output);
    const mixed = body.blocks.flatMap((b) =>
      b.kind === "p" && b.runs.map((r) => r.text).join("") === paragraph.mixed
        ? [b]
        : [],
    );
    // Health: the mixed sentence is in the document, once, whole.
    expect(mixed).toHaveLength(1);
    const runs = mixed[0]!.runs.filter((r) => r.text.trim());
    const boldRuns = runs.filter((r) => /\bbold ending\b/.test(r.text));
    const plainRuns = runs.filter((r) => /\bRegular words\b/.test(r.text));
    expect(boldRuns.length + plainRuns.length).toBeGreaterThan(0);
    const perWord =
      boldRuns.length === 1 &&
      plainRuns.length === 1 &&
      boldRuns[0] !== plainRuns[0] &&
      boldRuns[0]!.b === true &&
      plainRuns[0]!.b !== true;
    const denying: string[] = [];
    const claiming: string[] = [];
    const containers = await containersFor(PDF_TO_WORD_TOOL);
    // Health (2026-11-15): the set holds guides that only NAME the tool —
    // the Edit PDF guide among them — not just the ones that list it.
    const naming = containers.filter((c) =>
      guides.some(
        (g) =>
          c.where === `/guides/${g.slug}` &&
          !g.tools.includes(PDF_TO_WORD_TOOL),
      ),
    );
    expect(naming.length).toBeGreaterThan(0);
    for (const container of containers)
      for (const { sentence, masked } of attributedTo(
        container,
        PDF_TO_WORD_TOOL,
      )) {
        if (denies(masked)) denying.push(`${container.where}: ${sentence}`);
        if (claims(masked)) claiming.push(`${container.where}: ${sentence}`);
      }
    if (perWord) {
      expect(
        denying,
        "a bold word inside a sentence comes through bold — the page may not deny it",
      ).toEqual([]);
      expect(claiming.length, "and the page says so").toBeGreaterThan(0);
    } else {
      expect(
        claiming,
        "the bold word's run is not bold on its own — the page may not claim it",
      ).toEqual([]);
      expect(denying.length, "and the page must say so").toBeGreaterThan(0);
    }
    // Positive controls, through the attribution the live check uses.
    expect(
      attributedTo(
        { where: "control", home: PDF_TO_WORD_TOOL, texts: SHIPPED_STYLE },
        PDF_TO_WORD_TOOL,
      ).filter(({ masked }) => denies(masked)),
    ).toHaveLength(SHIPPED_STYLE.length);
    expect(
      attributedTo(
        { where: "control", home: PDF_TO_WORD_TOOL, texts: HONEST_STYLE },
        PDF_TO_WORD_TOOL,
      ).filter(({ masked }) => claims(masked)),
    ).toHaveLength(HONEST_STYLE.length);
  }, 60_000);

  it("wherever the page promises the note names a lost picture, it states the one exception", async () => {
    const NOTE = /\bleft out\b[^.]*\bnote beside the download names\b/i;
    const EXCEPTION = /\bcannot read before it is drawn\b[^.]*\bno note\b/i;
    // Control: the PowerPoint page's first version of the sentence, which
    // lacked the exception, is caught.
    expect(
      NOTE.test(
        "A picture too large for the worker, or one it cannot decode, is left out, and the note beside the download names its page.",
      ),
    ).toBe(true);
    const texts = (await toolContainer(getToolBySlug(PDF_TO_WORD_TOOL)!)).texts;
    const promises = texts.filter((t) => NOTE.test(t));
    // Health: the page makes the promise, so "none unqualified" is not "none made".
    expect(promises.length).toBeGreaterThanOrEqual(1);
    expect(promises.filter((t) => !EXCEPTION.test(t))).toEqual([]);
  });

  it("a damaged PDF: the page says it is rebuilt first or not converted, and the engine does exactly that", async () => {
    const REBUILT =
      /\brebuilt first\b[^.]*\bthe way Repair PDF does\b[^.]*\bnote\b[^.]*\bsays so\b/i;
    const REFUSED = /\bnot converted\b[^.]*\bRepair PDF\b/i;
    const texts = (await toolContainer(getToolBySlug(PDF_TO_WORD_TOOL)!)).texts;
    expect(
      texts.some((t) => REBUILT.test(t)),
      "the rebuild",
    ).toBe(true);
    expect(
      texts.some((t) => REFUSED.test(t)),
      "the refusal",
    ).toBe(true);
    const fixture = await imageCaptionPdf();
    const damaged = junkAfterEofPdf(fixture.pdf);
    const rebuilt = await runPdfOfficeExport(PDF_TO_WORD_TOOL, damaged, {
      extractFlow: flowStandIn,
      scanPages: scanPdfPages,
      repairPdf: repairStandIn,
    });
    if (!rebuilt.ok) throw new Error(`${rebuilt.kind}: ${rebuilt.message}`);
    expect(rebuilt.coverage.repairedBeforeConversion).toBe(true);
    const refused = await runPdfOfficeExport(PDF_TO_WORD_TOOL, damaged, {
      extractFlow: flowStandIn,
      scanPages: scanPdfPages,
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.kind).toBe("unreadable");
    expect(refused.message).toMatch(/\bRepair PDF\b/);
  }, 60_000);
});

/**
 * The review of 2026-10-17, as claims. The page said two kinds of picture
 * were "left out on purpose" (stencils, repeats), that arrows and boxes drawn
 * on top "do not come across", and that each picture comes through, with no
 * exception for a document past what one conversion carries. The engine now
 * carries both kinds, paints what covers a picture into it, and stops at a
 * budget; each claim is held to a run, both ways, and each shape to the
 * sentences that shipped.
 */
describe("PDF to Word: what the page says of stencils, repeats, covers and budgets holds of the engine", () => {
  async function wordSentences(): Promise<{ where: string; masked: string }[]> {
    const out: { where: string; masked: string }[] = [];
    for (const container of await containersFor(PDF_TO_WORD_TOOL))
      for (const { masked } of attributedTo(container, PDF_TO_WORD_TOOL))
        out.push({ where: container.where, masked });
    return out;
  }
  const run = async (pdf: Uint8Array) => {
    const result = await runPdfOfficeExport(PDF_TO_WORD_TOOL, pdf, {
      extractFlow: flowStandIn,
      scanPages: scanPdfPages,
    });
    if (!result.ok) throw new Error(`${result.kind}: ${result.message}`);
    return result;
  };

  it("kinds of picture: the page says a kind is left out exactly when the engine drops it", async () => {
    const LEFT = String.raw`(?:left out|not carried|not kept|dropped|skipped|only once)`;
    const DENIES_KIND: Record<string, RegExp> = {
      "left out on purpose": /\bleft out on purpose\b/i,
      "stencils left out": new RegExp(
        String.raw`\bstencils?\b[^.;]{0,80}\b${LEFT}|\b${LEFT}[^.;]{0,80}\bstencils?\b`,
        "i",
      ),
      "repeats left out": new RegExp(
        String.raw`\brepeat(?:ed|s)?\b[^.;]{0,80}\b${LEFT}|\b${LEFT}[^.;]{0,80}\brepeat(?:ed|s)?\b`,
        "i",
      ),
    };
    const SHIPPED = [
      "Two kinds are left out on purpose: a one-colour stencil, and a small image repeated across the page as a pattern.",
    ];
    const SYNONYMS = [
      "Stencils are not carried.",
      "A picture repeated across a page comes through only once.",
    ];
    const HONEST = [
      "A one-colour stencil comes through in its colour, and a picture the page repeats comes through each time it is shown.",
      "A picture too large for the worker, or one it cannot decode, is left out.",
    ];
    const denies = (t: string) =>
      Object.values(DENIES_KIND).some((re) => re.test(t));
    const claims = [...SHIPPED, ...SYNONYMS];
    for (const [name, re] of Object.entries(DENIES_KIND))
      expect(
        claims.some((c) => re.test(c)),
        `${name} catches nothing shipped`,
      ).toBe(true);
    expect(claims.filter((c) => !denies(c))).toEqual([]);
    expect(HONEST.filter(denies)).toEqual([]);

    let dropped = 0;
    for (const build of [
      stencilPicturePdf,
      repeatedPicturesPdf,
      inlineImagesPdf,
    ]) {
      const fixture = await build();
      const carried = (await readDocxBody((await run(fixture.pdf)).output))
        .pictures.length;
      dropped += fixture.pictures.length - carried;
    }
    const offenders = (await wordSentences())
      .filter(({ masked }) => denies(masked))
      .map(({ where, masked }) => `${where}: ${masked}`);
    expect(
      offenders.length > 0,
      dropped === 0
        ? `the engine carries every stencil and repeat; the page may not say a kind is left out:\n  ${offenders.join("\n  ")}`
        : `the engine dropped ${dropped}; the page must say which kind`,
    ).toBe(dropped > 0);
  }, 120_000);

  it("covers: the page says what is painted over a picture is drawn into it exactly when the engine does it", async () => {
    const CLAIMS_COVER =
      /\b(?:painted|drawn) (?:over|on top of) (?:a|the|that) (?:picture|screenshot)\b[^.]*\bdrawn into (?:it|that picture)\b|\bdrawn into (?:it|that picture)\b[^.]*\bcovers? stays? covered\b/i;
    const DENIES_COVER =
      /\b(?:arrows?|boxes|labels?|shapes)\b[^.;]{0,80}\b(?:on top|over)\b[^.;]{0,80}\b(?:do not|does not|don't) come across\b/i;
    const SHIPPED = [
      "Arrows and boxes drawn on top are lines and shapes, so they do not come across.",
    ];
    for (const s of SHIPPED) expect(DENIES_COVER.test(s)).toBe(true);
    const HONEST = [
      "Arrows, boxes and labels drawn on top of a screenshot are drawn into it, so it shows what the page shows; lines and shapes elsewhere on the page do not come across.",
    ];
    expect(HONEST.filter((s) => DENIES_COVER.test(s))).toEqual([]);
    expect(HONEST.filter((s) => CLAIMS_COVER.test(s))).toHaveLength(1);

    // The engine: are the covered fixture's 4,000 hidden pixels in the file?
    const fixture = await coveredPicturePdf();
    const media = (await readDocxBody((await run(fixture.pdf)).output))
      .pictures[0]!.bytes!;
    const canvas = createRequire(
      createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
    )("@napi-rs/canvas") as {
      loadImage(b: Uint8Array): Promise<{ width: number; height: number }>;
      createCanvas(
        w: number,
        h: number,
      ): {
        getContext(k: "2d"): {
          drawImage(i: unknown, x: number, y: number): void;
          getImageData(
            x: number,
            y: number,
            w: number,
            h: number,
          ): { data: Uint8ClampedArray };
        };
      };
    };
    const img = await canvas.loadImage(media);
    const ctx = canvas.createCanvas(img.width, img.height).getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    let hidden = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i]! > 200 && d[i + 1]! < 60 && d[i + 2]! > 200) hidden++;
    const covers = hidden === 0;
    const sentences = await wordSentences();
    const deniers = sentences.filter(({ masked }) => DENIES_COVER.test(masked));
    const claimers = sentences.filter(({ masked }) =>
      CLAIMS_COVER.test(masked),
    );
    expect(
      covers ? deniers.map((s) => `${s.where}: ${s.masked}`) : [],
      "the engine draws covers into the picture; the page may not say they do not come across",
    ).toEqual([]);
    expect(
      claimers.length > 0,
      covers
        ? "the engine draws covers into the picture; the page must say so"
        : `the engine leaves ${hidden} hidden pixels in the file; the page may not say covers stay covered`,
    ).toBe(covers);
  }, 120_000);

  it("budgets: the page names the picture count past which pictures are left out, and that the text still comes through whole", async () => {
    const figure = MAX_DOCX_PICTURES.toLocaleString("en-US");
    const BUDGET = new RegExp(
      String.raw`\b${figure} pictures\b[^.]*\b(?:left out|not carried)\b|\b(?:left out|not carried)\b[^.]*\b${figure} pictures\b|\bpast\b[^.]*\b${figure} pictures\b`,
      "i",
    );
    const WHOLE = /\btext\b[^.]{0,80}\b(?:whole|in full|all there)\b/i;
    // Control: the sentence that shipped claims every picture, no exception.
    expect(
      BUDGET.test(
        "Each picture on a page, such as a photo, a screenshot or a scan, comes through on a line of its own between the paragraphs above and below it.",
      ),
    ).toBe(false);
    // The keeps sentence claims each picture; its exception must be there too.
    expect(PDF_TO_WORD_KEEPS).toMatch(BUDGET);
    expect(PDF_TO_WORD_KEEPS).toMatch(WHOLE);
    const texts = (await toolContainer(getToolBySlug(PDF_TO_WORD_TOOL)!)).texts;
    expect(texts.some((t) => BUDGET.test(t) && WHOLE.test(t))).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 *  Compare PDF names the page — a capability that EXISTS, pinned.
 * ------------------------------------------------------------------ */

/**
 * Compare PDF names the page (audit compare-pdf#4, 2026-11-14). Until then
 * the result was one dump of every line, and the page said so: "It does not
 * name the page a change sits on" and "Why is a whole line flagged when only
 * one word changed?". The comparison now heads each change with its page in
 * both files and marks the differing words inside a changed line, and the
 * copy says that.
 *
 * Shaped like the inverted image-to-PDF rule above, in both directions:
 *
 * - the CLAIMS (the new copy) are allowed only while the probe — the
 *   composed `compareExtractedPdfText` run on two real PDFs where a page was
 *   inserted — finds a page header AND a word mark. If the capability goes,
 *   every served claim becomes an offender;
 * - the DENIALS (the old copy) are false while it holds: if one comes back,
 *   it is flagged.
 *
 * Both corpora are caught by their shapes and every shape catches a corpus
 * sentence (CLAUDE.md, guards rule 1).
 */
const COMPARE_PAGE_RULE = {
  id: "Compare PDF names the page and marks the changed words",
  subjects: () => slugsOfKind("compare"),
  claims: {
    "names the page":
      /(?<!\bnot )\bnames? (?:its|the) page\b|\bthe page (?:it|each change) (?:sits|is) on\b/i,
    "page to page": /\bpage \d+ (?:->|→) page \d+\b/i,
    "with its page":
      /\bheaded with (?:its|the) page\b|\bwith (?:its|their) page numbers?\b/i,
    "words marked":
      /\b(?:changed words|words that differ) (?:are )?marked\b|\bword[- ]level\b/i,
  },
  /*
   * WIDENED 2026-11-14 (review of audit compare-pdf#4), history kept: this
   * list was typed, and four served sentences that claim the page matched no
   * shape — step 3 ("each headed with its page in both files"), step 4 and
   * the guide's last step ("with their page numbers"). With the capability
   * neutered (hunkHeader returning "Changes") the guard stayed blind to
   * them. They are below now, and "every served sentence that mentions a
   * page is classified" DISCOVERS such sentences instead of trusting this
   * list to name them.
   */
  shipped: [
    "Tiles for Pages, Size delta and Changed lines sit above the list of changes, each headed with its page in both files.",
    "Download comparison report saves a text file listing only the changes, with their page numbers, named after both PDFs, for example draft-vs-final-comparison.txt.",
    // EDITED 2026-11-15 (S4): the guide's last step and intro name the
    // HTML redline too; both are in COMPARE_REDLINE_RULE.shipped as well.
    "Download the comparison report, a .txt file listing only the changes with their page numbers, or Download redline (HTML) for the same changes as a web page.",
    "You get their page counts, the size difference and every line of text that was added or removed, each under the page it sits on in both files, plus a text report and an HTML redline to download.",
    "Compare PDF reads the selectable text of two versions of a document and lists only what changed, grouped by page: each change is headed with the page it sits on in both files and shown with two unchanged lines around it.",
    "Each change names its page in both files, and inside a changed line the words that differ are marked.",
    // EDITED 2026-11-15 (S4): names the HTML redline's header too.
    "Each change is headed with the page it sits on in each file, for example Page 2 → page 3 when a page was inserted before it, the downloaded report heads it the same way, @@ Page 2 -> page 3 @@, and the HTML redline heads it Page 2 → page 3.",
    "The old line is listed as removed and the new one as added, and the changed words are marked within the line: crossed out in the old one, underlined in the new one, and in the report as [-old-] and {+new+} on a line starting with ~.",
    "Review the lines marked removed (-) and added (+), each headed with its page in both files, with the changed words marked.",
  ],
  synonyms: [
    "It shows word-level changes.",
    // catalog-how.ts's compare-pdf steps: not served while the page has
    // authored steps (page-copy.ts, pageSteps), and caught if they return.
    "Review the lines marked removed (-) and added (+), then download a .txt report listing each change with its page numbers.",
  ],
  /**
   * What a served sentence may say of a page WITHOUT claiming the change's
   * page: the page count, the option's name, a scanned page, the web page.
   * Each shape must catch a served sentence (no decoration).
   */
  notClaims: {
    "a page count": /\bpage counts?\b|\bone page added\b/i,
    "the furniture option": /\bpage headers\b|\bfrom page to page\b/i,
    "a scanned page": /\bscanned page\b/i,
    "the web page": /\bleaving the page\b|\bthe page and its\b/i,
    "page differences": /\bthe page and byte\b|\bto another page\b/i,
    // ADDED 2026-11-15: the page view draws pages, so the offline answer
    // names the image decoder a page's drawing may fetch (tool-facts.ts).
    "a page's drawing": /\brendering a page\b/i,
    // ADDED 2026-11-15 (S3): the overlay's page pairs and its controls.
    "the overlay's pairs":
      /\bpaired by number\b|\bPrevious page or Next page\b|\bmuch of the page\b/i,
  },
  denials: {
    "does not name the page": /\bdoes(?: not|n't) name the page\b/i,
    "a whole line at a time":
      /\ba whole line at a time\b|\bwhole line (?:is )?flagged\b/i,
  },
  denialCorpus: [
    "It does not name the page a change sits on, so search the PDF for that line's text.",
    "Changes are reported a whole line at a time; runs of spaces and tabs count as one space, and indentation, blank lines and page breaks are ignored.",
    "A whole line is flagged when only one word changed.",
  ],
} as const;

/** THE PROPERTY, on two real PDFs: a page header and a word mark. */
async function comparePageProbe(): Promise<Probe> {
  const { left, right } = pageHeaderPair();
  const result = compareExtractedPdfText(
    await comparablePdf("v1.pdf", left),
    await comparablePdf("v2.pdf", right),
  );
  const header = /^@@ Page 2 -> page 3 @@$/m.test(result.report);
  const marked = result.hunks.some((h) =>
    h.pairs.some(
      (p) =>
        p.tokens?.some((t) => t.k === "removed" && t.text === "100") &&
        p.tokens.some((t) => t.k === "added" && t.text === "120"),
    ),
  );
  return {
    present: header && marked,
    evidence: `page header ${header}, word mark ${marked}; hunks: ${result.hunks
      .map((h) => `${h.leftPages.join("-")}>${h.rightPages.join("-")}`)
      .join(", ")}`,
  };
}

describe("Compare PDF: the page and word claims hold of the comparison", () => {
  const asRule = (shapes: Readonly<Record<string, RegExp>>) =>
    ({ shapes }) as unknown as ClaimRule;
  const claimShapes = Object.entries(COMPARE_PAGE_RULE.claims);
  const denialShapes = Object.entries(COMPARE_PAGE_RULE.denials);
  const claims = [...COMPARE_PAGE_RULE.shipped, ...COMPARE_PAGE_RULE.synonyms];

  it("the shapes and both corpora cover each other", () => {
    expect(
      claimShapes
        .filter(([, re]) => !claims.some((c) => re.test(c)))
        .map(([n]) => n),
      "claim shapes nothing exercises",
    ).toEqual([]);
    expect(
      claims.filter((c) => !claimShapes.some(([, re]) => re.test(c))),
      "claims no shape catches",
    ).toEqual([]);
    expect(
      denialShapes
        .filter(
          ([, re]) => !COMPARE_PAGE_RULE.denialCorpus.some((c) => re.test(c)),
        )
        .map(([n]) => n),
      "denial shapes nothing exercises",
    ).toEqual([]);
    expect(
      COMPARE_PAGE_RULE.denialCorpus.filter(
        (c) => !denialShapes.some(([, re]) => re.test(c)),
      ),
      "denials no shape catches",
    ).toEqual([]);
    // The new copy is not read as a denial, nor the old copy as a claim.
    expect(
      claims.filter((c) => denialShapes.some(([, re]) => re.test(c))),
    ).toEqual([]);
    expect(
      COMPARE_PAGE_RULE.denialCorpus.filter((c) =>
        claimShapes.some(([, re]) => re.test(c)),
      ),
    ).toEqual([]);
  });

  it("both corpora are caught THROUGH the attribution, on the subject's own page", () => {
    const subject = COMPARE_PAGE_RULE.subjects()[0]!;
    const synthetic: Container = {
      where: "control",
      home: subject,
      texts: [...COMPARE_PAGE_RULE.shipped, ...COMPARE_PAGE_RULE.denialCorpus],
    };
    const attributed = attributedTo(synthetic, subject);
    const caught = (shapes: Readonly<Record<string, RegExp>>) =>
      attributed.filter(({ masked }) =>
        Object.values(shapes).some((re) => re.test(masked)),
      ).length;
    expect(caught(COMPARE_PAGE_RULE.claims)).toBe(
      COMPARE_PAGE_RULE.shipped.length,
    );
    expect(caught(COMPARE_PAGE_RULE.denials)).toBe(
      COMPARE_PAGE_RULE.denialCorpus.length,
    );
  });

  it("every served sentence that mentions a page is classified: a claim, a denial, or a named non-claim", async () => {
    const page = { page: /\bpage\b/i };
    const notClaims = Object.entries(COMPARE_PAGE_RULE.notClaims);
    const unclassified: string[] = [];
    const used = new Set<string>();
    let discovered = 0;
    for (const subject of COMPARE_PAGE_RULE.subjects()) {
      for (const container of await containersFor(subject)) {
        for (const { sentence, masked } of attributedTo(container, subject)) {
          if (!page.page.test(masked)) continue;
          discovered += 1;
          // EXTENDED 2026-11-15 (S2): a sentence the page-view rule below
          // classifies (its claims and denials) is classified here too.
          const claim = [
            ...claimShapes,
            ...denialShapes,
            ...Object.entries(COMPARE_ON_PAGE_RULE.claims),
            ...Object.entries(COMPARE_ON_PAGE_RULE.denials),
            // EXTENDED 2026-11-15 (S3): and the overlay rule's.
            ...Object.entries(COMPARE_OVERLAY_RULE.claims),
            ...Object.entries(COMPARE_OVERLAY_RULE.denials),
            // EXTENDED 2026-11-15 (S4): and the redline rule's ("as a web
            // page" is the redline, not the change's page).
            ...Object.entries(COMPARE_REDLINE_RULE.claims),
          ].some(([, re]) => re.test(masked));
          const named = notClaims.filter(([, re]) => re.test(masked));
          named.forEach(([n]) => used.add(n));
          if (!claim && named.length === 0)
            unclassified.push(`${container.where}: "${sentence}"`);
        }
      }
    }
    // Health: the discovery reads the page's copy, not an empty corpus.
    expect(discovered).toBeGreaterThanOrEqual(15);
    expect(unclassified, "page sentences no shape classifies").toEqual([]);
    expect(
      notClaims.map(([n]) => n).filter((n) => !used.has(n)),
      "non-claim shapes no served sentence needs",
    ).toEqual([]);
  });

  it("the capability is there: a page header and a word mark, from real PDFs", async () => {
    const probe = await comparePageProbe();
    expect(probe.present, probe.evidence).toBe(true);
  });

  it("served copy claims the page only while it is true, and never denies it while it is", async () => {
    const probe = await comparePageProbe();
    const subjects = COMPARE_PAGE_RULE.subjects();
    expect(subjects.length).toBeGreaterThan(0);
    for (const subject of subjects) {
      const made = await offendersOf(asRule(COMPARE_PAGE_RULE.claims), subject);
      const denied = await offendersOf(
        asRule(COMPARE_PAGE_RULE.denials),
        subject,
      );
      expect(made.seen, `${subject}: corpus collapsed`).toBeGreaterThanOrEqual(
        15,
      );
      if (!probe.present) {
        expect(
          made.offenders,
          `${subject} claims what the comparison no longer does (${probe.evidence})`,
        ).toEqual([]);
        continue;
      }
      // Health: the page does make the claim, so this check is not blind.
      expect(made.offenders.length, subject).toBeGreaterThanOrEqual(1);
      expect(
        denied.offenders,
        `${subject} denies what the comparison does`,
      ).toEqual([]);
    }
  });
});

/**
 * #28 slice 3 (wraps), PR-2, 2026-11-16: the DEFINITE wrapped-cell sentence,
 * as first served: one sentence naming every stated limit of flow.ts rule 7,
 * served verbatim by PDF to Word's intro, its tables FAQ answer and
 * PDF_TO_WORD_KEEPS. Served until 2026-11-16 (plain-copy ruling: public copy
 * reads plainly for ordinary users, not like developer notes). Still true,
 * and kept as a regression: no shape below may catch it.
 */
const WRAPS_DEFINITE_ONE_SENTENCE =
  "A cell whose text continues onto the lines below it, on the same page, stays in its row as one paragraph, except in a table's first column, where the wrap ends the table, and under a column of figures, where only a heading's wrap is kept, and in a heading whose first line sits above the rest of its row, where that line comes through outside the table; a wrapped line our reader finds apart from its cell, as on a page read by OCR, is kept only when it sits closer under its row than the rows sit to each other, and a short line that close under a row, such as a note, may be taken into that row's cell; two cells that wrap onto the same line come through as a row of their own, a figure on a line of its own under a table stays outside it, and a table whose wrapped lines outnumber its rows is not kept as one table: its cells come through as lines of text, often read column by column, and only rows that do not wrap may still form a smaller table.";

/**
 * Since the plain-copy ruling (2026-11-16) the same truth is served in two
 * parts. The tables FAQ answer carries the LIST: a definite lead that ends
 * "except in the layouts below", then three plain sentences that name every
 * limit (the first column; a column of figures; a heading set above its row;
 * two cells wrapping onto one line; a line read apart from its cell, as after
 * OCR, kept only when tight; a tight note that may be taken in; a lone figure;
 * the share cap; and, in the lead, the same page). The intro and
 * PDF_TO_WORD_KEEPS serve one SHORT definite sentence that defers to that list
 * by the entry's question. The wrapped-cell describe reads the short
 * sentence's limits from the list it names ("a deferral to the FAQ covers the
 * limits only when ..."). Curly quotes are built from code points.
 */
const OPEN_QUOTE = String.fromCodePoint(0x201c);
const CLOSE_QUOTE = String.fromCodePoint(0x201d);
const WRAPS_TABLES_QUESTION = "How are tables and multi-column pages handled?";
const WRAPS_SHORT = `A cell whose text wraps onto further lines stays in its row as one paragraph, except in the layouts listed in the answer to ${OPEN_QUOTE}${WRAPS_TABLES_QUESTION}${CLOSE_QUOTE} in the PDF to Word FAQ.`;
const WRAPS_LIST_SENTENCES = [
  "A cell whose text wraps onto further lines on the same page stays in its row as one paragraph, except in the layouts below.",
  "A wrap in a table's first column ends the table; under a column of figures, only a heading's wrap is kept; a heading whose first line sits above the rest of its row has that line come through outside the table; and two cells that wrap onto the same line become a row of their own.",
  "When our reader finds a wrapped line apart from its cell, as on a page read by OCR, it keeps the line only if it sits closer under its row than the rows sit to each other, and a short line that close, such as a note, may be taken into the cell.",
  "A figure on a line of its own under a table stays outside it, and a table with more wrapped lines than rows is not kept as one table: its cells come through as lines of text, often read column by column, and only the rows that do not wrap may still form a smaller table.",
] as const;
const WRAPS_LIST = WRAPS_LIST_SENTENCES.join(" ");

/**
 * #28 slice 2 (tables), added 2026-11-15, modelled on the picture rule above.
 * Until that date every PDF to Word surface said a table came through as
 * tab-separated rows, or that tables as tables stay behind — true of every
 * download then. A table whose cells each fit on one line is now a Word
 * table, so those sentences are DENIALS of what the engine does; and the
 * sentence a rewrite reaches for next — "every table comes through as a Word
 * table" — is an OVERCLAIM, since a wrapped-cell table does not. Both
 * corpora run both ways (house rule 1), and the probe is the consumer's
 * artifact: real exports, read back structurally.
 */
describe("PDF to Word: the table sentences hold of the engine", () => {
  const DENIES_TABLES: Record<string, RegExp> = {
    "tables as tables stay behind":
      /\btables as tables\b[^.;]{0,120}?\b(?:stay behind|are not carried)\b/i,
    "rather than Word table cells":
      /\brather than placed in Word table cells\b/i,
    "tables arrive as lines of text": /\btables arrive as lines of text\b/i,
    "a table's cells separated by tabs":
      /\ba table's cells separated by tabs\b/i,
    "a one-line table as tabbed rows":
      /\btable whose cells each fit on one line comes through (?:as )?one (?:row|paragraph) per (?:line|paragraph|row)\b/i,
    "tables are not recreated":
      /\btables\b[^.;]{0,120}?\b(?:are|is) not (?:recreated|carried (?:over|across))\b/i,
  };
  /** Each one shipped on the PDF to Word surfaces at bcb7d39a. */
  const SHIPPED = [
    "The typeface, tables as tables and drawings made of lines and shapes are not carried across, and text recognised by OCR comes through in Word's default style.",
    "The extractor follows the page's reading order: a page set in two columns is read one column at a time, and a table whose cells each fit on one line comes through one row per paragraph, with its cells separated by tabs rather than placed in Word table cells.",
    "Words keep their bold, italics, size and colour where our reader matches them; the typeface, tables as tables, link targets and drawings made of lines and shapes stay behind, and the page's positions, indentation and spacing are not kept.",
    "A table whose cells each fit on one line comes through as one paragraph per row, with its cells separated by tabs rather than placed in Word table cells; a table whose cells wrap onto a second line is read column by column instead.",
    "The text arrives as paragraphs in reading order: lines that wrap in the PDF are joined into one paragraph, a page set in two columns is read one column at a time, and a table whose cells each fit on one line comes through one row per line, its cells separated by tabs.",
    "Each word keeps its bold, italics, size and color where they can be matched; tables, the typeface, drawings made of lines and shapes elsewhere on the page, and the page layout are not carried over, so the result is a document ready to edit — not a copy of the page.",
    "Headings keep their bold and size but not a Word heading style, and lists and tables arrive as lines of text, a table's cells separated by tabs, so expect to restyle the document: the conversion saves you the retyping, not all of the formatting.",
    "The typeface, tables and page layout are not recreated, so it suits documents where the words matter more than the look.",
  ];
  /** One per shape, each walking past the shipped wording. */
  const SYNONYMS = [
    "Tables as tables are not carried over.",
    "Each row is written out rather than placed in Word table cells.",
    "Lists and tables arrive as lines of text.",
    "You get a table's cells separated by tabs.",
    "A table whose cells each fit on one line comes through one paragraph per row.",
    "Charts and tables are not recreated.",
  ];
  /**
   * What the surfaces say since review round 2 (2026-11-15), which neither
   * a denial nor an overclaim may catch. Until then this list also held
   * "each value sits in its own column", "a table that continues onto the
   * next page comes through as a second table", "one with more cells than
   * one page's limit" and "a table whose cells each fit on one line comes
   * through as a Word table" with no column of figures — each false of the
   * engine, now in OVERCLAIM_SHIPPED below.
   */
  const HONEST = [
    // Until 2026-11-15 (#28 slice 4) also "The typeface and drawings made
    // of lines and shapes are not carried across, and text recognised by OCR
    // comes through in Word's default style." — no longer the page's.
    "Drawings made of lines and shapes are not carried across.",
    "The extractor follows the page's reading order: a page set in two columns is read one column at a time.",
    // Until 2026-11-16 (#28 slice 3, wraps) this ended "and a table whose
    // cells wrap onto a second line is not laid out as one Word table: the
    // rows around a wrapped cell may come through as a smaller table, and
    // the rest as lines of text." — now a DENIAL, in the wrapped-cell
    // describe's SHIPPED below.
    // Until 2026-11-16 (review minor 2) the wrapped-table clause FOLLOWED
    // "other tables come through one row per paragraph / as lines of text",
    // which already took in a table whose cells do not each fit one line —
    // so the next clause contradicted it. The clauses now run wrapped
    // tables first, then "other tables".
    // Until 2026-11-16 (#28 slice 3, wraps; PR-2) this sentence went on
    // "; a table whose cells wrap onto further lines may come through as one
    // Word table, each wrapped cell kept in its row, or as a smaller table
    // and lines of text, or as lines of text alone, and other tables come
    // through one row per paragraph, their cells separated by tabs." — the
    // interim sentence, now a DENIAL in the wrapped-cell describe's SHIPPED.
    "A table whose cells each fit on one line, with at least three rows and a column of figures such as amounts, quantities or dates, comes through as a Word table, each value in the column it sits under and an empty cell left empty.",
    // Until 2026-11-16 (plain-copy ruling) WRAPS_DEFINITE_ONE_SENTENCE; it
    // is kept, still honest, beside what replaced it.
    WRAPS_DEFINITE_ONE_SENTENCE,
    WRAPS_SHORT,
    ...WRAPS_LIST_SENTENCES,
    "Other tables come through one row per paragraph, their cells separated by tabs.",
    // Until 2026-11-15 (#28 slice 4) this said "the typeface, link targets
    // and drawings …" — no longer the page's: each word is set in an Office
    // font of its kind now.
    "Words keep their bold, italics, size and colour where our reader matches them, and a table whose cells each fit on one line, with a column of figures, comes through as a Word table; link targets and drawings made of lines and shapes stay behind, and the page's positions, indentation and spacing are not kept.",
    "A table comes through as a Word table when each of its cells fits on one line, it has at least three rows, and one of its columns holds figures such as amounts, quantities or dates: each value stays in the column it sits under, an empty cell stays empty, and the words keep their formatting.",
    "Where one heading spans two columns, the values under it can share a cell, separated by a tab.",
    "Thin grey borders are added, since the PDF's own lines and shading are not read.",
    "A table we are less sure of comes through one row per paragraph with its cells separated by tabs instead: one with no column of figures, one with a column of sentences beside it, one whose heading does not sit over its values, one of more than 63 columns (Word's limit) or more than 10,000 cells, the tables of a page past its first 20,000 cells (empty ones counted), and every table of a document that would otherwise be too large to deliver, which the note beside the download then says.",
    "A table that continues onto the next page is not joined into one: each page's part is judged on its own, so a part of one or two rows comes through as lines of text.",
    "The text arrives as paragraphs in reading order: lines that wrap in the PDF are joined into one paragraph, a page set in two columns is read one column at a time, and a table whose cells each fit on one line, with a column of figures such as amounts or dates, comes through as a Word table, each value in the column it sits under.",
    // Until 2026-11-16 (#28 slice 3, wraps) also "Other tables come through
    // as lines of text, their cells separated by tabs, and a table whose
    // cells wrap onto a second line may come through partly as a smaller
    // table.", "… a table comes through as a Word table only when each of
    // its cells fits on one line and one of its columns holds figures, …"
    // and "… only a table whose cells each fit on one line, with a column of
    // figures, comes through as a Word table, …" — each now a DENIAL, in the
    // wrapped-cell describe's SHIPPED below.
    // Until 2026-11-16 (#28 slice 3, wraps; PR-2) also the interim
    // sentences "A table whose cells wrap onto further lines may come through …", and the guides' "one whose cells wrap
    // onto further lines may come through whole, in part or as lines of
    // text" — now DENIALS, in the wrapped-cell describe's SHIPPED.
    "Other tables come through as lines of text, their cells separated by tabs.",
    "Headings keep their bold and size but not a Word heading style, lists arrive as lines of text, and a table comes through as a Word table only when it has at least three rows and one of its columns holds figures; in such a table a cell that wraps onto further lines may stay in its row as one paragraph or come through as a row or a line of its own, as it does in the table's first column, where the wrap ends the table, so expect to restyle the document: the conversion saves you the retyping, not all of the formatting.",
    // Until 2026-11-15 (#28 slice 4) this began "The typeface and page
    // layout are not recreated" — no longer the guide's.
    "The page layout is not recreated, words are set in standard Office fonts, and only a table with at least three rows and a column of figures comes through as a Word table (a cell in it that wraps onto further lines may stay in its row or come through as a row or a line of its own, and in the table's first column the wrap ends the table), so it suits documents where the words matter more than the look.",
    "Each scanned page comes through as its picture, followed by the text read from it, as plain paragraphs you can edit, search and copy; a table read from a scan may come through as a Word table or as lines of text.",
  ];
  const OVERCLAIMS: Record<string, RegExp> = {
    "every table is a Word table":
      /\b(?:every|all|each) (?:of (?:the|its|your) )?tables?\b[^.;]{0,60}?\bcomes? through as (?:a )?Word tables?\b/i,
    "tables kept exactly": /\btables? (?:are|is) kept exactly\b/i,
    "borders match": /\bborders?\b[^.;]{0,40}?\b(?:match|are kept|is kept)\b/i,
    "the same tables as Extract Tables":
      /\bthe same tables? (?:as )?Extract Tables\b/i,
    // Review round 2 (2026-11-15): four sentences the branch shipped at
    // 61184c12, each false of the engine (its counterexample is below).
    "one line alone makes a Word table":
      /^(?!.*\bfigures?\b)(?=.*\bfits? on one line\b).*\b(?:comes? through as|becomes?) (?:a )?Word tables?\b/i,
    "each value in its own column":
      /\beach value (?:sits )?in its own column\b/i,
    "a continued table is a second table":
      /\b(?:continues?|runs?) onto the next page\b[^.;]{0,60}?\bas (?:a )?(?:second|separate|new) table\b/i,
    "a table's cap is the page's":
      /\bmore cells than (?:one|a) page(?:'s limit| allows)\b/i,
  };
  /** The sentence a rewrite would ship, and one synonym per shape. */
  const OVERCLAIM_SHIPPED = [
    "Every table in your PDF comes through as a Word table, with its borders kept.",
    // Shipped on the branch at 61184c12 (review round 2):
    "A table whose cells each fit on one line comes through as a Word table, each value in its own column and an empty cell left empty; a table whose cells wrap onto a second line is not laid out as one Word table: the rows around a wrapped cell may come through as a smaller table, and the rest as lines of text.",
    "A table that continues onto the next page comes through as a second table.",
    "A table of more than 63 columns (Word's limit), one with more cells than one page's limit, or one whose columns cannot be told apart comes through one row per paragraph with its cells separated by tabs instead.",
  ];
  const OVERCLAIM_SYNONYMS = [
    "All tables come through as Word tables.",
    "Tables are kept exactly as the PDF draws them.",
    "The borders match the PDF's.",
    "Word gets the same tables Extract Tables finds.",
    "Any table whose cells fit on one line becomes a Word table.",
    "Each value sits in its own column.",
    "A table that runs onto the next page arrives as a separate table.",
    "A table with more cells than a page allows stays tabbed.",
  ];
  const denies = (t: string) =>
    Object.values(DENIES_TABLES).some((re) => re.test(t));
  const overclaims = (t: string) =>
    Object.values(OVERCLAIMS).some((re) => re.test(t));

  it("both corpora, both ways: every shape catches a sentence, every sentence is caught, and the honest ones pass", () => {
    for (const [name, re] of Object.entries(DENIES_TABLES))
      expect(
        [...SHIPPED, ...SYNONYMS].some((c) => re.test(c)),
        `${name} catches nothing shipped`,
      ).toBe(true);
    expect([...SHIPPED, ...SYNONYMS].filter((c) => !denies(c))).toEqual([]);
    expect(HONEST.filter(denies)).toEqual([]);
    for (const [name, re] of Object.entries(OVERCLAIMS))
      expect(
        [...OVERCLAIM_SHIPPED, ...OVERCLAIM_SYNONYMS].some((c) => re.test(c)),
        `${name} catches nothing`,
      ).toBe(true);
    expect(
      [...OVERCLAIM_SHIPPED, ...OVERCLAIM_SYNONYMS].filter(
        (c) => !overclaims(c),
      ),
    ).toEqual([]);
    expect(HONEST.filter(overclaims)).toEqual([]);
  });

  async function offenders(test: (t: string) => boolean): Promise<string[]> {
    const out: string[] = [];
    for (const container of await containersFor(PDF_TO_WORD_TOOL))
      for (const { sentence, masked } of attributedTo(
        container,
        PDF_TO_WORD_TOOL,
      ))
        if (test(masked)) out.push(`${container.where}: ${sentence}`);
    return out;
  }

  type Tbl = Extract<
    Awaited<ReturnType<typeof readDocxStructure>>["blocks"][number],
    { kind: "tbl" }
  >;
  async function tablesOf(pdf: Uint8Array): Promise<Tbl[]> {
    const run = await runPdfOfficeExport(PDF_TO_WORD_TOOL, pdf, {
      extractFlow: flowStandIn,
      scanPages: scanPdfPages,
    });
    if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
    return (await readDocxStructure(run.output)).blocks.filter(
      (b): b is Tbl => b.kind === "tbl",
    );
  }
  const cell = (t: Tbl, r: number, c: number) =>
    (t.rows[r]?.cells[c]?.blocks ?? [])
      .flatMap((b) => (b.kind === "p" ? b.runs : []))
      .map((x) => x.text)
      .join("");

  it("the page denies tables exactly when the gapped export holds none, and never claims every table while a wrapped one is not whole", async () => {
    const { gappedTablePdf, wrappedCellTablePdf } =
      await import("@/tests/pdf-office-fixtures");
    const gapped = await tablesOf(await gappedTablePdf());
    // Health: the gapped export holds a table (measured: one, 3 x 4).
    expect(gapped.length).toBeGreaterThan(0);
    const priced = gapped.some(
      (t) => t.gridCols.length === 3 && cell(t, 2, 2) === "12.00",
    );
    const deniers = await offenders(denies);
    expect(
      deniers,
      priced
        ? "the .docx holds a Word table with 12.00 in its third column — no sentence may deny tables"
        : "the .docx holds no such table — the page must say so",
    ).toEqual(priced ? [] : deniers.length ? deniers : ["(none)"]);

    // The wrapped exports, measured on the stand-in extractor. 2026-11-15:
    // TWO tables each (the rows above the wrapped cell, the rows below),
    // the continuation a line of text. INVERTED the same day (review round
    // 2): ONE each — the header and the rows down to the wrapped one; the
    // two rows below it are a two-row table, under MIN_WORD_TABLE_ROWS, and
    // stay tabbed. Never one whole five-row table.
    // INVERTED 2026-11-16 (#28 slice 3, wraps — flow.ts rule 7): ONE whole
    // five-row table each on the stand-in (a labelled stand-in pin; the
    // image's poppler gives the same, flow-wraps.test.ts S2). Until then:
    // `expect(wrapped[0]!.rows.length, kind).toBe(3)`.
    for (const kind of ["long", "short"] as const) {
      const wrapped = await tablesOf(await wrappedCellTablePdf(kind));
      expect(wrapped.length, kind).toBe(1);
      expect(wrapped[0]!.rows.length, kind).toBe(5);
    }
    // The "every table" overclaim keeps a LIVE counterexample: a wrap in the
    // first column (S6, the image's capture) is not one whole table. It was
    // keyed on the wrapped exports above, which are whole since 2026-11-16,
    // so it would have stopped running.
    {
      const { IMAGE_ACADEMIC_LABEL_WRAP_BBOX } =
        await import("@/tests/poppler-samples-image");
      const run = await runPdfOfficeExport(
        PDF_TO_WORD_TOOL,
        new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        {
          extractFlow: async () =>
            flowText(parseBboxFlow(IMAGE_ACADEMIC_LABEL_WRAP_BBOX)),
          scanPages: noPictures,
        },
      );
      if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
      const s6 = (await readDocxStructure(run.output)).blocks.filter(
        (b): b is Tbl => b.kind === "tbl",
      );
      // Health: measured, one table of the 3 rows above the wrap.
      expect(s6.map((t) => t.rows.length)).toEqual([3]);
      const whole = s6.length === 1 && s6[0]!.rows.length === 6;
      expect(whole).toBe(false);
      if (!whole) expect(await offenders(overclaims)).toEqual([]);
    }

    // Review round 2: the engine's counterexample to each overclaim the
    // branch shipped, then no such sentence on any surface.
    const { wordsOnlyTablePdf, continuedTablePdf } =
      await import("@/tests/pdf-office-fixtures");
    // "one line alone makes a Word table": a table of words, no figures.
    expect(await tablesOf(await wordsOnlyTablePdf(false))).toEqual([]);
    // Health: the same geometry with a column of figures IS a Word table.
    expect(await tablesOf(await wordsOnlyTablePdf(true))).toHaveLength(1);
    // "each value in its own column": a spanning heading's values share one.
    const spanning = await runPdfOfficeExport(
      PDF_TO_WORD_TOOL,
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      {
        extractFlow: async () => flowText(parseBboxFlow(SPANNING_TABLE_BBOX)),
        scanPages: noPictures,
      },
    );
    if (!spanning.ok) throw new Error(spanning.message);
    const shared = (await readDocxStructure(spanning.output)).blocks
      .filter((b): b is Tbl => b.kind === "tbl")
      .flatMap((t) =>
        t.rows.flatMap((r, ri) => r.cells.map((_, c) => cell(t, ri, c))),
      )
      .filter((text) => text.includes("\t"));
    expect(shared).toContain("1200\t1350");
    // "a continued table is a second table": one row on the next page.
    expect(await tablesOf(await continuedTablePdf(1))).toHaveLength(1);
    // Health: three rows on the next page ARE a second table.
    expect(await tablesOf(await continuedTablePdf(3))).toHaveLength(2);
    expect(await offenders(overclaims)).toEqual([]);

    // Positive controls, through the same attribution the live check uses.
    const caught = attributedTo(
      { where: "control", home: PDF_TO_WORD_TOOL, texts: SHIPPED },
      PDF_TO_WORD_TOOL,
    ).filter(({ masked }) => denies(masked));
    expect(caught).toHaveLength(SHIPPED.length);
    const over = attributedTo(
      { where: "control", home: PDF_TO_WORD_TOOL, texts: OVERCLAIM_SHIPPED },
      PDF_TO_WORD_TOOL,
    ).filter(({ masked }) => overclaims(masked));
    expect(over).toHaveLength(OVERCLAIM_SHIPPED.length);
  }, 120_000);
});

/**
 * #28 slice 3 (wraps), added 2026-11-16, modelled on the table rule above.
 * Until that date every PDF to Word surface said a table whose cells wrap
 * is not laid out as one Word table, or that a Word table needs cells that
 * each fit on one line — true of every download then. flow.ts rule 7 now
 * keeps a wrapped cell in its row, in a column of text other than the
 * first, so those sentences are DENIALS of the engine; and the sentence a
 * rewrite reaches for next — "every wrapped cell stays in its row" — is an
 * OVERCLAIM, since a first-column wrap still ends its table (S6).
 *
 * PR-1 ships an INTERIM sentence (content/pdf-to-word.ts, CHANGED
 * 2026-11-16) because the web tier can be served beside the worker image
 * before slice 3: it names every measured outcome and so is neither. PR-2
 * swaps in the definite sentence once `docxTableWraps` reads true at the
 * wire, and moves the interim sentence into SHIPPED.
 *
 * PR-2, 2026-11-16: done. `docxTableWraps` was read true in production and
 * a real invoice through the live page (`.claude/prove-word-wraps.ts`) came
 * back as ONE Word table of 5 rows, each wrapped description one paragraph
 * in its own row's cell. The interim sentences, which offered the kept row
 * as one outcome among "a smaller table and lines of text" and "lines of
 * text alone", are now SHIPPED denials (the shape "a wrapped table MAY come
 * through whole … or as lines of text"); HONEST holds the definite sentence
 * (`WRAPS_DEFINITE`) and the guides' two "may stay in its row" sentences.
 * The definite sentence is held to EVERY stated limit of flow.ts rule 7 by
 * one overclaim shape per limit, each exercised by the definite sentence
 * with that limit's clause cut out (`withoutLimit`).
 *
 * The engine side is the consumer's artifact on the IMAGE's poppler: the
 * probe page (S1) and the first-column wrap (S6) exported through the whole
 * engine from their captures (`@/tests/poppler-samples-image`, poppler
 * 22.12.0), read back structurally. Not the stand-in: in slice 2 the
 * stand-in predicted one table of three rows where the image printed none
 * and one. A stand-in run is kept beside it as a labelled stand-in pin.
 */
describe("PDF to Word: the wrapped-cell sentences hold of the engine", () => {
  const DENIES_WRAPS: Record<string, RegExp> = {
    "is not laid out as one Word table":
      /\b(?:is|are) not laid out as (?:one|a single) Word table\b/i,
    // A denial only when the sentence does not also offer the whole table:
    // the interim sentence says "as a smaller table" beside "may come
    // through as one Word table", and is honest.
    "the rows around a wrapped cell as a smaller table":
      /^(?!.*\bmay come through as one Word table\b).*\brows around a wrapped cell\b[^.;]{0,60}?\bas a smaller table\b/i,
    "a wrapped table only partly as a smaller table":
      /^(?!.*\bmay come through as one Word table\b).*\bwrap\w*\b[^.;:]{0,80}?\b(?:partly|only) as a smaller table\b/i,
    "only when each of its cells fits on one line":
      /\bonly when each of its cells fits? on one line\b/i,
    "only a table whose cells each fit on one line":
      /\bonly (?:a )?tables? whose cells (?:each )?fits? on one line\b/i,
    // PR-2, 2026-11-16: the interim sentence, inverted. While the worker
    // image could predate slice 3 it was honest; with `docxTableWraps` read
    // true it puts the kept row on a par with "lines of text (alone)", and
    // says nothing of when each happens — a denial of the shipped rule.
    "a wrapped table may come through whole, or as lines of text":
      /\bwrap\w*\b[^.;]{0,80}?\bmay come through (?:as (?:one|a single) Word table|whole)\b[^.;]{0,120}?\bas lines of text\b/i,
  };
  /**
   * Each one shipped on the PDF to Word surfaces at 0985432a — and, from
   * PR-1 until PR-2 (both 2026-11-16), the interim sentences after them.
   */
  const SHIPPED = [
    // pdf-to-word.ts intro[1]
    "A table whose cells each fit on one line, with at least three rows and a column of figures such as amounts, quantities or dates, comes through as a Word table, each value in the column it sits under and an empty cell left empty; other tables come through one row per paragraph, their cells separated by tabs, and a table whose cells wrap onto a second line is not laid out as one Word table: the rows around a wrapped cell may come through as a smaller table, and the rest as lines of text.",
    // pdf-to-word.ts, the tables FAQ answer
    "A table whose cells wrap onto a second line is not laid out as one Word table: the rows around a wrapped cell may come through as a smaller table, and the rest as lines of text.",
    // tool-facts.ts PDF_TO_WORD_KEEPS, its last-but-one sentence
    "Other tables come through as lines of text, their cells separated by tabs, and a table whose cells wrap onto a second line may come through partly as a smaller table.",
    // guides/catalog.ts, the convert guide
    "Headings keep their bold and size but not a Word heading style, lists arrive as lines of text, and a table comes through as a Word table only when each of its cells fits on one line and one of its columns holds figures, so expect to restyle the document: the conversion saves you the retyping, not all of the formatting.",
    // guides/catalog.ts, the add-text guide's pointer to PDF to Word
    "The page layout is not recreated, words are set in standard Office fonts, and only a table whose cells each fit on one line, with a column of figures, comes through as a Word table, so it suits documents where the words matter more than the look.",
    // PR-1's INTERIM sentences (HONEST until PR-2, 2026-11-16), verbatim.
    // pdf-to-word.ts intro[1]
    "A table whose cells each fit on one line, with at least three rows and a column of figures such as amounts, quantities or dates, comes through as a Word table, each value in the column it sits under and an empty cell left empty; a table whose cells wrap onto further lines may come through as one Word table, each wrapped cell kept in its row, or as a smaller table and lines of text, or as lines of text alone, and other tables come through one row per paragraph, their cells separated by tabs.",
    // pdf-to-word.ts, the tables FAQ answer
    "A table whose cells wrap onto further lines may come through as one Word table, each wrapped cell kept in its row, or as a smaller table and lines of text, or as lines of text alone.",
    // tool-facts.ts PDF_TO_WORD_KEEPS
    "A table whose cells wrap onto further lines may come through as one Word table, each wrapped cell kept in its row, or as a smaller table and lines of text, or as lines of text alone; other tables come through as lines of text, their cells separated by tabs.",
    // guides/catalog.ts, the convert guide
    "Headings keep their bold and size but not a Word heading style, lists arrive as lines of text, and a table comes through as a Word table only when it has at least three rows and one of its columns holds figures, and one whose cells wrap onto further lines may come through whole, in part or as lines of text, so expect to restyle the document: the conversion saves you the retyping, not all of the formatting.",
    // guides/catalog.ts, the add-text guide's pointer to PDF to Word
    "The page layout is not recreated, words are set in standard Office fonts, and only a table with at least three rows and a column of figures comes through as a Word table (one whose cells wrap onto further lines may come through whole, in part or as lines of text), so it suits documents where the words matter more than the look.",
  ];
  /** One per shape, each walking past the shipped wording. */
  const SYNONYMS = [
    "A wrapped table is not laid out as a single Word table.",
    "The rows around a wrapped cell come through as a smaller table.",
    "A table with wrapped cells comes through only as a smaller table.",
    "It becomes a Word table only when each of its cells fits on one line.",
    "Only tables whose cells fit on one line come through as Word tables.",
    "Tables with wrapped cells may come through whole, in part, or as lines of text.",
  ];
  /**
   * PR-2's definite sentences (2026-11-16), which neither side may catch.
   * Until 2026-11-16 (PR-2) also PR-1's interim sentences, now the last
   * five of SHIPPED above; and until review minor 2 of PR-1 the intro's
   * wrapped-table clause FOLLOWED "other tables come through one row per
   * paragraph", which already took in a table whose cells do not each fit
   * one line.
   */
  const HONEST = [
    // Until 2026-11-16 (plain-copy ruling) the one-sentence form,
    // WRAPS_DEFINITE_ONE_SENTENCE, no longer served and checked on its own
    // below. Its truth is served now as the short deferring sentence and
    // the tables FAQ's list.
    WRAPS_SHORT,
    ...WRAPS_LIST_SENTENCES,
    "Headings keep their bold and size but not a Word heading style, lists arrive as lines of text, and a table comes through as a Word table only when it has at least three rows and one of its columns holds figures; in such a table a cell that wraps onto further lines may stay in its row as one paragraph or come through as a row or a line of its own, as it does in the table's first column, where the wrap ends the table, so expect to restyle the document: the conversion saves you the retyping, not all of the formatting.",
    "The page layout is not recreated, words are set in standard Office fonts, and only a table with at least three rows and a column of figures comes through as a Word table (a cell in it that wraps onto further lines may stay in its row or come through as a row or a line of its own, and in the table's first column the wrap ends the table), so it suits documents where the words matter more than the look.",
  ];
  const OVERCLAIMS_WRAPS: Record<string, RegExp> = {
    "every wrapped cell stays in its row":
      /\b(?:every|any|all|each) wrapped cells? (?:stays?|is kept|are kept|remains?) in (?:its|their) rows?\b/i,
    "wrapped cells in any column":
      /\bwrap\w*\b[^.;]{0,80}?\bin (?:any|every|all) columns?\b/i,
    "always one Word table":
      /\bwrap\w*\b[^.;]{0,60}?\balways comes? through as (?:one|a single|a) Word table\b/i,
    // Definite (no "may") and silent about the first column, which a wrap
    // still ends (S6).
    "a definite 'stays in its row'":
      /^(?!.*\bfirst column\b)(?!.*\bmay\b).*\b(?:stays?|is kept|are kept|remains?) in (?:its|their) rows?\b/i,
    // Review 2026-11-16: the interim sentence with its "may" and its
    // alternatives removed. A wrap still ends a table in the first column
    // (S6), and the image before slice 3 writes no Word table for one.
    "a definite 'a wrapped table is one Word table'":
      /^(?!.*\bmay\b)(?!.*\bnot\b).*\bwrap\w*\b[^.;]{0,80}?\bcomes? through as (?:one|a single) Word table\b/i,
    // PR-2, 2026-11-16: one shape per stated limit of flow.ts rule 7, each
    // a DEFINITE "stays in its row" (not "may stay": a "may" that covers
    // every limit is honest, and the guides use one) in a sentence that
    // does not name that limit. A sentence-wide "may" does NOT exempt
    // these, unlike the shape above: the definite sentence carries a "may"
    // for the note clause, and that "may" says nothing about the rest.
    "kept in its row, silent about the first column":
      /^(?!.*\bfirst column\b).*(?<!\bmay )\b(?:stays?|is kept|are kept|remains?) in (?:its|their) rows?\b/i,
    "kept in its row, silent about a column of figures":
      /^(?!.*\bcolumns? of figures\b).*(?<!\bmay )\b(?:stays?|is kept|are kept|remains?) in (?:its|their) rows?\b/i,
    "kept in its row, silent about a line read apart from its cell (OCR)":
      /^(?!.*\b(?:OCR|scan\w*|apart from)\b).*(?<!\bmay )\b(?:stays?|is kept|are kept|remains?) in (?:its|their) rows?\b/i,
    "kept in its row, silent about a note set tighter than the rows":
      /^(?!.*\bnotes?\b).*(?<!\bmay )\b(?:stays?|is kept|are kept|remains?) in (?:its|their) rows?\b/i,
    "kept in its row, silent about two cells wrapping on one line":
      /^(?!.*\b(?:same|one) (?:line|baseline)\b).*(?<!\bmay )\b(?:stays?|is kept|are kept|remains?) in (?:its|their) rows?\b/i,
    "kept in its row, silent about a lone figure":
      /^(?!.*\b(?:figure|number|total)s? (?:on a line of its own|alone|by itself)\b)(?!.*\b(?:lone|single) (?:figure|number|total)s?\b).*(?<!\bmay )\b(?:stays?|is kept|are kept|remains?) in (?:its|their) rows?\b/i,
    "kept in its row, silent about the share cap":
      /^(?!.*\boutnumber\w*\b)(?!.*\bmore wrapped lines than\b).*(?<!\bmay )\b(?:stays?|is kept|are kept|remains?) in (?:its|their) rows?\b/i,
    // Review 2026-11-16 (PR-2, major 1): flow.ts rule 7 states "a header
    // line ABOVE the first row is not a continuation", and the definite
    // sentence first said nothing of it while telling the reader that a
    // heading's wrap is kept. S7 bottom-aligned (IMAGE_ACADEMIC_HEADER_BOTTOM)
    // prints "Term | constant maturities | Spread | Volume" as the header
    // row and "Treasury" as a paragraph after the table.
    "kept in its row, silent about a heading set above its row":
      /^(?!.*\bheading\w*\b[^.;]{0,80}?\b(?:above|higher than)\b).*(?<!\bmay )\b(?:stays?|is kept|are kept|remains?) in (?:its|their) rows?\b/i,
    // Plain-copy ruling, 2026-11-16: flow.ts rule 7 joins a continuation on
    // the SAME page only. The one-sentence form said "on the same page" and
    // no shape asked for it, so a rewrite could drop it unseen; the list's
    // lead says it now, and this shape holds it there.
    "kept in its row, silent about the same page":
      /^(?!.*\b(?:same|next) page\b).*(?<!\bmay )\b(?:stays?|is kept|are kept|remains?) in (?:its|their) rows?\b/i,
    // Review 2026-11-16 (PR-2, major 2): a share-cap clause that says what
    // happens to the wrapped LINES ("keeps none of them in their rows") but
    // not to the TABLE reads as if the table and its rows survive. S4
    // (IMAGE_WRAPPED_INVOICE_EVERY_ROW) prints no Word table for it: the
    // item codes, descriptions, quantities and prices each come through as
    // lines of text, column by column. A share-cap clause must say so.
    "a share-capped table, silent that its cells come through as lines of text":
      /\b(?:outnumber\w*|more wrapped lines than (?:its )?rows)\b(?![^.;]*\blines of text\b)/i,
  };
  /**
   * The tables FAQ's list (WRAPS_LIST) with one stated limit cut out: the
   * rewrite an editor shortening it would ship. In limit-shape order.
   * Throws when the clause is not in the list exactly once, so a reworded
   * list cannot leave a counterexample silently equal to the honest one.
   * Until 2026-11-16 (plain-copy ruling) these were cut from the
   * one-sentence form, WRAPS_DEFINITE_ONE_SENTENCE, eight of them.
   */
  const withoutLimit = (clause: string, replacement: string): string => {
    const at = WRAPS_LIST.indexOf(clause);
    if (at < 0 || WRAPS_LIST.indexOf(clause, at + 1) >= 0)
      throw new Error(`not exactly once in WRAPS_LIST: ${clause}`);
    return WRAPS_LIST.replace(clause, replacement);
  };
  const CUT_LIMITS = [
    withoutLimit(
      "A wrap in a table's first column ends the table; under",
      "Under",
    ),
    withoutLimit(
      "; under a column of figures, only a heading's wrap is kept;",
      ";",
    ),
    withoutLimit(
      "When our reader finds a wrapped line apart from its cell, as on a page read by OCR, it keeps the line only if it sits closer under its row than the rows sit to each other, and a short line that close,",
      "A short line close under a row,",
    ),
    withoutLimit(
      ", and a short line that close, such as a note, may be taken into the cell.",
      ".",
    ),
    withoutLimit(
      "; and two cells that wrap onto the same line become a row of their own.",
      ".",
    ),
    withoutLimit(
      "A figure on a line of its own under a table stays outside it, and a table",
      "A table",
    ),
    withoutLimit(
      ", and a table with more wrapped lines than rows is not kept as one table: its cells come through as lines of text, often read column by column, and only the rows that do not wrap may still form a smaller table.",
      ".",
    ),
    withoutLimit(
      "; a heading whose first line sits above the rest of its row has that line come through outside the table;",
      ";",
    ),
    withoutLimit(" on the same page", ""),
  ];
  /**
   * PR-2's first definite sentence (a334f009, 2026-11-16, never served),
   * verbatim: silent about a heading set above its row, and its share-cap
   * clause said only that the wrapped lines were not kept in their rows.
   */
  const WRAPS_DEFINITE_FIRST_DRAFT =
    "A cell whose text continues onto the lines below it, on the same page, stays in its row as one paragraph, except in a table's first column, where the wrap ends the table, and under a column of figures, where only a heading's wrap is kept; a wrapped line our reader finds apart from its cell, as on a page read by OCR, is kept only when it sits closer under its row than the rows sit to each other, and a short line that close under a row, such as a note, may be taken into that row's cell; two cells that wrap onto the same line come through as a row of their own, a figure on a line of its own under a table stays outside it, and a table whose wrapped lines outnumber its rows keeps none of them in their rows.";
  /** The sentence a rewrite would ship, one per shape, and a synonym each. */
  const OVERCLAIM_WRAPS_SHIPPED = [
    "Every wrapped cell stays in its row, as one paragraph.",
    "A table whose cells wrap, in any column, comes through as one Word table.",
    "A table with wrapped cells always comes through as one Word table.",
    "A cell whose text continues onto the lines below it stays in its row, as one paragraph.",
    "A table whose cells wrap onto further lines comes through as one Word table, each wrapped cell kept in its row.",
    ...CUT_LIMITS,
    WRAPS_DEFINITE_FIRST_DRAFT,
  ];
  const OVERCLAIM_WRAPS_SYNONYMS = [
    "All wrapped cells are kept in their rows.",
    "Cells that wrap in every column are kept whole.",
    "Tables whose cells wrap always come through as a single Word table.",
    "A wrapped cell remains in its row.",
    "Tables with wrapped cells come through as a single Word table.",
    // PR-2, one per limit shape: each names every OTHER limit, so only its
    // own shape can catch it.
    "A wrapped cell on the same page is kept in its row under a column of figures only as a heading, and a line apart from its cell, as after OCR, only when set tight, though a note that tight may join it, a heading set above its row loses that line to the text below; two cells wrapping on the same line form a row of their own, a lone figure stays out, and a table whose wraps outnumber its rows comes through as lines of text.",
    "A wrapped cell on the same page remains in its row except in the first column, a line apart from its cell, as after OCR, only when set tight, though a note that tight may join it, a heading set above its row loses that line to the text below; two cells wrapping on the same line form a row of their own, a lone figure stays out, and a table whose wraps outnumber its rows comes through as lines of text.",
    "A wrapped cell on the same page stays in its row except in the first column and under a column of figures, though a note set tight under a row may join it, a heading set above its row loses that line to the text below; two cells wrapping on the same line form a row of their own, a lone figure stays out, and a table whose wraps outnumber its rows comes through as lines of text.",
    "A wrapped cell on the same page stays in its row except in the first column and under a column of figures, and a line apart from its cell, as after OCR, only when set tight, a heading set above its row loses that line to the text below; two cells wrapping on the same line form a row of their own, a lone figure stays out, and a table whose wraps outnumber its rows comes through as lines of text.",
    "Wrapped cells on the same page are kept in their rows except in the first column and under a column of figures, a line apart from its cell, as after OCR, only when set tight, though a note that tight may join it, a heading set above its row loses that line to the text below; a lone figure stays out, and a table whose wraps outnumber its rows comes through as lines of text.",
    "Wrapped cells on the same page stay in their rows except in the first column and under a column of figures, a line apart from its cell, as after OCR, only when set tight, though a note that tight may join it, a heading set above its row loses that line to the text below; two cells wrapping on the same line form a row of their own, and a table whose wraps outnumber its rows comes through as lines of text.",
    "Wrapped cells on the same page stay in their rows except in the first column and under a column of figures, a line apart from its cell, as after OCR, only when set tight, though a note that tight may join it, a heading set above its row loses that line to the text below; two cells wrapping on the same line form a row of their own, and a lone figure stays out.",
    // Review 2026-11-16: the heading set above its row; then a share-cap
    // clause silent about the table (the shape after the limit shapes).
    "Wrapped cells on the same page stay in their rows except in the first column and under a column of figures, a line apart from its cell, as after OCR, only when set tight, though a note that tight may join it; two cells wrapping on the same line form a row of their own, a lone figure stays out, and a table whose wraps outnumber its rows comes through as lines of text.",
    // Plain-copy ruling, 2026-11-16: the same page (every limit synonym
    // above gained "on the same page" that day, so each stays caught by its
    // own shape alone).
    "A wrapped cell stays in its row except in the first column and under a column of figures, a line apart from its cell, as after OCR, only when set tight, though a note that tight may join it, a heading set above its row loses that line to the text below; two cells wrapping on the same line form a row of their own, a lone figure stays out, and a table whose wraps outnumber its rows comes through as lines of text.",
    "A table with more wrapped lines than rows keeps none of them in its rows.",
  ];
  const denies = (t: string) =>
    Object.values(DENIES_WRAPS).some((re) => re.test(t));
  const overclaims = (t: string) =>
    Object.values(OVERCLAIMS_WRAPS).some((re) => re.test(t));
  /** One shape per stated limit, in CUT_LIMITS order. */
  const limitShapes = Object.entries(OVERCLAIMS_WRAPS).filter(([name]) =>
    name.startsWith("kept in its row, silent about"),
  );

  /**
   * DEFERRAL (plain-copy ruling, 2026-11-16). A sentence's limits are read
   * from its SCOPE: the sentence, plus the list it defers to. Two deferrals
   * are recognised, and only these:
   *  - "except in the layouts listed in the answer to \u201c<question>\u201d
   *    in the PDF to Word FAQ": the list in the answer of PDF to Word's FAQ
   *    entry whose question is exactly <question>. (Not "listed under": the
   *    UI-label guards read "under" + a quote as a control to press.)
   *  - "except in the layouts below", in a sentence of a PDF to Word FAQ
   *    answer: that answer's own list.
   * A list is the lead sentence ("... except in the layouts below") and the
   * sentences after it, up to the first that names another tool (where the
   * attribution itself stops reading sentences as PDF to Word's). Not the
   * whole answer: the tables answer also says "the note beside the download"
   * and "continues onto the next page", which would satisfy the note and
   * page shapes for a list that had lost both.
   * A deferral that resolves to no list (a question not on the page, an
   * entry with no lead, a "below" outside a PDF to Word FAQ answer) is
   * DANGLING: an offender in its own right, and its scope is the sentence
   * alone, which every limit shape catches. The shapes are unchanged: a
   * deferral widens what they READ, never what they accept.
   */
  const WORD_NAME = getToolBySlug(PDF_TO_WORD_TOOL)!.name;
  const WORD_NAME_RE = WORD_NAME.replace(/[.*+?^$|()[\]{}\\]/g, "\\$&");
  const DEFERS_TO_FAQ = new RegExp(
    `\\bexcept in the layouts listed in the answer to ${OPEN_QUOTE}([^${CLOSE_QUOTE}]+)${CLOSE_QUOTE} in the ${WORD_NAME_RE} FAQ\\b`,
  );
  const LIST_LEAD = /\bexcept in the layouts below\b/;
  type Faq = readonly { readonly question: string; readonly answer: string }[];
  const wordFaq = (): Faq => pageFaq(getToolBySlug(PDF_TO_WORD_TOOL)!);
  const otherToolNames = NAMES.filter((n) => n.slug !== PDF_TO_WORD_TOOL).map(
    (n) => n.name,
  );
  function listIn(answer: string): string | null {
    const sentences = sentencesOf(answer);
    const lead = sentences.findIndex((x) => LIST_LEAD.test(x));
    if (lead < 0) return null;
    const out = [sentences[lead]!];
    for (const x of sentences.slice(lead + 1)) {
      if (otherToolNames.some((name) => x.includes(name))) break;
      out.push(x);
    }
    return out.join(" ");
  }
  function scopeOf(
    sentence: string,
    ownText: string,
    faq: Faq,
  ): { scope: string; dangling: boolean } {
    const named = DEFERS_TO_FAQ.exec(sentence);
    if (named) {
      const entry = faq.find((e) => e.question === named[1]);
      const list = entry ? listIn(entry.answer) : null;
      return list
        ? { scope: `${sentence} ${list}`, dangling: false }
        : { scope: sentence, dangling: true };
    }
    if (LIST_LEAD.test(sentence)) {
      const list = faq.some((e) => e.answer === ownText)
        ? listIn(ownText)
        : null;
      return list
        ? { scope: list, dangling: false }
        : { scope: sentence, dangling: true };
    }
    return { scope: sentence, dangling: false };
  }
  const overclaimsIn = (sentence: string, ownText: string, faq: Faq) => {
    const { scope, dangling } = scopeOf(sentence, ownText, faq);
    return dangling || overclaims(scope);
  };
  /** The served FAQ answer a sentence sits in, else the sentence itself. */
  const ownTextOf = (sentence: string, faq: Faq) =>
    faq.find((e) => sentencesOf(e.answer).includes(sentence))?.answer ??
    sentence;

  it("both corpora, both ways: every shape catches a sentence, every sentence is caught, and the definite ones pass", () => {
    for (const [name, re] of Object.entries(DENIES_WRAPS))
      expect(
        [...SHIPPED, ...SYNONYMS].some((c) => re.test(c)),
        `${name} catches nothing shipped`,
      ).toBe(true);
    expect([...SHIPPED, ...SYNONYMS].filter((c) => !denies(c))).toEqual([]);
    expect(HONEST.filter(denies)).toEqual([]);
    for (const [name, re] of Object.entries(OVERCLAIMS_WRAPS))
      expect(
        [...OVERCLAIM_WRAPS_SHIPPED, ...OVERCLAIM_WRAPS_SYNONYMS].some((c) =>
          re.test(c),
        ),
        `${name} catches nothing`,
      ).toBe(true);
    expect(
      [...OVERCLAIM_WRAPS_SHIPPED, ...OVERCLAIM_WRAPS_SYNONYMS].filter(
        (c) => !overclaims(c),
      ),
    ).toEqual([]);
    // Since 2026-11-16 (plain-copy ruling) through the deferral: the short
    // sentence and the list's lead are honest only with the list they name.
    // Until then `HONEST.filter(overclaims)`.
    const faq = wordFaq();
    expect(
      HONEST.filter((c) => overclaimsIn(c, ownTextOf(c, faq), faq)),
    ).toEqual([]);
    // The retired one-sentence form stays honest standalone.
    expect(overclaims(WRAPS_DEFINITE_ONE_SENTENCE)).toBe(false);
    expect(denies(WRAPS_DEFINITE_ONE_SENTENCE)).toBe(false);
    // Each shipped denial is a denial and nothing else: not an overclaim.
    expect(SHIPPED.filter(overclaims)).toEqual([]);
    // PR-2: each limit shape is EXACTLY its limit. Health: nine cuts (eight
    // until the plain-copy ruling added the same page), each different from
    // the list; then shape i catches cut i, and no limit shape catches the
    // list itself or the retired one-sentence form.
    expect(limitShapes).toHaveLength(9);
    expect(CUT_LIMITS).toHaveLength(limitShapes.length);
    expect(new Set([WRAPS_LIST, ...CUT_LIMITS]).size).toBe(10);
    limitShapes.forEach(([name, re], i) => {
      expect(re.test(CUT_LIMITS[i]!), `${name} misses its cut`).toBe(true);
      expect(re.test(WRAPS_LIST), `${name} fires on the list`).toBe(false);
      expect(
        re.test(WRAPS_DEFINITE_ONE_SENTENCE),
        `${name} fires on the one-sentence form`,
      ).toBe(false);
    });
    // Review 2026-11-16: "each names every OTHER limit, so only its own
    // shape can catch it" was a comment. The limit synonyms are the nine
    // after the first five; synonym i is caught by limit shape i ALONE.
    const limitSynonyms = OVERCLAIM_WRAPS_SYNONYMS.slice(
      5,
      5 + limitShapes.length,
    );
    expect(limitSynonyms).toHaveLength(9);
    limitSynonyms.forEach((c, i) =>
      expect(
        limitShapes.filter(([, re]) => re.test(c)).map(([name]) => name),
        c,
      ).toEqual([limitShapes[i]![0]]),
    );
    // The share-cap shape: the definite sentence names the lines of text,
    // the first draft did not, and the limit cuts keep the honest clause.
    const shareCapTable =
      OVERCLAIMS_WRAPS[
        "a share-capped table, silent that its cells come through as lines of text"
      ]!;
    expect(shareCapTable.test(WRAPS_LIST)).toBe(false);
    expect(shareCapTable.test(WRAPS_DEFINITE_ONE_SENTENCE)).toBe(false);
    expect(shareCapTable.test(WRAPS_DEFINITE_FIRST_DRAFT)).toBe(true);
    expect(CUT_LIMITS.filter((c) => shareCapTable.test(c))).toEqual([]);
    // And the interim sentences, now SHIPPED, are each caught as denials by
    // the inverted shape itself, not only by an older one.
    const inverted =
      DENIES_WRAPS[
        "a wrapped table may come through whole, or as lines of text"
      ]!;
    expect(SHIPPED.slice(-5).filter((c) => !inverted.test(c))).toEqual([]);
  });

  it("a deferral to the FAQ covers the limits only when that FAQ entry exists and carries every limit", () => {
    const faq = wordFaq();
    const tables = faq.find((e) => e.question === WRAPS_TABLES_QUESTION);
    // Health: the entry is on the page, its list is exactly the four plain
    // sentences (not more of the answer, not fewer), and both deferrals
    // resolve to it.
    expect(tables, "the tables FAQ entry is not on the page").toBeDefined();
    expect(listIn(tables!.answer)).toBe(WRAPS_LIST);
    expect(scopeOf(WRAPS_SHORT, WRAPS_SHORT, faq)).toEqual({
      scope: `${WRAPS_SHORT} ${WRAPS_LIST}`,
      dangling: false,
    });
    expect(scopeOf(WRAPS_LIST_SENTENCES[0], tables!.answer, faq)).toEqual({
      scope: WRAPS_LIST,
      dangling: false,
    });
    // Positive control: read ALONE, every limit shape catches the short
    // sentence, and every one but the page's catches the lead (which names
    // the same page itself); the deferral is the only thing that clears them.
    expect(limitShapes.filter(([, re]) => !re.test(WRAPS_SHORT))).toEqual([]);
    expect(
      limitShapes
        .filter(([, re]) => !re.test(WRAPS_LIST_SENTENCES[0]))
        .map(([n]) => n),
    ).toEqual(["kept in its row, silent about the same page"]);
    expect(overclaimsIn(WRAPS_SHORT, WRAPS_SHORT, faq)).toBe(false);
    expect(overclaimsIn(WRAPS_LIST_SENTENCES[0], tables!.answer, faq)).toBe(
      false,
    );

    // Planted 1: a deferral to a question that is not on the page.
    const missing = WRAPS_SHORT.replace(
      WRAPS_TABLES_QUESTION,
      "How are tables handled?",
    );
    expect(missing).not.toBe(WRAPS_SHORT);
    expect(faq.some((e) => e.question === "How are tables handled?")).toBe(
      false,
    );
    expect(scopeOf(missing, missing, faq).dangling).toBe(true);
    expect(overclaimsIn(missing, missing, faq)).toBe(true);

    // Planted 2: a deferral to a question that IS on the page, whose answer
    // carries no list (derived: every other entry, here; health: one exists).
    const listless = faq.filter(
      (e) => e.question !== WRAPS_TABLES_QUESTION && listIn(e.answer) === null,
    );
    expect(listless.length).toBeGreaterThan(0);
    for (const entry of listless) {
      const elsewhere = WRAPS_SHORT.replace(
        WRAPS_TABLES_QUESTION,
        entry.question,
      );
      expect(scopeOf(elsewhere, elsewhere, faq).dangling, entry.question).toBe(
        true,
      );
      expect(overclaimsIn(elsewhere, elsewhere, faq)).toBe(true);
    }

    // Planted 3: the named entry exists and has a list that lost ONE limit.
    // Each cut, one at a time, through the short sentence AND through the
    // list's own lead, is caught by its own limit shape and no other.
    CUT_LIMITS.forEach((cut, i) => {
      const answer = tables!.answer.replace(WRAPS_LIST, cut);
      expect(answer, `cut ${i} did not land`).not.toBe(tables!.answer);
      const doctored: Faq = faq.map((e) =>
        e.question === WRAPS_TABLES_QUESTION ? { ...e, answer } : e,
      );
      const viaShort = scopeOf(WRAPS_SHORT, WRAPS_SHORT, doctored);
      const viaLead = scopeOf(sentencesOf(cut)[0]!, answer, doctored);
      for (const [via, read] of [
        ["short", viaShort],
        ["lead", viaLead],
      ] as const) {
        expect(read.dangling, `${via} ${i}`).toBe(false);
        expect(
          limitShapes.filter(([, re]) => re.test(read.scope)).map(([n]) => n),
          `${via}, cut ${i}`,
        ).toEqual([limitShapes[i]![0]]);
      }
      expect(overclaimsIn(WRAPS_SHORT, WRAPS_SHORT, doctored)).toBe(true);
    });

    // Planted 4: "below" outside a PDF to Word FAQ answer resolves to nothing.
    expect(scopeOf(WRAPS_LIST_SENTENCES[0], WRAPS_LIST, faq).dangling).toBe(
      true,
    );
  });

  async function offenders(test: (t: string) => boolean): Promise<string[]> {
    const out: string[] = [];
    for (const container of await containersFor(PDF_TO_WORD_TOOL))
      for (const { sentence, masked } of attributedTo(
        container,
        PDF_TO_WORD_TOOL,
      ))
        if (test(masked)) out.push(`${container.where}: ${sentence}`);
    return out;
  }
  /**
   * The overclaims served, each sentence read with the list it defers to.
   * Per text, so a "below" knows the answer it sits in; attribution per text
   * is the same as per container (it restarts at each text).
   */
  async function scopedOffenders(faq: Faq = wordFaq()): Promise<string[]> {
    const out: string[] = [];
    for (const container of await containersFor(PDF_TO_WORD_TOOL))
      for (const text of container.texts)
        for (const { sentence } of attributedTo(
          { ...container, texts: [text] },
          PDF_TO_WORD_TOOL,
        ))
          if (overclaimsIn(sentence, text, faq))
            out.push(`${container.where}: ${sentence}`);
    return out;
  }

  type Tbl = Extract<
    Awaited<ReturnType<typeof readDocxStructure>>["blocks"][number],
    { kind: "tbl" }
  >;
  const cell = (t: Tbl, r: number, c: number) =>
    (t.rows[r]?.cells[c]?.blocks ?? [])
      .flatMap((b) => (b.kind === "p" ? b.runs : []))
      .map((x) => x.text)
      .join("");
  const paragraphsIn = (t: Tbl, r: number, c: number) =>
    (t.rows[r]?.cells[c]?.blocks ?? []).filter((b) => b.kind === "p").length;
  /** The engine's tables for `pdf`, read through `extractFlow`. */
  async function tablesThrough(
    pdf: Uint8Array,
    extractFlow: Parameters<typeof runPdfOfficeExport>[2]["extractFlow"],
  ): Promise<Tbl[]> {
    const run = await runPdfOfficeExport(PDF_TO_WORD_TOOL, pdf, {
      extractFlow,
      scanPages: noPictures,
    });
    if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
    return (await readDocxStructure(run.output)).blocks.filter(
      (b): b is Tbl => b.kind === "tbl",
    );
  }
  const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

  it("the page denies wrapped cells only while the probe's export is not whole, and never overclaims while a first-column wrap is not", async () => {
    const {
      IMAGE_DOCX_TABLE_WRAPS_PROBE_BBOX,
      IMAGE_ACADEMIC_LABEL_WRAP_BBOX,
    } = await import("@/tests/poppler-samples-image");
    const p = DOCX_TABLE_WRAPS_PROBE;

    // S1, the probe page, on the IMAGE's poppler.
    const s1 = await tablesThrough(PDF_HEADER, async () =>
      flowText(parseBboxFlow(IMAGE_DOCX_TABLE_WRAPS_PROBE_BBOX)),
    );
    // Health: measured 2026-11-16, one table of 5 rows x 3 columns.
    expect(s1.map((t) => t.rows.length)).toEqual([5]);
    const whole =
      s1.length === 1 &&
      s1[0]!.gridCols.length === 3 &&
      cell(s1[0]!, 2, 1) === `${p.rows[2][1]} ${p.wraps[2].join(" ")}` &&
      cell(s1[0]!, 3, 1) === `${p.rows[3][1]} ${p.wraps[3].join(" ")}` &&
      paragraphsIn(s1[0]!, 2, 1) === 1 &&
      paragraphsIn(s1[0]!, 3, 1) === 1 &&
      cell(s1[0]!, 4, 2) === p.rows[4][2];
    expect(whole).toBe(true);
    const deniers = await offenders(denies);
    expect(
      deniers,
      whole
        ? "the probe's .docx keeps each wrapped cell in its row — no sentence may deny it"
        : "the probe's .docx is not whole — the page must say so",
    ).toEqual(whole ? [] : deniers.length ? deniers : ["(none)"]);

    // A labelled STAND-IN pin, beside the image's: the same page through
    // the stand-in extractor (`flowStandIn`) gives the same table.
    const standIn = await tablesThrough(
      await docxTableWrapsProbePdf(),
      flowStandIn,
    );
    expect(standIn.map((t) => t.rows.length)).toEqual([5]);

    // S6, a wrap in the FIRST column, on the image's poppler: the rows
    // above it are a table, the continuation and the rows below are not.
    const s6 = await tablesThrough(PDF_HEADER, async () =>
      flowText(parseBboxFlow(IMAGE_ACADEMIC_LABEL_WRAP_BBOX)),
    );
    // Health: measured 2026-11-16, one table of the 3 rows above the wrap.
    expect(s6.map((t) => t.rows.length)).toEqual([3]);
    const s6Whole = s6.length === 1 && s6[0]!.rows.length >= 5;
    expect(s6Whole).toBe(false);
    // Since 2026-11-16 (plain-copy ruling) read through the deferral, with
    // a dangling deferral an offender of its own; until then
    // `offenders(overclaims)`, sentence by sentence.
    if (!s6Whole) expect(await scopedOffenders()).toEqual([]);

    // Positive controls, through the same attribution the live check uses.
    const caught = attributedTo(
      { where: "control", home: PDF_TO_WORD_TOOL, texts: SHIPPED },
      PDF_TO_WORD_TOOL,
    ).filter(({ masked }) => denies(masked));
    expect(caught).toHaveLength(SHIPPED.length);
    const over = attributedTo(
      {
        where: "control",
        home: PDF_TO_WORD_TOOL,
        texts: OVERCLAIM_WRAPS_SHIPPED,
      },
      PDF_TO_WORD_TOOL,
    ).filter(({ masked }) => overclaims(masked));
    expect(over).toHaveLength(OVERCLAIM_WRAPS_SHIPPED.length);
    // And the interim sentences ARE on the page: the attribution reaches
    // each one (a rule over a set that lost them would pass vacuously).
    const served = (
      await Promise.all(
        (await containersFor(PDF_TO_WORD_TOOL)).map(async (c) =>
          attributedTo(c, PDF_TO_WORD_TOOL).map((a) => a.sentence),
        ),
      )
    ).flat();
    for (const sentence of HONEST)
      expect(served, `not served: ${sentence.slice(0, 60)}`).toContain(
        sentence,
      );
    // The short sentence is served wherever the one-sentence form was: the
    // intro and PDF_TO_WORD_KEEPS (the keep FAQ answer, the convert guide's
    // section and its look FAQ answer). Health: at least those four.
    expect(
      served.filter((x) => x === WRAPS_SHORT).length,
    ).toBeGreaterThanOrEqual(4);
    // And the scoped check is not blind: a container serving the short
    // sentence with a question not on the page is an offender through it.
    const plantedText = WRAPS_SHORT.replace(
      WRAPS_TABLES_QUESTION,
      "How are tables handled?",
    );
    const planted = attributedTo(
      { where: "control", home: PDF_TO_WORD_TOOL, texts: [plantedText] },
      PDF_TO_WORD_TOOL,
    ).filter(({ sentence }) => overclaimsIn(sentence, plantedText, wordFaq()));
    expect(planted).toHaveLength(1);
  }, 120_000);
});

/* ------------------------------------------------------------------ *
 *  Compare PDF marks the changes on the pages — a capability that EXISTS.
 * ------------------------------------------------------------------ */

/**
 * Compare PDF draws both PDFs side by side with the changes marked on their
 * pages (audit compare-pdf#2, S2, 2026-11-15). Until then the FAQ said "It
 * does not draw highlights on the pages themselves yet: the result is a list
 * of changed lines, not marked-up pages", and that was true.
 *
 * Shaped like COMPARE_PAGE_RULE, in both directions: the CLAIMS are allowed
 * only while the probe — the composed chain the page view runs (extract,
 * compare, the viewer's own open, its text, `placePage`) on the page-header
 * pair — places "100" as removed on page 2 of the first file AND "120" as
 * added on page 3 of the second; the DENIALS are false while it holds.
 *
 * The probe proves the chain, not delivery: the tool-page and guide label
 * guards and e2e/compare-viewer.spec.ts on a served build are where a reader
 * receiving it is proved.
 */
const COMPARE_ON_PAGE_RULE = {
  id: "Compare PDF marks the changes on both PDFs' pages",
  subjects: () => slugsOfKind("compare"),
  claims: {
    "changes on the pages": /\b(?:show|see) (?:the )?changes on the pages\b/i,
    "both side by side": /\bboth (?:files|PDFs) side by side\b/i,
    "crossed out on the pages": /\bcrossed out on\b[^.]*\bpages?\b/i,
  },
  shipped: [
    "Press Show changes on the pages to see both PDFs side by side, with removed text crossed out on the first file's pages and added text underlined on the second's; a changed line it cannot place on its page, or on a page with no selectable text, is flagged on that page and stays in the list of changes.",
    "See the changes on the pages",
    "Press Show changes on the pages to open both files side by side, removed words crossed out in the first and added words underlined in the second.",
    "Select Show changes on the pages to see both files side by side with the changes marked on the pages.",
  ],
  /** Served sentences these shapes must NOT read as the claim. */
  nonClaims: [
    "The Pages tile puts the two page counts side by side, first file → second",
  ],
  denials: {
    "does not draw highlights": /\bdoes(?: not|n't) draw highlights\b/i,
    "not marked-up pages": /\bnot marked-up pages\b/i,
  },
  denialCorpus: [
    "It does not draw highlights on the pages themselves yet: the result is a list of changed lines, not marked-up pages.",
  ],
} as const;

/** THE PROPERTY, through the composed chain on two real PDFs. */
async function compareOnPageProbe(): Promise<Probe> {
  const { left, right } = pageHeaderPair();
  const run = await runCompareViewChain(
    await compareLinesPdf(left),
    await compareLinesPdf(right),
  );
  const marked = (
    side: "left" | "right",
    page: number,
    kind: "removed" | "added",
    text: string,
  ) => {
    const p = run.pages.find((x) => x.side === side && x.page === page);
    return Boolean(
      p?.placement.lines.some((l) =>
        l.segments.some(
          (s) => s.kind === kind && rangeText(p.text, s.ranges).trim() === text,
        ),
      ),
    );
  };
  const removed = marked("left", 2, "removed", "100");
  const added = marked("right", 3, "added", "120");
  return {
    present: removed && added,
    evidence: `"100" removed on v1 page 2: ${removed}; "120" added on v2 page 3: ${added}`,
  };
}

/**
 * PDF to Word's TYPEFACE sentences, held to the engine (added 2026-11-15,
 * backlog #28 slice 4, heartbeat key `docxTypefaces`).
 *
 * Until that day every word opened in Word's default font and the page said
 * so ("The typeface … not carried across", "Typefaces and layout are not
 * recreated", "in Word's default typeface"). Since then a matched word in
 * the Latin alphabet is set in a font that comes with Windows or Office, of
 * the same kind as the PDF's (`../workers/pdf-office-export/typeface`), and
 * each of those sentences is a denial. Asked both ways, modelled on the
 * bold test above: the typefaces probe's PDF (Times, Courier, Helvetica) is
 * run through the engine and read back by `docx-structure.ts`; when its
 * words read back Times New Roman, Courier New and Arial, no sentence
 * attributed to PDF to Word may deny the typeface and one must claim it;
 * otherwise none may claim it and one must deny it. Both corpora run both
 * ways: every pattern catches a sentence, every sentence is caught by its
 * own side and by no other.
 */
describe("PDF to Word: the typeface sentences hold of the engine", () => {
  const DENIES_TYPEFACE: Record<string, RegExp> = {
    "the typeface is not carried":
      /\btypefaces?\b[^.;]{0,80}?\b(?:are|is) not (?:carried|recreated|rebuilt)\b/i,
    "the typeface stays behind": /\btypefaces?\b[^.;]{0,80}?\bstays? behind\b/i,
    "Word's default typeface": /\bin Word[’']s default typeface\b/i,
    "not its typeface": /\b(?:not its|without the original[’']s) typeface\b/i,
    // The 2026-10-17 to 2026-11-14 sentences of SHIPPED_STYLE that name
    // fonts: a list of fonts with colours, bold or sizes.
    "fonts listed with colours":
      /\bfonts, (?:bold|colou?rs|sizes)\b|\btables, fonts, colou?rs\b/i,
  };
  const CLAIMS_TYPEFACE: Record<string, RegExp> = {
    "set in a font that comes with Windows or Office":
      /\bset in (?:a font that comes|fonts that come) with Windows or Office\b/i,
    "in standard Office fonts": /\bin (?:a )?standard Office fonts?\b/i,
    "and Office fonts": /\band Office fonts\b/i,
  };
  /** Each one served as PDF to Word's until 2026-11-15. */
  const SHIPPED_TYPEFACE = [
    // The page's intro.
    "The typeface and drawings made of lines and shapes are not carried across, and text recognised by OCR comes through in Word's default style.",
    // The page's Track Changes use case.
    "Check the result against the original, since the converted text starts out without the original's typeface and layout.",
    // The page's look FAQ.
    "Words keep their bold, italics, size and colour where our reader matches them, and a table whose cells each fit on one line, with a column of figures, comes through as a Word table; the typeface, link targets and drawings made of lines and shapes stay behind, and the page's positions, indentation and spacing are not kept.",
    // PDF_TO_WORD_KEEPS.
    "Each word keeps its bold, italics, size and color where they can be matched; the typeface, drawings made of lines and shapes elsewhere on the page, and the page layout are not carried over.",
    // The convert guide.
    "The conversion carries the PDF's selectable text into Word as paragraphs in reading order, each word keeping its bold, italics, size and colour where they can be matched, so you edit the words instead of retyping them — the typeface and page layout are not rebuilt.",
    "Open the downloaded DOCX in Word and finish the formatting — the words arrive as paragraphs in reading order, with their bold, italics, sizes and colours where they could be matched, in Word's default typeface.",
    "Partly. It holds the PDF's words and pictures and each word's bold, italics, size and colour where they can be matched, not its typeface or layout.",
    // The Edit PDF guide's pointer.
    "The typeface and page layout are not recreated, and only a table whose cells each fit on one line, with a column of figures, comes through as a Word table, so it suits documents where the words matter more than the look.",
    // The catalogue description.
    "Typefaces and layout are not recreated; for a scan, tick “Recognise text in scans (OCR)”.",
    // From SHIPPED_STYLE above: the 2026-10-17 to 2026-11-14 sentences
    // that name fonts.
    "Fonts, bold and italics, colours and images are not carried across.",
    "Images, tables, fonts, colors and the page layout are not carried over, so the text arrives unstyled, ready to format in Word — not as a copy of the page.",
    "Fonts, bold and italics, colours, tables, and drawings made of lines and shapes are not carried across.",
    "Fonts, colours, tables, and drawings made of lines and shapes are not carried across, and bold or italics only where a whole paragraph is set in them, such as a heading.",
    "Tables, fonts, colors, drawings made of lines and shapes elsewhere on the page, and the page layout are not carried over, and bold or italics only where a whole paragraph is set in them, so the text arrives in Word's default style, ready to format — not as a copy of the page.",
    "The DOCX carries the words as plain paragraphs, with the pictures on lines of their own between them; fonts, sizes, colours, tables as tables, link targets and drawings made of lines and shapes stay behind.",
  ];
  /**
   * What the PDF to Word surfaces say since 2026-11-15. Until review round
   * 2 (the same day) five of these stated "of the same kind as the PDF's"
   * with no condition, and the intro said "by whether the PDF's font is
   * marked sans-serif, serif or monospaced"; they are kept as SHIPPED_FLAT
   * in the test below. Each now says the kind is a substitute's, and when
   * it can be told.
   */
  const HONEST_TYPEFACE = [
    "A word it matches is also set in a font that comes with Windows or Office, when our reader can tell which: the PDF's own font when it is one of those, such as Arial or Georgia, the one a free look-alike such as Liberation Sans or Carlito was drawn to match, and otherwise Arial, Times New Roman or Courier New, a substitute of the same kind as the PDF's font (sans-serif, serif or monospaced), judged by the font's name or by how the PDF marks it. A word whose font shows neither keeps Word's default font.",
    "Check the result against the original, since the converted text starts out in standard Office fonts and without the original's layout.",
    "Words are set in fonts that come with Windows or Office, a substitute of the same kind as the PDF's font (serif, sans-serif or monospaced) wherever its name or the PDF says which kind it is, and otherwise in Word's default font; the PDF's font files are not copied into the document.",
    "Each word keeps its bold, italics, size and color where they can be matched, and such a word in the Latin alphabet is set in a font that comes with Windows or Office, a substitute of the same kind as the PDF's font where our reader can tell its kind; drawings made of lines and shapes elsewhere on the page, and the page layout, are not carried over.",
    "The conversion carries the PDF's selectable text into Word as paragraphs in reading order, each word keeping its bold, italics, size and colour where they can be matched and set in a font that comes with Windows or Office, a substitute of the same kind as the PDF's where its kind can be told, so you edit the words instead of retyping them — the page layout is not rebuilt.",
    "Open the downloaded DOCX in Word and finish the formatting — the words arrive as paragraphs in reading order, with their bold, italics, sizes and colours where they could be matched, each set in a font that comes with Windows or Office, a substitute of the same kind as the PDF's where its kind can be told.",
    "Partly. It holds the PDF's words and pictures and each word's bold, italics, size and colour where they can be matched, in standard Office fonts, not its layout.",
    // Until 2026-11-16 (#28 slice 3, wraps) this said "only a table whose
    // cells each fit on one line, with a column of figures, comes through
    // as a Word table" — now a denial (the wrapped-cell describe above).
    // Until 2026-11-16 (#28 slice 3, wraps; PR-2) the parenthesis read
    // "(one whose cells wrap onto further lines may come through whole, in
    // part or as lines of text)" — now a denial (the wrapped-cell describe).
    "The page layout is not recreated, words are set in standard Office fonts, and only a table with at least three rows and a column of figures comes through as a Word table (a cell in it that wraps onto further lines may stay in its row or come through as a row or a line of its own, and in the table's first column the wrap ends the table), so it suits documents where the words matter more than the look.",
    "Turn PDF text and pictures into editable Word (DOCX) in reading order and Office fonts.",
  ];
  /**
   * TRUE, and deliberately caught by neither side: the scanned-PDF guide's
   * sentence about OCR text, which carries no font name (invisible words
   * label nothing, `docx-run-style.ts`). A pattern that caught it would
   * call a true sentence about scans a denial of typed text's typeface.
   */
  const ABOUT_SCANS = [
    "The look of the page is not rebuilt: fonts, columns and spacing are not carried over, and a line of the scan can arrive as a paragraph of its own, so expect to join some lines and style the headings yourself.",
  ];
  const denies = (t: string) =>
    Object.values(DENIES_TYPEFACE).some((re) => re.test(t));
  const claims = (t: string) =>
    Object.values(CLAIMS_TYPEFACE).some((re) => re.test(t));

  it("the shapes and the sentences cover each other, both ways", () => {
    for (const [name, re] of Object.entries(DENIES_TYPEFACE))
      expect(
        SHIPPED_TYPEFACE.some((s) => re.test(s)),
        `${name} catches nothing shipped`,
      ).toBe(true);
    for (const [name, re] of Object.entries(CLAIMS_TYPEFACE))
      expect(
        HONEST_TYPEFACE.some((s) => re.test(s)),
        `${name} catches nothing the page says`,
      ).toBe(true);
    expect(SHIPPED_TYPEFACE.filter((s) => !denies(s))).toEqual([]);
    expect(SHIPPED_TYPEFACE.filter(claims)).toEqual([]);
    expect(HONEST_TYPEFACE.filter((s) => !claims(s))).toEqual([]);
    expect(HONEST_TYPEFACE.filter(denies)).toEqual([]);
    expect(ABOUT_SCANS.filter((s) => denies(s) || claims(s))).toEqual([]);
  });

  it("every honest sentence is served, whole, on a PDF to Word surface", async () => {
    const all = (await containersFor(PDF_TO_WORD_TOOL))
      .flatMap((c) => c.texts)
      .join("\n");
    // Health: the corpus is the tool's surfaces, not nothing.
    expect(all.length).toBeGreaterThan(10_000);
    expect(HONEST_TYPEFACE.filter((s) => !all.includes(s))).toEqual([]);
  });

  /*
   * Added 2026-11-15, review round 2. "Of the same kind as the PDF's" is
   * true only where the kind can be told (`docxKindOf`): a face with no
   * kind in its name or its marks takes no font. Every served sentence
   * that promises the kind must carry that condition. SHIPPED_FLAT holds
   * the five sentences that stated it flatly on the branch before round 2.
   */
  it("every PDF to Word sentence promising a font of the same kind says when the kind can be told", async () => {
    const SAME_KIND = /\bsame kind as the PDF[’']s\b/i;
    const CONDITION =
      /\b(?:where(?:ver)? (?:its|our reader|the PDF says)|when our reader can tell|judged by the font[’']s name)\b/i;
    const SHIPPED_FLAT = [
      "Each word it matches is also set in a font that comes with Windows or Office: the PDF's own font when it is one of those, such as Arial or Georgia, the one a free look-alike such as Liberation Sans or Carlito was drawn to match, and otherwise Arial, Times New Roman or Courier New, of the same kind as the PDF's font.",
      "Words are set in fonts that come with Windows or Office, of the same kind as the PDF's (serif, sans-serif or monospaced), and the PDF's font files are not copied into the document.",
      "Each word keeps its bold, italics, size and color where they can be matched, and such a word in the Latin alphabet is set in a font that comes with Windows or Office, of the same kind as the PDF's; drawings made of lines and shapes elsewhere on the page, and the page layout, are not carried over.",
      "The conversion carries the PDF's selectable text into Word as paragraphs in reading order, each word keeping its bold, italics, size and colour where they can be matched and set in a standard Office font of the same kind as the PDF's, so you edit the words instead of retyping them — the page layout is not rebuilt.",
      "Open the downloaded DOCX in Word and finish the formatting — the words arrive as paragraphs in reading order, with their bold, italics, sizes and colours where they could be matched, each in a standard Office font of the same kind as the PDF's.",
    ];
    const flat = (s: string) => SAME_KIND.test(s) && !CONDITION.test(s);
    // Positive control: each flat sentence is caught.
    expect(SHIPPED_FLAT.filter((s) => !flat(s))).toEqual([]);
    const served: string[] = [];
    for (const container of await containersFor(PDF_TO_WORD_TOOL))
      for (const { sentence } of attributedTo(container, PDF_TO_WORD_TOOL))
        if (SAME_KIND.test(sentence)) served.push(sentence);
    // Health: the promise is made, so the check has subjects.
    expect(served.length).toBeGreaterThanOrEqual(3);
    expect(served.filter(flat)).toEqual([]);
    // Each condition the pattern names is used by a served sentence.
    expect(served.every((s) => CONDITION.test(s))).toBe(true);
  });

  it("the page claims the typeface exactly when the probe's words read back in Office faces of their kind", async () => {
    const pdf = await docxTypefacesProbePdf();
    const run = await runPdfOfficeExport(PDF_TO_WORD_TOOL, pdf, {
      extractFlow: flowStandIn,
      scanPages: scanPdfPages,
    });
    if (!run.ok) throw new Error(run.message);
    const runs = (await readDocxStructure(run.output)).blocks.flatMap((b) =>
      b.kind === "p" ? b.runs : [],
    );
    // Health: the probe's text is in the document.
    expect(runs.map((r) => r.text).join(" ")).toContain("Courier");
    const want = [
      [DOCX_TYPEFACES_PROBE.serif, "Times New Roman"],
      [DOCX_TYPEFACES_PROBE.mono, "Courier New"],
      [DOCX_TYPEFACES_PROBE.sans, "Arial"],
    ] as const;
    const probeSet = want.every(([line, family]) =>
      line
        .split(" ")
        .every((w) =>
          runs.some(
            (r) =>
              r.text.split(/\s+/).includes(w) &&
              r.fonts === family &&
              r.fontsHAnsi === family &&
              r.fontsCs === family,
          ),
        ),
    );
    /*
     * Added 2026-11-15, review round 2. The probe is three standard-14
     * fonts, whose kind the alias table fixes, so it certified the table
     * and never the kind of a face Word does not know — which was pdf.js's
     * flag-based guess, and Arial for pdfTeX's CMR10 and CMTT10 (/Flags 4).
     * "Of the same kind" is a claim about THOSE faces too, so it holds only
     * when each of these reads back as the page says: CMR10 in Times New
     * Roman, CMTT10 in Courier New, and a face with no kind in its name or
     * its marks in NO font (the page's "otherwise Word's default font").
     */
    const { embeddedFacePdf } = await import("@/tests/pdf-office-fixtures");
    const KIND_TEXT = "Kind control şeker words";
    const kindControls = [
      ["ABCDEF+CMR10", "serif", "Times New Roman"],
      ["ABCDEF+CMTT10", "mono", "Courier New"],
      ["ABCDEF+Qwerty", "serif", undefined],
    ] as const;
    const kindsHold: string[] = [];
    for (const [name, kind, family] of kindControls) {
      const control = await runPdfOfficeExport(
        PDF_TO_WORD_TOOL,
        await embeddedFacePdf(KIND_TEXT, kind, name),
        { extractFlow: flowStandIn, scanPages: scanPdfPages },
      );
      if (!control.ok) throw new Error(control.message);
      const read = (await readDocxStructure(control.output)).blocks.flatMap(
        (b) => (b.kind === "p" ? b.runs : []),
      );
      const words = KIND_TEXT.split(" ");
      const held = words.every((w) =>
        read.some(
          (r) =>
            r.text.split(/\s+/).includes(w) &&
            r.fonts === family &&
            r.fontsHAnsi === family &&
            r.fontsCs === family,
        ),
      );
      if (held) kindsHold.push(name);
    }
    const set = probeSet && kindsHold.length === kindControls.length;
    // The probe and the controls agree on this tree; a split would be a
    // copy question the two branches below cannot settle.
    expect(kindsHold.length === kindControls.length, kindsHold.join()).toBe(
      probeSet,
    );
    const denying: string[] = [];
    const claiming: string[] = [];
    for (const container of await containersFor(PDF_TO_WORD_TOOL))
      for (const { sentence, masked } of attributedTo(
        container,
        PDF_TO_WORD_TOOL,
      )) {
        if (denies(masked)) denying.push(`${container.where}: ${sentence}`);
        if (claims(masked)) claiming.push(`${container.where}: ${sentence}`);
      }
    if (set) {
      expect(
        denying,
        "the words read back in Office faces of their kind — the page may not deny the typeface",
      ).toEqual([]);
      expect(claiming.length, "and the page says so").toBeGreaterThan(0);
    } else {
      expect(
        claiming,
        "the words do not read back in Office faces of their kind — the page may not claim it",
      ).toEqual([]);
      expect(denying.length, "and the page must say so").toBeGreaterThan(0);
    }
    // Positive controls, through the attribution the live check uses.
    expect(
      attributedTo(
        { where: "control", home: PDF_TO_WORD_TOOL, texts: SHIPPED_TYPEFACE },
        PDF_TO_WORD_TOOL,
      ).filter(({ masked }) => denies(masked)),
    ).toHaveLength(SHIPPED_TYPEFACE.length);
    expect(
      attributedTo(
        { where: "control", home: PDF_TO_WORD_TOOL, texts: HONEST_TYPEFACE },
        PDF_TO_WORD_TOOL,
      ).filter(({ masked }) => claims(masked)),
    ).toHaveLength(HONEST_TYPEFACE.length);
  }, 60_000);

  it("“a font that comes with Windows or Office” is exactly the set Word is given: every family named is one, never a symbol face", async () => {
    const families = [
      ...OFFICE_METRIC_CLONES.flatMap((c) => [c.office, c.clone]),
      "DejaVu Sans",
      "DejaVu Serif",
      "DejaVu Sans Mono",
      "Noto Sans",
      "Noto Serif",
      "Noto Sans Mono",
      "Georgia",
      "Helvetica",
      "Times",
      "Courier",
      "Some Unknown Grotesk",
      "Symbol",
      "ZapfDingbats",
      "Wingdings",
    ];
    const named = families.flatMap((family) =>
      (["sans", "serif", "mono"] as const).map((fontClass) =>
        docxTypefaceOf({ family, fontClass, text: "Abc", invisible: false }),
      ),
    );
    const SYMBOL_FACES = new Set([
      "Symbol",
      "Wingdings",
      "Wingdings 2",
      "Wingdings 3",
      "Webdings",
    ]);
    // Health: both answers occur.
    expect(named.filter((n) => n === null).length).toBeGreaterThan(0);
    expect(named.filter((n) => n !== null).length).toBeGreaterThan(30);
    expect(
      named.filter(
        (n) => n !== null && (!WINDOWS_OR_OFFICE.has(n) || SYMBOL_FACES.has(n)),
      ),
      "Word is asked for a font Windows or Office does not ship, or a symbol face",
    ).toEqual([]);
    for (const family of ["Symbol", "ZapfDingbats", "Wingdings"])
      expect(
        docxTypefaceOf({
          family,
          fontClass: "sans",
          text: "a",
          invisible: false,
        }),
        family,
      ).toBeNull();
    const text = (await containersFor(PDF_TO_WORD_TOOL))
      .flatMap((c) => c.texts)
      .join("\n");
    expect(text).toMatch(/comes with Windows or Office/);
    expect(text).toMatch(/Arial, Times New Roman or Courier New/);
  });
});

/* ------------------------------------------------------------------ *
 *  Compare PDF overlays the pages — a capability that EXISTS.
 * ------------------------------------------------------------------ */

/**
 * Compare PDF lays each page of the second file over the same page of the
 * first and marks where the ink differs (audit compare-pdf#3, S3,
 * 2026-11-15). Until then the overview said "This is a text comparison,
 * not a visual one: a moved image or a changed colour will not appear",
 * and the guide "this is a text comparison, not a visual one". Both were
 * true.
 *
 * Shaped like COMPARE_ON_PAGE_RULE, in both directions: the CLAIMS are
 * allowed only while the probe — the Overlay's chain (`capturePairs`
 * through `capturePdfPages`, pdf.js drawing both pages) on two real PDFs
 * whose text is the same — finds at least one region where one has a
 * stamp, AND none on two separate saves of the same page (so a probe that
 * marks everything cannot pass); the DENIALS are false while it holds.
 * Delivery to a reader is e2e/compare-overlay.spec.ts on a served build.
 */
const COMPARE_OVERLAY_RULE = {
  id: "Compare PDF overlays the pages",
  subjects: () => slugsOfKind("compare"),
  claims: {
    "overlay the pages": /\boverlay(?:s|ing)? (?:the )?pages\b/i,
    "compare pages visually": /\bcompare (?:the )?pages visually\b/i,
    "a moved image shows": /\bmoved image\b[^.]*\bshows there\b/i,
    // Review r1, 2026-11-15: a pale stamp or watermark was NOT seen (no
    // pixel changed by more than 48 of 255) until the area test. The probe
    // below now draws one, so this claim is held to it.
    "a pale watermark shows": /\bpale watermark\b[^.]*\bshows there\b/i,
  },
  shipped: [
    "Overlay pages lays each page of the second file over the page with the same number in the first, in grayscale, and marks where the ink differs: a moved image, a stamp, a pale watermark or a shifted layout shows there.",
    "Compare two PDFs in your browser: changed lines of text, page counts and sizes, plus a visual check that overlays the pages and marks where ink differs, scans too.",
    "Press Overlay pages to lay a page of the second file over the page with the same number in the first.",
    "Their pages can still be compared without OCR: Compare pages visually lays one scan over the other in your browser and marks where the ink differs.",
    "The list of changes cannot say which; Overlay pages shows where on the page.",
  ],
  /** Served sentences these shapes must NOT read as the claim. */
  nonClaims: [
    "Pages are paired by number, so one inserted page makes every later pair differ.",
  ],
  denials: {
    "a text comparison, not a visual one":
      /\ba text comparison, not a visual one\b/i,
    "a moved image will not appear": /\bmoved image\b[^.]*\bwill not appear\b/i,
    // Review r1, 2026-11-15: served beside the overlay after it shipped,
    // on the catalogue line, the scan FAQ and the guide. Scans' PAGES are
    // compared without OCR; only their text needs it ("its text needs OCR
    // first" is not caught: the shape asks for scans needing it).
    "scans need OCR first":
      /\b(?:scans|scanned (?:pages|PDFs)) needs? OCR first\b/i,
    "reads selectable text only": /\breads selectable text only\b/i,
  },
  denialCorpus: [
    "This is a text comparison, not a visual one: a moved image or a changed colour will not appear, and a new font or margin shows up only where it makes the text wrap differently.",
    "Formatting, images, colors and layout are not compared — this is a text comparison, not a visual one.",
    "Compare two PDFs in your browser by page count, file size, and selectable text. Scanned pages need OCR first; this is not a pixel-perfect visual diff.",
    "Compare two versions of a PDF in your browser: page count, file size and every added or removed line of text, with a downloadable report. Scans need OCR first.",
    "Scanned PDFs need OCR first",
    "This tool reads selectable text only.",
  ],
} as const;

/** THE PROPERTY, through the Overlay's chain on real PDFs. */
async function compareOverlayProbe(): Promise<Probe> {
  const page = (stamp: boolean) =>
    compareLinesPdf([compareBody("overlay")]).then(async (bytes) => {
      if (!stamp) return bytes;
      const doc = await PDFDocument.load(bytes);
      doc.getPage(0).drawRectangle({ x: 380, y: 300, width: 160, height: 70 });
      return doc.save();
    });
  const stamped = await overlayFirstPage(await page(false), await page(true));
  const same = await overlayFirstPage(await page(false), await page(false));
  // A pale watermark: a 0.85 grey block, under the per-pixel tolerance.
  const pale = await compareLinesPdf([compareBody("overlay")]).then(
    async (bytes) => {
      const doc = await PDFDocument.load(bytes);
      doc.getPage(0).drawRectangle({
        x: 120,
        y: 200,
        width: 300,
        height: 90,
        color: rgb(0.85, 0.85, 0.85),
      });
      return doc.save();
    },
  );
  const watermarked = await overlayFirstPage(await page(false), pale);
  const sees = stamped.diff.regions.length >= 1;
  const seesPale = watermarked.diff.regions.length >= 1;
  const quiet = same.diff.regions.length === 0;
  return {
    present: sees && seesPale && quiet,
    evidence: `stamp: ${stamped.diff.regions.length} regions; pale watermark: ${watermarked.diff.regions.length}; same page saved twice: ${same.diff.regions.length}`,
  };
}

describe("Compare PDF: the overlay claims hold of the overlay", () => {
  const asRule = (shapes: Readonly<Record<string, RegExp>>) =>
    ({ shapes }) as unknown as ClaimRule;
  const claimShapes = Object.entries(COMPARE_OVERLAY_RULE.claims);
  const denialShapes = Object.entries(COMPARE_OVERLAY_RULE.denials);

  it("the shapes and both corpora cover each other, and the non-claims stay out", () => {
    const { shipped, denialCorpus, nonClaims } = COMPARE_OVERLAY_RULE;
    expect(
      claimShapes
        .filter(([, re]) => !shipped.some((c) => re.test(c)))
        .map(([n]) => n),
      "claim shapes nothing exercises",
    ).toEqual([]);
    expect(
      shipped.filter((c) => !claimShapes.some(([, re]) => re.test(c))),
      "claims no shape catches",
    ).toEqual([]);
    expect(
      denialShapes
        .filter(([, re]) => !denialCorpus.some((c) => re.test(c)))
        .map(([n]) => n),
      "denial shapes nothing exercises",
    ).toEqual([]);
    expect(
      denialCorpus.filter((c) => !denialShapes.some(([, re]) => re.test(c))),
      "denials no shape catches",
    ).toEqual([]);
    expect(
      [...nonClaims, ...denialCorpus].filter((c) =>
        claimShapes.some(([, re]) => re.test(c)),
      ),
      "a non-claim or a denial read as the claim",
    ).toEqual([]);
    expect(
      shipped.filter((c) => denialShapes.some(([, re]) => re.test(c))),
    ).toEqual([]);
  });

  it("the shipped corpus and the non-claim control are served", async () => {
    const subject = COMPARE_OVERLAY_RULE.subjects()[0]!;
    const served = (await containersFor(subject)).flatMap((c) =>
      attributedTo(c, subject).map(({ sentence }) => sentence),
    );
    for (const n of [
      ...COMPARE_OVERLAY_RULE.nonClaims,
      ...COMPARE_OVERLAY_RULE.shipped,
    ])
      expect(
        served.some((s) => s.includes(n.slice(0, 40))),
        n,
      ).toBe(true);
  });

  it("the capability is there: a stamp is seen and a page saved twice is not, from real PDFs", async () => {
    const probe = await compareOverlayProbe();
    expect(probe.present, probe.evidence).toBe(true);
  }, 60_000);

  it("served copy claims the overlay only while it is true, and never denies it while it is", async () => {
    const probe = await compareOverlayProbe();
    const subjects = COMPARE_OVERLAY_RULE.subjects();
    expect(subjects.length).toBeGreaterThan(0);
    for (const subject of subjects) {
      const made = await offendersOf(
        asRule(COMPARE_OVERLAY_RULE.claims),
        subject,
      );
      const denied = await offendersOf(
        asRule(COMPARE_OVERLAY_RULE.denials),
        subject,
      );
      expect(made.seen, `${subject}: corpus collapsed`).toBeGreaterThanOrEqual(
        15,
      );
      if (!probe.present) {
        expect(
          made.offenders,
          `${subject} claims an overlay that no longer sees anything (${probe.evidence})`,
        ).toEqual([]);
        continue;
      }
      // Health: the page does make the claim, so this check is not blind.
      expect(made.offenders.length, subject).toBeGreaterThanOrEqual(1);
      expect(
        denied.offenders,
        `${subject} denies what the overlay does`,
      ).toEqual([]);
    }
  }, 60_000);
});

/* ------------------------------------------------------------------ *
 *  Compare PDF's HTML redline — a capability that EXISTS, pinned.
 * ------------------------------------------------------------------ */

/**
 * Compare PDF writes an HTML redline (S4, 2026-11-15): the changes as a
 * self-contained web page, beside the .txt. The page says so, and says the
 * file runs no scripts. Part 4 of the compare claims.
 *
 * Shaped like COMPARE_OVERLAY_RULE, claims only: the CLAIMS are allowed only
 * while the probe — `compareExtractedPdfText` on two real PDFs where a page
 * was inserted, then `buildRedlineHtml`, then a parse of the HTML the way a
 * browser reads it — finds a <del>, an <ins>, a page-headed <h3>, the CSP
 * meta, and no <script>. If the redline goes (or comes back empty), every
 * served claim becomes an offender. That the file a reader downloads is
 * this one is e2e/compare-redline.spec.ts, on a served build.
 */
const COMPARE_REDLINE_RULE = {
  id: "Compare PDF writes an HTML redline that runs no scripts",
  subjects: () => slugsOfKind("compare"),
  claims: {
    "HTML redline": /\bHTML redline\b/i,
    redline: /\bredline\b/i,
    "the .html name": /-comparison\.html\b/i,
    "runs no scripts": /\bruns no (?:scripts|code)\b/i,
  },
  shipped: [
    "Compare two PDFs: see added and removed lines, page and size changes, or overlay the pages, and save a text or HTML redline.",
    "Download redline (HTML) saves the same changes as a web page, removed words struck through and added ones underlined, for example draft-vs-final-comparison.html.",
    "It opens in any browser, offline, and runs no scripts.",
    // The plan's own FAQ, folded into the upload FAQ (six-FAQ budget); its
    // question is not a served sentence (questions are not attributed).
    "No, nothing is uploaded: both files are opened and compared by your browser on your own device, and the report and the redline are made there too.",
    "The redline holds the changed lines of both files, with up to two unchanged lines around each change, and both file names, so anyone you send it to can read those.",
    "Compare two PDF versions in your browser: page count, file size and every changed line, as text or an HTML redline, or overlay the pages to see where ink differs.",
    "It loads nothing from the internet and runs no code.",
    "Each change is headed with the page it sits on in each file, for example Page 2 → page 3 when a page was inserted before it, the downloaded report heads it the same way, @@ Page 2 -> page 3 @@, and the HTML redline heads it Page 2 → page 3.",
    "Download the comparison report, a .txt file listing only the changes with their page numbers, or Download redline (HTML) for the same changes as a web page.",
    "You get their page counts, the size difference and every line of text that was added or removed, each under the page it sits on in both files, plus a text report and an HTML redline to download.",
  ],
  synonyms: ["Save a redline of the changes as an HTML page."],
} as const;

/** THE PROPERTY, on two real PDFs, read as a browser reads the file. */
async function compareRedlineProbe(): Promise<Probe> {
  const { left, right } = pageHeaderPair();
  const result = compareExtractedPdfText(
    await comparablePdf("v1.pdf", left),
    await comparablePdf("v2.pdf", right),
  );
  const html = buildRedlineHtml(result);
  const page = (new JSDOM(html).window as unknown as Window).document;
  const del = page.querySelectorAll("del").length;
  const ins = page.querySelectorAll("ins").length;
  const header = [...page.querySelectorAll("h3")].some(
    (h) => h.textContent === "Page 2 → page 3",
  );
  const csp =
    page
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute("content") === REDLINE_CSP;
  const scripts = page.querySelectorAll("script").length;
  return {
    present: del > 0 && ins > 0 && header && csp && scripts === 0,
    evidence: `${html.length} chars; del ${del}, ins ${ins}, page header ${header}, CSP ${csp}, scripts ${scripts}`,
  };
}

describe("Compare PDF: the redline claims hold of the redline", () => {
  const asRule = (shapes: Readonly<Record<string, RegExp>>) =>
    ({ shapes }) as unknown as ClaimRule;
  const claimShapes = Object.entries(COMPARE_REDLINE_RULE.claims);
  const claims = [
    ...COMPARE_REDLINE_RULE.shipped,
    ...COMPARE_REDLINE_RULE.synonyms,
  ];

  it("the shapes and the corpus cover each other", () => {
    expect(
      claimShapes
        .filter(
          ([, re]) => !COMPARE_REDLINE_RULE.shipped.some((c) => re.test(c)),
        )
        .map(([n]) => n),
      "claim shapes no shipped sentence exercises",
    ).toEqual([]);
    expect(
      claims.filter((c) => !claimShapes.some(([, re]) => re.test(c))),
      "claims no shape catches",
    ).toEqual([]);
  });

  it("the shipped corpus is served", async () => {
    const subject = COMPARE_REDLINE_RULE.subjects()[0]!;
    const served = (await containersFor(subject)).flatMap((c) =>
      attributedTo(c, subject).map(({ sentence }) => sentence),
    );
    for (const n of COMPARE_REDLINE_RULE.shipped)
      expect(
        served.some((s) => s.includes(n.slice(0, 40))),
        n,
      ).toBe(true);
  });

  it("the capability is there: del, ins, a page header, the CSP and no script, from real PDFs", async () => {
    const probe = await compareRedlineProbe();
    expect(probe.present, probe.evidence).toBe(true);
  });

  it("served copy claims the redline only while it is true", async () => {
    const probe = await compareRedlineProbe();
    const subjects = COMPARE_REDLINE_RULE.subjects();
    expect(subjects.length).toBeGreaterThan(0);
    for (const subject of subjects) {
      const made = await offendersOf(
        asRule(COMPARE_REDLINE_RULE.claims),
        subject,
      );
      expect(made.seen, `${subject}: corpus collapsed`).toBeGreaterThanOrEqual(
        15,
      );
      if (!probe.present) {
        expect(
          made.offenders,
          `${subject} claims a redline the comparison no longer writes (${probe.evidence})`,
        ).toEqual([]);
        continue;
      }
      // Health: the page does make the claim, so this check is not blind.
      expect(made.offenders.length, subject).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("Compare PDF: the page-view claims hold of the page view", () => {
  const asRule = (shapes: Readonly<Record<string, RegExp>>) =>
    ({ shapes }) as unknown as ClaimRule;
  const claimShapes = Object.entries(COMPARE_ON_PAGE_RULE.claims);
  const denialShapes = Object.entries(COMPARE_ON_PAGE_RULE.denials);

  it("the shapes and both corpora cover each other, and the non-claims stay out", () => {
    const { shipped, denialCorpus, nonClaims } = COMPARE_ON_PAGE_RULE;
    expect(
      claimShapes
        .filter(([, re]) => !shipped.some((c) => re.test(c)))
        .map(([n]) => n),
      "claim shapes nothing exercises",
    ).toEqual([]);
    expect(
      shipped.filter((c) => !claimShapes.some(([, re]) => re.test(c))),
      "claims no shape catches",
    ).toEqual([]);
    expect(
      denialShapes
        .filter(([, re]) => !denialCorpus.some((c) => re.test(c)))
        .map(([n]) => n),
      "denial shapes nothing exercises",
    ).toEqual([]);
    expect(
      denialCorpus.filter((c) => !denialShapes.some(([, re]) => re.test(c))),
      "denials no shape catches",
    ).toEqual([]);
    expect(
      [...nonClaims, ...denialCorpus].filter((c) =>
        claimShapes.some(([, re]) => re.test(c)),
      ),
      "a non-claim or a denial read as the claim",
    ).toEqual([]);
    expect(
      shipped.filter((c) => denialShapes.some(([, re]) => re.test(c))),
    ).toEqual([]);
  });

  it("the non-claim control is served, so the anchoring is tested on real copy", async () => {
    const subject = COMPARE_ON_PAGE_RULE.subjects()[0]!;
    const served = (await containersFor(subject)).flatMap((c) =>
      attributedTo(c, subject).map(({ sentence }) => sentence),
    );
    for (const n of COMPARE_ON_PAGE_RULE.nonClaims)
      expect(served.some((s) => s.includes(n.slice(0, 40)))).toBe(true);
  });

  it("the capability is there: marks placed on both files' pages, from real PDFs", async () => {
    const probe = await compareOnPageProbe();
    expect(probe.present, probe.evidence).toBe(true);
  }, 60_000);

  it("served copy claims the page view only while it is true, and never denies it while it is", async () => {
    const probe = await compareOnPageProbe();
    const subjects = COMPARE_ON_PAGE_RULE.subjects();
    expect(subjects.length).toBeGreaterThan(0);
    for (const subject of subjects) {
      const made = await offendersOf(
        asRule(COMPARE_ON_PAGE_RULE.claims),
        subject,
      );
      const denied = await offendersOf(
        asRule(COMPARE_ON_PAGE_RULE.denials),
        subject,
      );
      expect(made.seen, `${subject}: corpus collapsed`).toBeGreaterThanOrEqual(
        15,
      );
      if (!probe.present) {
        expect(
          made.offenders,
          `${subject} claims a page view that no longer marks anything (${probe.evidence})`,
        ).toEqual([]);
        continue;
      }
      // Health: the page does make the claim, so this check is not blind.
      expect(made.offenders.length, subject).toBeGreaterThanOrEqual(1);
      expect(
        denied.offenders,
        `${subject} denies what the page view does`,
      ).toEqual([]);
    }
  }, 60_000);
});

/* ------------------------------------------------------------------ *
 *  Translate PDF's retired "ZIP only" sentences (audit #29 slice 2).
 * ------------------------------------------------------------------ */

/**
 * Until 2026-11-15 every Translate PDF surface said the output was Markdown
 * and plain text and NOT a PDF: "No PDF comes back", "not a rebuilt PDF",
 * "rather than a re-laid-out PDF", and a meta description whose whole output
 * claim was "Get Markdown and plain text in a ZIP." Slice 1 made the worker
 * print a reflowed PDF of the translation for the languages it proves
 * (`translatePdfLanguages`); slice 2 flipped the copy, and this rule keeps the
 * retired shapes out of every served sentence about the tool.
 *
 * The property: a reflowed PDF EXISTS for some target languages, so no served
 * sentence may deny one or name the ZIP's contents as the whole output. It is
 * not "this job gets a PDF" — that is the panel's, from the live heartbeat;
 * which languages the copy may name is `translate-pdf-coverage.test.ts`.
 *
 * Rule 1, both directions: every shape catches a shipped sentence below, and
 * every shipped sentence is caught. The corpus is the copy as it shipped, kept
 * verbatim and dated; the "whole output" shape refuses only a sentence with no
 * PDF after the claim, so the replacement ("… in a ZIP, with a reflowed PDF of
 * the same text …") is not caught while the retired one is.
 */
const TRANSLATE_ZIP_ONLY_RULE = {
  subject: "translate-pdf",
  shapes: {
    "no PDF comes back": /\bno PDF (?:comes|is) (?:back|returned)\b/i,
    "not a rebuilt PDF": /\bnot a (?:rebuilt|re-?laid-?out|reflowed) PDF\b/i,
    "rather than a re-laid-out PDF":
      /\brather than a (?:rebuilt|re-?laid-?out|reflowed) PDF\b/i,
    "does not produce a PDF":
      /\b(?:does not|doesn['’]t|never|will not|won['’]t) (?:produce|return|make|give you)\b[^.;]{0,24}\bPDF\b/i,
    // The NOUN shape, not a verb list (review r1, 2026-11-16). The verb list
    // `get|returns? it as|download the result —` passed the catalogue's
    // "packaged as translated Markdown and plain text." on the tool page's
    // "About this tool" and its JSON-LD while this rule reported it covered.
    // A sentence naming the text formats with no PDF after them is the
    // retired claim, whatever verb carries it.
    "the text alone as the whole output":
      /(?:\bMarkdown and plain[- ]text\b|\ba Markdown file and a plain-text file\b)(?![^.]*\bPDF\b)/i,
  },
  // Shipped until 2026-11-15, verbatim, each from the surface named.
  shipped: [
    // tool FAQ "Will the translated PDF keep the original layout?" (until slice 1)
    "No PDF comes back: you get Markdown and plain text, without the original's fonts, columns, images or page positions.",
    // tool intro[0]
    "You get a ZIP such as lease-translation.zip holding translation.md, translation.txt, a README and a manifest naming the model and languages: translated text, not a rebuilt PDF, so fonts, columns and images are not recreated.",
    // tool metaDescription (also the SSR baseline's description)
    "Get Markdown and plain text in a ZIP.",
    // guide description (also the SSR baseline's)
    "Get Markdown and plain text back; our secure server wipes inputs at job end.",
    // guide intro[0]
    "AI translates the PDF's selectable text and returns it as translated Markdown and plain text, ready to download.",
    // guide intro[2]
    "The output is the document's words in the new language, packaged as Markdown and plain text rather than a re-laid-out PDF.",
    // guide steps[5]
    "Download the result — translated Markdown and plain text, packaged together.",
    // guide "What you get back"
    "Translate PDF outputs a Markdown file and a plain-text file, delivered together as a single ZIP.",
    "What it does not produce is a re-laid-out PDF.",
    // guide FAQ "Will the translation look like the original PDF?"
    "No. The output is translated Markdown and plain text, not a re-laid-out PDF.",
    // catalogue description: "About this tool" and the WebApplication JSON-LD
    // (until 2026-11-16; served uncaught through slice 2's first review)
    "Translate a PDF's selectable text into another language with AI, packaged as translated Markdown and plain text.",
    // guide FAQ, slice 2's first rewrite (until 2026-11-16): true, but read
    // alone it names the text as the whole output; the PDF came a sentence later
    "No. You always get a ZIP of translated Markdown and plain text.",
  ],
  // Whole-output synonyms nothing shipped, each a verb the old verb list let
  // through (review r1, 2026-11-16: all three false against it in node). The
  // noun shape must catch every one.
  synonyms: [
    "Translate PDF returns translated Markdown and plain text.",
    "You receive translated Markdown and plain text.",
    "The translation is delivered as Markdown and plain text in a ZIP.",
  ],
  // Still true, and must stay uncaught: the panel's description (the PDF it
  // denies is a LAYOUT-PRESERVING one) and the both-states FAQ of slice 1.
  honest: [
    "It produces translated text (not a layout-preserving PDF).",
    "You always get the translation as Markdown and plain text in a ZIP; where this server can draw your target language, a reflowed PDF of the same text comes with it — the panel shows which before you start.",
    "AI translates the PDF's selectable text and returns it as translated Markdown and plain text in a ZIP, with a reflowed PDF of the same text for 17 of the 21 languages, ready to download.",
    // Review r1's rewrites (2026-11-16): the catalogue description and the
    // guide's two sentences the noun shape caught.
    "Translate a PDF's selectable text into another language with AI: Markdown and plain text in a ZIP, plus a reflowed PDF of the same text for most target languages.",
    "Every translation arrives as a Markdown file and a plain-text file in a single ZIP, the one download every job gets whether or not a PDF comes with it.",
    "No. You always get a ZIP of translated Markdown and plain text, and a reflowed PDF of the same text where your target language has one.",
  ],
} as const;

describe("Translate PDF: the retired ZIP-only sentences stay retired", () => {
  const shapes = Object.entries(TRANSLATE_ZIP_ONLY_RULE.shapes);
  const asRule = {
    shapes: TRANSLATE_ZIP_ONLY_RULE.shapes,
  } as unknown as ClaimRule;

  it("the shapes and the shipped corpus cover each other, and the honest sentences pass", () => {
    const { shipped, honest } = TRANSLATE_ZIP_ONLY_RULE;
    expect(
      shapes
        .filter(([, re]) => !shipped.some((c) => re.test(c)))
        .map(([n]) => n),
      "shapes no shipped sentence exercises",
    ).toEqual([]);
    expect(
      shipped.filter((c) => !shapes.some(([, re]) => re.test(c))),
      "shipped sentences no shape catches",
    ).toEqual([]);
    expect(
      honest.filter((c) => shapes.some(([, re]) => re.test(c))),
      "an honest sentence read as a retired one",
    ).toEqual([]);
    expect(
      TRANSLATE_ZIP_ONLY_RULE.synonyms.filter(
        (c) => !shapes.some(([, re]) => re.test(c)),
      ),
      "a synonym of the whole-output claim walks past",
    ).toEqual([]);
  });

  it("positive control: a retired sentence on the tool's own page is caught THROUGH the attribution", () => {
    const planted: Container = {
      where: "/tools/translate-pdf (planted)",
      home: TRANSLATE_ZIP_ONLY_RULE.subject,
      texts: TRANSLATE_ZIP_ONLY_RULE.shipped,
    };
    const caught = attributedTo(
      planted,
      TRANSLATE_ZIP_ONLY_RULE.subject,
    ).filter(({ masked }) => shapes.some(([, re]) => re.test(masked)));
    expect(caught.length).toBe(TRANSLATE_ZIP_ONLY_RULE.shipped.length);
  });

  it("no served sentence about Translate PDF denies the PDF or names the text alone as the output", async () => {
    const { offenders, seen } = await offendersOf(
      asRule,
      TRANSLATE_ZIP_ONLY_RULE.subject,
    );
    // Health: the tool page plus its guides carry well over this many
    // sentences; fewer means the corpus or the attribution went blind.
    expect(seen, "corpus collapsed").toBeGreaterThanOrEqual(60);
    expect(offenders).toEqual([]);
  });
});

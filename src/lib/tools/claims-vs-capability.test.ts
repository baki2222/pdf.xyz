// @vitest-environment node
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
 *                       string, drawn once per page.
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
import { readFileSync } from "node:fs";
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
  setFillingRgbColor,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { tools, getToolBySlug } from "@/lib/tools";
import { guides } from "@/lib/guides";
import type { Guide } from "@/lib/guides";
import type { Tool } from "./types";
import { toolFacts } from "./tool-facts";
import {
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
import { rasterFormatForSlug } from "@/lib/pdf/pdf-to-image";
import { imagesToPdf } from "@/lib/pdf/image-to-pdf";
import { mergePdfs } from "@/lib/pdf/engine";
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
import { parseBboxFlow } from "@/lib/workers/pdf-text/parse";
import { OFFICE_METRIC_CLONES } from "@/lib/workers/office-conversion/fonts";
import {
  MAX_PICTURE_SIDE,
  scanPdfPages,
} from "@/lib/workers/pdf-office-export/page-scan";
import { typefaceFor } from "@/lib/workers/pdf-office-export/deck-from-scan";
import { getToolContent } from "./content";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import { linesPdf } from "@/tests/pptx-fidelity-fixtures";
import { TWO_COLUMN_BBOX } from "@/tests/poppler-samples";
import { runWorkerHtmlToPdf } from "@/lib/workers/html-render-client";
import type { FetchLike } from "@/lib/workers/pdf-security-client";
import { resetUploadedThisSessionForTests } from "@/lib/uploads/session-uploads";
import { ADVERTISED_WORKER_CAPABILITIES } from "@/lib/workers/observability";
import { panelDispatchArms, panelFile } from "@/tests/worker-panel-dispatch";
import { runnerModuleOf } from "@/tests/tool-panel-modules";

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
  for (const guide of guides) {
    if (guide.tools.includes(subject))
      out.push(await guideContainer(guide, subject));
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
      return bytes;
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
 * probe about Word's LAYOUT passes poppler's real output instead.
 */
async function officeParts(
  tool: PdfOfficeExportTool,
  pages: string[],
  extractFlow: PdfFlowExtractor = async () => ({
    pageCount: pages.length,
    pages: pages.map((t, i) => ({
      pageNumber: i + 1,
      paragraphs: t
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => [l.trim()]),
    })),
  }),
): Promise<Record<string, string>> {
  // PowerPoint reads the pages themselves since 2026-10-10: its probe is a
  // real PDF of these lines (and, with a picture on page 1, the thing the
  // owner reported missing) through the real page reader. The stub
  // extraction alone answers `unsupported` for it.
  const input =
    tool === PDF_TO_POWERPOINT_TOOL
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
    extractFlow,
    scanPages: scanPdfPages,
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
    honest: [
      "Every image goes on its own US Letter page in portrait orientation, centred with a half-inch white margin.",
      "The page size, orientation and margin are fixed — there is no setting to change them.",
    ],
    probe: async () => {
      // The runner is what a user can touch. Reached through the dispatch
      // the page mounts, then read for any control naming these settings.
      const kinds = new Set(
        slugsOfKind("image-to-pdf").map((s) => getRunnerKind(s)!),
      );
      const found: string[] = [];
      for (const kind of kinds) {
        const file = runnerFileForKind(kind);
        if (!file) throw new Error(`no runner module for kind ${kind}`);
        const source = withoutComments(read(file));
        for (const m of source.matchAll(/page size|orientation|margin/gi))
          found.push(`${file}: "${m[0]}"`);
      }
      return { present: found.length > 0, evidence: found.join("; ") };
    },
  },
  {
    id: "PDF to PNG produces a transparent background",
    subjects: () =>
      slugsOfKind("pdf-to-image").filter(
        (slug) => rasterFormatForSlug(slug) === "png",
      ),
    shapes: {
      transparent: /\btransparen(?:t|cy)\b/i,
      alpha: /\balpha(?:\s+channel)?\b/i,
    },
    shipped: [
      "Render PDF pages as crisp, lossless PNG images with a transparent or white background.",
    ],
    synonyms: ["Every PNG keeps an alpha channel."],
    honest: [
      "Render PDF pages as crisp, lossless PNG images on a white background — right in your browser, so the file stays on your device.",
    ],
    probe: async () => {
      // The runner never passes a background, so the rasterizer's default
      // paints every PNG. Both halves are read: a runner that starts passing
      // one, or a default that stops being opaque, is the capability arriving.
      const file = runnerFileForKind("pdf-to-image");
      if (!file) throw new Error("no runner module for pdf-to-image");
      const runner = withoutComments(read(file));
      const render = withoutComments(read("src/lib/pdf/render.ts"));
      const optionDefaults = (name: string) =>
        new RegExp(
          `export async function ${name}(?:<[^>]*>)?\\(\\s*bytes[^,]*,\\s*\\{([\\s\\S]*?)\\}\\s*:\\s*\\w+`,
        ).exec(render)?.[1];
      const rasterize = optionDefaults("rasterizePdf");
      if (!rasterize)
        throw new Error("could not find rasterizePdf's option defaults");
      // Follow the default to wherever it is applied. Until the grayscale fix
      // (wave 1, 2026-09-27) rasterizePdf defaulted `background` itself; it now
      // forwards `...rest` to capturePdfPages, which does. Reading only
      // rasterizePdf's own signature then found no white default and reported
      // the capability ARRIVED — a probe of the wrong function, not a new
      // feature. A shape that is neither fails loudly rather than guess.
      let defaults = rasterize;
      if (!/\bbackground\b/.test(rasterize)) {
        const forwards =
          /\.\.\.rest\b/.test(rasterize) &&
          /capturePdfPages\(\s*bytes,\s*\{\s*\.\.\.rest\b/.test(render);
        const captured = forwards
          ? optionDefaults("capturePdfPages")
          : undefined;
        if (!captured)
          throw new Error(
            "rasterizePdf neither defaults `background` nor forwards its options to capturePdfPages — find where the PNG background is decided and point this probe there",
          );
        defaults = captured;
      }
      const whiteDefault = /background\s*=\s*"#ffffff"/.test(defaults);
      const runnerChooses = /\bbackground\b|transparen|alpha/i.test(runner);
      return {
        present: runnerChooses || !whiteDefault,
        evidence: `runner mentions a background: ${runnerChooses}; rasterizePdf defaults to white: ${whiteDefault}`,
      };
    },
  },
  {
    id: "watermarks can be images, logos, or tiled",
    subjects: () => slugsOfKind("watermark"),
    shapes: {
      "image/logo": /\b(?:image|logo|picture)s?\b/i,
      "tiled/repeated": /\btil(?:e|es|ed|ing)\b|\brepeat(?:s|ed|ing)?\b/i,
    },
    shipped: [
      "Stamp text or image watermarks.",
      "Overlay a text or image watermark with adjustable opacity, rotation, and tiling.",
    ],
    synonyms: [
      "Add your logo as a watermark.",
      "The watermark is repeated across each page.",
    ],
    honest: [
      "Stamp a text watermark on every page.",
      "Stamp a text watermark on every page of a PDF in your browser — set the text, opacity, angle, size and color.",
    ],
    probe: async () => {
      // What the engine can be ASKED to do: its options type and its
      // signature. A type erases at runtime, so it is read from source.
      const source = withoutComments(read("src/lib/pdf/watermark.ts"));
      const body = /export interface WatermarkOptions\s*\{([\s\S]*?)\n\}/.exec(
        source,
      )?.[1];
      const params =
        /export async function addWatermark\(([\s\S]*?)\)\s*:/.exec(
          source,
        )?.[1];
      if (!body || !params)
        throw new Error("could not read WatermarkOptions / addWatermark");
      const keys = [...body.matchAll(/^\s*(\w+)\??\s*:/gm)].map((m) => m[1]!);
      // Health: the parse must see the options the runner does use.
      if (!keys.includes("opacity") || !keys.includes("rotation"))
        throw new Error(
          `WatermarkOptions parse looks wrong: ${keys.join(",")}`,
        );
      const capable = [...keys, params].filter((k) =>
        /image|logo|picture|tile|repeat|pattern/i.test(k),
      );
      return {
        present: capable.length > 0,
        evidence: `WatermarkOptions keys: ${keys.join(", ")}; addWatermark(${params.replace(/\s+/g, " ").trim()})`,
      };
    },
  },
  {
    id: "HTML to PDF takes pasted markup or rendering options",
    subjects: () => panelMounts().get("HtmlRenderWorkerPanel") ?? [],
    shapes: {
      snippets: /\bsnippets?\b/i,
      "paste markup":
        /\bpaste\w*\s+(?:your\s+|the\s+|some\s+)?(?:html|markup|code)\b/i,
      "choose options":
        /\b(?:choose|set|pick|adjust)\s+(?:your\s+|the\s+)?options\b/i,
    },
    shipped: [
      "Convert HTML files or snippets into PDF with a real Chromium rendering engine on a secure worker that deletes the input when the job finishes.",
      "Choose your options.",
    ],
    synonyms: ["Paste your HTML markup and render it."],
    honest: [
      "Paste a public http(s) URL.",
      "Upload one .html or .htm file over an encrypted connection.",
    ],
    probe: async () => {
      // On the wire: the options the real client sends with the job. And the
      // panel: the only way markup could be pasted is a text area.
      const options = await htmlJobOptionsOnTheWire();
      const mounts = panelMounts();
      const panelName = [...mounts.entries()].find(([, slugs]) =>
        slugs.includes("html-to-pdf"),
      )?.[0];
      const panelFile = panelName ? panelModule(panelName) : undefined;
      if (!panelFile) throw new Error("no panel mounted for html-to-pdf");
      const panel = withoutComments(read(panelFile));
      const hasTextarea = /<textarea\b/.test(panel);
      return {
        present: Object.keys(options).length > 0 || hasTextarea,
        evidence: `job options on the wire: ${JSON.stringify(options)}; ${panelFile} has a <textarea>: ${hasTextarea}`,
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
      // A real two-column page, as poppler reads it: the engine now reads it
      // in order (see worker-tool-answers.test.ts); the question here is only
      // whether any LAYOUT reaches the DOCX.
      const parts = await officeParts(PDF_TO_WORD_TOOL, [""], async () =>
        flowText(parseBboxFlow(TWO_COLUMN_BBOX)),
      );
      const doc = parts["word/document.xml"] ?? "";
      const layout = [
        ...doc.matchAll(/<w:(?:tbl|drawing|rPr|pPr|sectPr>|cols)\b/g),
      ].map((m) => m[0]);
      const styled = Object.keys(parts).filter((p) =>
        /styles|media\/|fontTable/.test(p),
      );
      return {
        present: layout.length > 0 || styled.length > 0,
        evidence: `document.xml layout elements: [${layout.join(", ")}]; styling parts: [${styled.join(", ")}]`,
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
      const wholeFiles =
        mergePdfs.length === 1 && order.join() === "101,102,201,202";
      return {
        present: !wholeFiles,
        evidence: `mergePdfs takes ${mergePdfs.length} argument(s); merged page order ${order.join(",")}`,
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
  const PAPER: Record<string, [number, number]> = {
    "US Letter": [612, 792],
    A4: [595.28, 841.89],
    "US Legal": [612, 1008],
  };
  const MARGIN_WORDS: Record<string, number> = {
    "quarter-inch": 18,
    "half-inch": 36,
    "one-inch": 72,
  };

  async function served(subject: string): Promise<string> {
    const all: string[] = [];
    for (const c of await containersFor(subject))
      all.push(...attributedTo(c, subject).map((a) => a.sentence));
    return all.join(" ");
  }

  it("image-to-PDF: every paper size and margin the copy names is the one the engine draws", async () => {
    const wide = await decodeFirstPage(
      await imagesToPdf("jpg", [
        { name: "wide.jpg", type: "image/jpeg", bytes: jpegOfSize(4000, 2000) },
      ]),
    );
    const tall = await decodeFirstPage(
      await imagesToPdf("jpg", [
        { name: "tall.jpg", type: "image/jpeg", bytes: jpegOfSize(2000, 4000) },
      ]),
    );
    // Health: the decoder found the one image on each page.
    expect(wide.images).toHaveLength(1);
    expect(tall.images).toHaveLength(1);
    const w = wide.images[0]!;
    const t = tall.images[0]!;
    // The binding side of each photo sets the margin.
    const margin = Math.min(w.x, t.y);
    expect(Math.abs(w.x - (wide.width - w.x - w.w))).toBeLessThan(0.01);

    for (const subject of slugsOfKind("image-to-pdf")) {
      const text = await served(subject);
      for (const [paper, [pw, ph]] of Object.entries(PAPER)) {
        if (!text.includes(paper)) continue;
        expect(
          [wide.width, wide.height],
          `${subject} says ${paper}, the engine draws ${wide.width}×${wide.height}`,
        ).toEqual([pw, ph]);
      }
      for (const [phrase, points] of Object.entries(MARGIN_WORDS)) {
        if (!text.includes(phrase)) continue;
        expect(margin, `${subject} says a ${phrase} margin`).toBeCloseTo(
          points,
          1,
        );
      }
      if (/\bportrait\b/i.test(text))
        expect(wide.height, `${subject} says portrait`).toBeGreaterThan(
          wide.width,
        );
    }
    // The option claims were replaced by the fixed layout: jpg-to-pdf must
    // SAY which one, or a reader is left to guess at the thing they searched for.
    const jpg = await served(
      slugsOfKind("image-to-pdf").find((s) =>
        getToolBySlug(s)!.accept.includes("JPG"),
      )!,
    );
    expect(Object.keys(PAPER).some((p) => jpg.includes(p))).toBe(true);
    expect(Object.keys(MARGIN_WORDS).some((p) => jpg.includes(p))).toBe(true);
  });

  it("image-to-PDF: the relationship catches a wrong paper name (positive control)", async () => {
    const page = await decodeFirstPage(
      await imagesToPdf("jpg", [
        { name: "a.jpg", type: "image/jpeg", bytes: jpegOfSize(800, 600) },
      ]),
    );
    expect([page.width, page.height]).not.toEqual(PAPER.A4);
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
  const ppt = getToolContent("pdf-to-powerpoint")!;
  const pageText = () =>
    [
      ...ppt.intro,
      ...ppt.useCases.map((u) => u.body),
      ...ppt.steps.map((s) => s.body),
      ...ppt.faqs.map((f) => f.a),
      ...toolFacts("pdf-to-powerpoint").map((f) => f.value),
    ].join("\n");

  /**
   * The faces Windows 10/11 and Microsoft 365 install: a fact about the
   * outside world, written down here, not derived from the code it judges.
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

  it("every font the deck names is one Windows or Office ships; a free clone becomes the face it copies", () => {
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
    const text = pageText();
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
    const text = pageText();
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
    expect(pageText()).not.toMatch(
      /\bevery picture on (?:a|the) page (?:lands|is)\b/i,
    );
  });
});

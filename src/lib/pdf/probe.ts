import type { PDFDict, PDFDocument, PDFPage } from "pdf-lib";
import { isFormStream, isImageStream } from "./image-stream";
import { pageCountFromDoc } from "./page-count";
import { loadPdfLib, type PdfLibModule } from "./pdf-lib";
import type { PageContent, PdfProbe } from "./probe-result";

/**
 * What a PDF holds, read in this tab, so a suggestion can show the fact that
 * justified it ("No selectable text on pages 1–3", "4 form fields", "212
 * pages"). ONE pdf-lib parse at the default `ParseSpeeds.Slow` (it yields to
 * the event loop every 100 objects), then a bounded look at the first pages.
 *
 * WHY NOT pdf.js FOR EVERYTHING. pdf.js with its worker is roughly 472 KB
 * gzipped — too much to justify one suggestion on a page that has not run a
 * tool yet. So the "no selectable text" claim is made STRUCTURALLY: a page is
 * `image-only` only when its content — followed into Form XObjects and tiling
 * patterns — has no text operator (`BT`, `Tj`, `TJ`, `Tf`), no reachable
 * `/Font` resource, and draws at least one image. Showing text needs both a
 * font and a text operator, so such a page has no text layer to extract.
 * Every doubt resolves AWAY from the claim: a token found inside binary data
 * can only make a page `text`, and a stream the probe cannot decode, or one
 * past the per-page budget, makes it `unknown`. `probe.test.ts` binds the
 * result to the pdf.js extractor `pdf-to-text` uses.
 *
 * ENCRYPTION has two verdicts, and pdf-lib cannot give either: it sees an
 * `/Encrypt` dictionary and nothing more. The lock is asked of pdf.js
 * (`classifyPdfAccess`), loaded only for a file that has one, and an
 * encrypted file yields no pdf-lib facts at all — in a PDF 1.5+ file the page
 * tree lives in encrypted object streams, where pdf-lib reads garbage. There
 * is deliberately no `encrypted` field: a consumer derives it as
 * `lock !== "none"`, and `encryption-verdict.test.ts` fails any consumer that
 * reads a bare `.encrypted` without asking which lock it is.
 *
 * Never throws. Byte-free: nothing here holds or returns the file's content.
 */

export {
  imageOnlyRange,
  type PageContent,
  type PdfLock,
  type PdfProbe,
} from "./probe-result";

export interface ProbeOptions {
  /** The caller's parse ceiling: pdf-lib holds the whole file in memory. */
  readonly maxBytes: number;
  /** How many leading pages to classify. */
  readonly samplePages?: number;
  /** Decoded content bytes a sampled page may read before it is `unknown`. */
  readonly maxDecodedPerPage?: number;
}

export const PROBE_SAMPLE_PAGES = 3;
/** Decoded content read per sampled page, at most. */
export const PROBE_DECODE_BUDGET = 4 * 1024 * 1024;
/** How deep Form XObjects and patterns are followed. */
const MAX_NESTING = 4;

const NOTHING: Omit<PdfProbe, "read"> = {
  lock: "none",
  pages: null,
  formFields: null,
  sample: [],
};

/** Let the event loop breathe between sampled pages. */
const yieldToMain = () => new Promise<void>((r) => setTimeout(r, 0));

/** Read every fact this module reports about `bytes`. Never throws. */
export async function probePdf(
  bytes: Uint8Array,
  options: ProbeOptions,
): Promise<PdfProbe> {
  if (bytes.byteLength > options.maxBytes) {
    return { read: "too-large", ...NOTHING };
  }
  if (bytes.byteLength === 0) return { read: "unreadable", ...NOTHING };
  let lib: PdfLibModule;
  let doc: PDFDocument;
  try {
    lib = await loadPdfLib();
    doc = await lib.PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
  } catch {
    return { read: "unreadable", ...NOTHING };
  }

  if (doc.isEncrypted) return { read: "ok", ...(await lockedFacts(bytes)) };

  // pdf-lib is lenient: a header and garbage parse into a document with no
  // page tree. That is a file no tool here can open, not a PDF of no pages.
  const counted = pageCountFromDoc(doc);
  if (!counted.ok && counted.unknown === "unparseable") {
    return { read: "unreadable", ...NOTHING };
  }
  const pages = counted.ok ? counted.count : 0;
  let formFields: number | null;
  try {
    formFields = doc.getForm().getFields().length;
  } catch {
    formFields = null;
  }

  const sample: PageContent[] = [];
  const wanted = Math.min(
    Math.max(0, options.samplePages ?? PROBE_SAMPLE_PAGES),
    pages,
  );
  const budget = options.maxDecodedPerPage ?? PROBE_DECODE_BUDGET;
  for (let i = 0; i < wanted; i += 1) {
    if (i > 0) await yieldToMain();
    sample.push(classifyPage(lib, doc, i, budget));
  }
  return { read: "ok", lock: "none", pages, formFields, sample };
}

/** The facts of a file pdf-lib cannot read: its lock, and pdf.js's count. */
async function lockedFacts(bytes: Uint8Array): Promise<Omit<PdfProbe, "read">> {
  try {
    const { classifyPdfAccess } = await import("./encryption");
    const access = await classifyPdfAccess(bytes);
    switch (access.kind) {
      case "password-required":
        return { ...NOTHING, lock: "password-required" };
      // pdf-lib saw /Encrypt; a reader that opens it with no prompt — even
      // one that reports no encryption at all — is a restriction, not a
      // password (addendum WP-04 #71).
      case "restricted":
      case "unencrypted":
        return { ...NOTHING, lock: "restricted", pages: access.pageCount };
      case "unreadable":
        return { ...NOTHING, lock: "unknown" };
    }
  } catch {
    return { ...NOTHING, lock: "unknown" };
  }
}

/* ------------------------------------------------------------------ *
 *  The page scan
 * ------------------------------------------------------------------ */

interface Scan {
  text: boolean;
  image: boolean;
  unknown: boolean;
  /** Decoded bytes this page may still read. */
  budget: number;
  /** Streams already followed — a Form that draws itself is read once. */
  readonly seen: Set<unknown>;
}

/** Whole-token text operators: a content stream cannot show text without them. */
const TEXT_OPERATOR = /(?:^|[\s)\]>])(?:BT|Tj|TJ|Tf)(?=[\s([</%]|$)/;
/** An inline image's opening operator. */
const INLINE_IMAGE = /(?:^|\s)BI(?=\s)/;
/** `/Name Do`: draw the named XObject. */
const DRAW_XOBJECT = /\/([^\s/[\]()<>{}%]+)\s+Do(?=[\s([</%]|$)/g;

function classifyPage(
  lib: PdfLibModule,
  doc: PDFDocument,
  index: number,
  budget: number,
): PageContent {
  const scan: Scan = {
    text: false,
    image: false,
    unknown: false,
    budget,
    seen: new Set(),
  };
  try {
    const page: PDFPage = doc.getPage(index);
    const resources = page.node.Resources();
    readResources(lib, resources, scan, 0);
    for (const stream of contentStreams(lib, page)) {
      if (scan.text) break;
      readContent(lib, stream, resources, scan, 0);
    }
  } catch {
    scan.unknown = true;
  }
  if (scan.text) return "text";
  if (scan.unknown) return "unknown";
  return scan.image ? "image-only" : "blank";
}

/** The page's content streams, in drawing order. */
function contentStreams(lib: PdfLibModule, page: PDFPage): unknown[] {
  const contents = page.node.Contents();
  if (!contents) return [];
  if (contents instanceof lib.PDFArray) {
    const out: unknown[] = [];
    for (let i = 0; i < contents.size(); i += 1) out.push(contents.lookup(i));
    return out;
  }
  return [contents];
}

/** Decode a stream within the page's budget; null when it cannot be read. */
function decoded(
  lib: PdfLibModule,
  stream: unknown,
  scan: Scan,
): string | null {
  // A parsed document's streams are all raw; anything else is not content.
  if (!(stream instanceof lib.PDFRawStream)) return null;
  let bytes: Uint8Array | Uint8ClampedArray;
  try {
    bytes = lib.decodePDFRawStream(stream).getBytes(scan.budget + 1);
  } catch {
    return null;
  }
  if (bytes.length > scan.budget) return null;
  scan.budget -= bytes.length;
  // latin1: one char per byte, so operators read the same whatever the bytes.
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return text;
}

/** A `/Font` entry with anything in it marks the content as text. */
function readResources(
  lib: PdfLibModule,
  resources: PDFDict | undefined,
  scan: Scan,
  depth: number,
): void {
  if (!resources || scan.text) return;
  const fonts = resources.lookup(lib.PDFName.of("Font"));
  if (fonts instanceof lib.PDFDict && fonts.keys().length > 0) {
    scan.text = true;
    return;
  }
  // Tiling patterns carry content streams of their own; whether or not the
  // page fills with one, their text suppresses the claim.
  const patterns = resources.lookup(lib.PDFName.of("Pattern"));
  if (!(patterns instanceof lib.PDFDict)) return;
  for (const key of patterns.keys()) {
    const pattern = patterns.lookup(key);
    if (!(pattern instanceof lib.PDFStream)) continue;
    const type = pattern.dict.lookup(lib.PDFName.of("PatternType"));
    if (!(type instanceof lib.PDFNumber) || type.asNumber() !== 1) continue;
    followStream(lib, pattern, resources, scan, depth);
    if (scan.text) return;
  }
}

/** Read a Form XObject's or pattern's content, under its own resources. */
function followStream(
  lib: PdfLibModule,
  stream: InstanceType<PdfLibModule["PDFStream"]>,
  inherited: PDFDict | undefined,
  scan: Scan,
  depth: number,
): void {
  if (scan.seen.has(stream)) return;
  if (depth >= MAX_NESTING) {
    scan.unknown = true;
    return;
  }
  scan.seen.add(stream);
  const own = stream.dict.lookup(lib.PDFName.of("Resources"));
  const resources = own instanceof lib.PDFDict ? own : inherited;
  readResources(lib, resources, scan, depth + 1);
  if (!scan.text) readContent(lib, stream, resources, scan, depth + 1);
}

function readContent(
  lib: PdfLibModule,
  stream: unknown,
  resources: PDFDict | undefined,
  scan: Scan,
  depth: number,
): void {
  const text = decoded(lib, stream, scan);
  if (text === null) {
    scan.unknown = true;
    return;
  }
  if (TEXT_OPERATOR.test(text)) {
    scan.text = true;
    return;
  }
  if (INLINE_IMAGE.test(text)) scan.image = true;
  const xobjects = resources?.lookup(lib.PDFName.of("XObject"));
  if (!(xobjects instanceof lib.PDFDict)) return;
  for (const [, name] of text.matchAll(DRAW_XOBJECT)) {
    const xobject = xobjects.lookup(lib.PDFName.of(name!));
    if (isImageStream(lib, xobject)) {
      scan.image = true;
    } else if (isFormStream(lib, xobject)) {
      followStream(lib, xobject, resources, scan, depth);
    }
    if (scan.text) return;
  }
}

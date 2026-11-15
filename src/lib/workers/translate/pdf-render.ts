/**
 * Print a translation as a reflowed PDF with Chromium, and prove — per job —
 * that the PDF carries the text it was given.
 *
 * Never throws, except an attempt abort (`rethrowIfAttemptAbort`): the PDF is
 * an ADDITION to the translation ZIP, which is already built and paid for when
 * this runs, so every way this can fail is a typed reason the engine records
 * and the panel states, never a failed job.
 *
 * ── PER-JOB CONSERVATION ────────────────────────────────────────────────────
 *
 * A PDF that drew nothing for a script, or lost a block to a layout bug,
 * would read as a successful translation with holes in it — the failure shape
 * this feature keeps having, where the defect produces confident output
 * rather than an error. So the printed bytes are read back by `pdftotext` (the
 * extractor this worker already runs) and the MULTISET of non-whitespace code
 * points, NFC-normalised, must equal the text the document was built from
 * (`typesetText`), AND must carry every non-syntax code point of the
 * translation the ZIP holds (`carriesTranslation`, review r1 2026-11-15: the
 * first check alone cannot see text the Markdown parser dropped, because both
 * of its sides come after the parser). Any difference is `not_conserved` and
 * the PDF is withheld; the ZIP still carries the whole translation.
 *
 * Excluded from both sides: whitespace (layout, not content) and format
 * characters (`\p{Cf}`: zero-width joiners, soft hyphens, bidi marks), which
 * steer shaping and line breaking and are never drawn as glyphs.
 *
 * pdf-lib is used for metadata and the page count — title, language,
 * producer — and, since 2026-11-15, to rewrite radical destinations (Kangxi;
 * since 2026-11-16 also the CJK Radicals Supplement and Extension A) in
 * the fonts' ToUnicode maps ({@link normaliseToUnicodeStreams}). No text is
 * drawn with it (`src/deploy/text-drawing-call-sites.test.ts` scans for the
 * text APIs; this file uses none).
 *
 * ── THE TOUNICODE REWRITE RUNS BEFORE `doc.save()` ──────────────────────────
 *
 * So the size cap, the read-back and both conservation checks judge the bytes
 * that are delivered (order matters: a rewrite applied after the save would
 * change a discarded copy). The read-back is NOT a guard on the rewrite:
 * pdftotext honours the ActualText Skia writes on exactly the glyphs it
 * rewrites, so a broken rewrite still conserves. Its guards are
 * `radical-equivalents.test.ts`, the composed-chain test in
 * `pdf-render.cjk.test.ts` (real fixture → this pass → real pdf.js), and the
 * start-up probe's (e) `viewer_text`.
 *
 * Two things keep it from changing what ANY reader gets for a character
 * that was really drawn (review 2026-11-16, both measured in the image):
 *
 *   - Radicals the job's typeset text literally contains are excluded
 *     (Kangxi, Supplement and Extension A alike: `rewriteSourcesIn`). Skia
 *     writes no ActualText for a literal radical (it matches the entry), so
 *     rewriting that entry made poppler read 文 for a drawn ⽂ and the job
 *     fail `not_conserved` — en, zh and ja jobs main delivered. Such a job
 *     keeps its radical entries and reads exactly as on main.
 *   - The target is the ideograph that shares the radical's glyph in the
 *     font's own face (measured cmap facts), not the Unicode equivalent:
 *     ⼾'s glyph is 户 in SC and 戸 in JP, not 戶.
 */
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
} from "pdf-lib";
import {
  anySignal,
  rethrowIfAttemptAbort,
  signalOption,
} from "../attempt-abort";
import type { RunControl } from "../attempt-abort";
import type { ChromiumPackageRunner } from "../html-render/engine";
import {
  TRANSLATE_PDF_MAX_OUTPUT_BYTES,
  TRANSLATE_PDF_RENDER_TIMEOUT_MS,
  type TranslatePdfReason,
} from "@/lib/jobs/translate-pdf-render";
import {
  rewriteSourcesIn,
  normaliseRadicalToUnicode,
  radicalRewritesFor,
} from "./radical-equivalents";
import {
  translationDocument,
  typesetFurnitureText,
  typesetText,
  type TypesetInput,
} from "./typeset";

export const TRANSLATE_PDF_PRODUCER = "pdf.xyz Translate PDF (Chromium)";

export type { TranslatePdfReason };

export type TranslatePdfResult =
  | { ok: true; bytes: Uint8Array; pages: number }
  | { ok: false; reason: TranslatePdfReason };

/** Read a PDF's text back (the worker's `pdftotext`). */
export type PdfTextReader = (
  bytes: Uint8Array,
  run?: RunControl,
) => Promise<string>;

export interface RenderTranslationArgs {
  readonly chromium: ChromiumPackageRunner;
  readonly readBack: PdfTextReader;
  readonly input: TypesetInput;
  /** Defaults to {@link TRANSLATE_PDF_RENDER_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Defaults to {@link TRANSLATE_PDF_MAX_OUTPUT_BYTES}. */
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
}

/** The comparison's alphabet: no whitespace, no format characters, NFC. */
export function conservedCodePoints(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ch of text.normalize("NFC")) {
    if (/\s|\p{Cf}/u.test(ch)) continue;
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  return counts;
}

/** True when both texts carry exactly the same code points, as multisets. */
export function sameCodePoints(expected: string, actual: string): boolean {
  const a = conservedCodePoints(expected);
  const b = conservedCodePoints(actual);
  if (a.size !== b.size) return false;
  for (const [ch, n] of a) if (b.get(ch) !== n) return false;
  return true;
}

const latin1Text = (bytes: Uint8Array) => {
  let s = "";
  for (let k = 0; k < bytes.length; k += 0x8000)
    s += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return s;
};

/** A font's face: its descriptor's /FontName without the subset tag. */
function fontFace(font: PDFDict): string | null {
  let descriptor = font.lookup(PDFName.of("FontDescriptor"));
  if (!(descriptor instanceof PDFDict)) {
    const descendants = font.lookup(PDFName.of("DescendantFonts"));
    const first =
      descendants instanceof PDFArray ? descendants.lookup(0) : undefined;
    if (first instanceof PDFDict)
      descriptor = first.lookup(PDFName.of("FontDescriptor"));
  }
  if (!(descriptor instanceof PDFDict)) return null;
  const name = descriptor.get(PDFName.of("FontName"));
  return name instanceof PDFName
    ? name.decodeText().replace(/^[A-Z]{6}\+/, "")
    : null;
}

/**
 * The faces (descriptor /FontName, subset tag stripped) of every font in a
 * PDF, sorted and distinct. Read by the image proof's corpus judge
 * (`cjk-corpus-read.ts`) to ask the measured facts about the face that drew
 * a glyph.
 */
export async function pdfFontFaces(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const out = new Set<string>();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (obj.get(PDFName.of("Type")) !== PDFName.of("Font")) continue;
    const face = fontFace(obj);
    if (face) out.add(face);
  }
  return [...out].sort();
}

/**
 * Every font's /ToUnicode stream, whatever the target (Han can appear in any
 * target's text), with radical (and Extension A) destinations replaced by the unified
 * ideograph that shares the radical's glyph IN THAT FONT'S FACE
 * (`radicalRewritesFor`, from measured cmap facts — a face the facts do not
 * name is left alone). Radicals in `keep` — the ones the job's own text
 * contains — are never rewritten: a literal radical has no ActualText, so a
 * rewritten entry would change what every reader, poppler included, reads.
 * A stream is replaced ONLY when the rewrite changed its text; every other
 * stream object is left byte-identical, and a font with no ToUnicode is left
 * alone. Returns how many were replaced.
 */
export function normaliseToUnicodeStreams(
  doc: PDFDocument,
  keep: ReadonlySet<number> = new Set(),
): number {
  const ctx = doc.context;
  const seen = new Set<string>();
  let replaced = 0;
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (obj.get(PDFName.of("Type")) !== PDFName.of("Font")) continue;
    const ref = obj.get(PDFName.of("ToUnicode"));
    if (!(ref instanceof PDFRef) || seen.has(ref.toString())) continue;
    seen.add(ref.toString());
    const face = fontFace(obj);
    const table = face ? radicalRewritesFor(face, keep) : null;
    if (!table || table.size === 0) continue;
    const stream = ctx.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    const text = latin1Text(decodePDFRawStream(stream).decode());
    const next = normaliseRadicalToUnicode(text, table);
    if (next === text) continue;
    ctx.assign(ref, ctx.flateStream(next));
    replaced += 1;
  }
  return replaced;
}

class RenderDeadline extends Error {}

function looksLikeTimeout(error: unknown): boolean {
  if (error instanceof RenderDeadline) return true;
  if (!(error instanceof Error)) return false;
  return (
    error.name === "RenderTimeoutError" ||
    /timed out|timeout/i.test(error.message)
  );
}

function looksTooLarge(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "RenderOutputTooLargeError" ||
      /too large|exceeds?.*(limit|cap)/i.test(error.message))
  );
}

/**
 * Markdown syntax the typesetter may print FEWER of than the translation
 * holds: heading, emphasis, code, quote, list, table and link markers, and
 * the backslash of a hard line break. Derived
 * from what `parseMarkdownBlocks` really strips — `pdf-conservation.test.ts`
 * holds this set EQUAL to what its corpus strips, in both directions, so a
 * member nothing exercises and a stripped character nobody named both fail.
 *
 * A dropped character in this set is not seen by the check (an escaped
 * literal `\*` printed without its asterisks is the known case). Every letter,
 * digit, CJK character and ordinary punctuation mark is checked.
 */
export const MARKDOWN_SYNTAX: ReadonlySet<string> = new Set(
  "#=-*_~`>|+:[]!\\".split(""),
);

/**
 * A body's text with the three syntax-only SPANS removed — spans whose
 * letters or digits the typesetter replaces rather than prints:
 *
 * - an ordered-list number at the start of a line (`3.`, `12)`): the
 *   typesetter prints its own marker, renumbered from the list's start;
 * - a footnote label (`[^note]`): printed as its reference number;
 * - a code fence line (```` ```js ````): the fence and its info string.
 *
 * Everything else — a reference definition `[1]: 山田太郎` included — is
 * content the PDF must carry.
 */
export function markdownContent(text: string): string {
  return text
    .replace(/^([ \t]*(?:>[ \t]*)*)\d{1,9}[.)](?=[ \t]|$)/gm, "$1")
    .replace(/\[\^[^\]\s]+\]/g, "")
    .replace(/^[ \t]*(?:`{3,}|~{3,}).*$/gm, "");
}

/**
 * Does the read-back carry the ASSEMBLED TRANSLATION — every body the model
 * returned, as the ZIP holds it — plus the page furniture (title, note, page
 * ranges, gap words)?
 *
 * Checked against the parts' RAW text, not against `typesetText`: the
 * typesetter's text is recorded after the Markdown parser has run, so text
 * the parser drops (a reference list `[1]: 山田太郎` parses as link
 * definitions) would be missing from both sides and pass by construction
 * (review r1, 2026-11-15). The furniture is counted ON TOP of the bodies, so
 * a word in the file name cannot stand in for the same word lost from a body.
 */
export function carriesTranslation(
  input: TypesetInput,
  readText: string,
): boolean {
  const bodies = input.parts
    .filter((p) => p.kind === "body")
    .map((p) => markdownContent(p.text));
  const expected = conservedCodePoints(
    [typesetFurnitureText(input), ...bodies].join("\n"),
  );
  const read = conservedCodePoints(readText);
  for (const [ch, n] of expected) {
    if (MARKDOWN_SYNTAX.has(ch)) continue;
    if ((read.get(ch) ?? 0) < n) return false;
  }
  return true;
}

/**
 * The PDF stage under ONE deadline: Chromium, the pdf-lib metadata pass and
 * the `pdftotext` read-back (review r1, 2026-11-15). The deadline used to
 * bound Chromium alone, so the read-back could add its own 120 s after the
 * 60 s the browser's wait allows for the stage. At the deadline the stage's
 * own signal aborts, which kills whichever child is running; that abort is
 * the deadline's, never reported as a lost lease.
 */
export async function renderTranslationPdf(
  args: RenderTranslationArgs,
): Promise<TranslatePdfResult> {
  const timeoutMs = args.timeoutMs ?? TRANSLATE_PDF_RENDER_TIMEOUT_MS;
  const stage = new AbortController();
  const signal = anySignal(args.signal, stage.signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<TranslatePdfResult>((resolve) => {
    timer = setTimeout(() => {
      stage.abort(new RenderDeadline());
      resolve({ ok: false, reason: "timeout" });
    }, timeoutMs);
  });
  try {
    const work = printAndCheck(args, signal, () => stage.signal.aborted);
    // A rejection after the deadline won the race is not anyone's to handle.
    work.catch(() => {});
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function printAndCheck(
  args: RenderTranslationArgs,
  signal: AbortSignal | undefined,
  pastDeadline: () => boolean,
): Promise<TranslatePdfResult> {
  const maxBytes = args.maxOutputBytes ?? TRANSLATE_PDF_MAX_OUTPUT_BYTES;
  const pkg = translationDocument(args.input);
  /** An abort is the attempt's (rethrown) unless the stage's deadline fired. */
  const classify = (error: unknown): TranslatePdfResult | null => {
    if (pastDeadline()) return { ok: false, reason: "timeout" };
    rethrowIfAttemptAbort(error);
    return null;
  };

  let printed: Uint8Array;
  try {
    const parts = await args.chromium.renderPackage(pkg, signalOption(signal));
    if (parts.length !== 1 || !parts[0])
      return { ok: false, reason: "render_failed" };
    printed = parts[0];
  } catch (error) {
    const known = classify(error);
    if (known) return known;
    if (looksLikeTimeout(error)) return { ok: false, reason: "timeout" };
    if (looksTooLarge(error)) return { ok: false, reason: "too_large" };
    return { ok: false, reason: "render_failed" };
  }

  let bytes: Uint8Array;
  let pages: number;
  try {
    const doc = await PDFDocument.load(printed, { updateMetadata: false });
    doc.setTitle(args.input.sourceName, { showInWindowTitleBar: true });
    doc.setLanguage(args.input.target);
    doc.setProducer(TRANSLATE_PDF_PRODUCER);
    doc.setCreator(TRANSLATE_PDF_PRODUCER);
    pages = doc.getPageCount();
    normaliseToUnicodeStreams(doc, rewriteSourcesIn(typesetText(args.input)));
    bytes = await doc.save();
  } catch (error) {
    const known = classify(error);
    if (known) return known;
    return { ok: false, reason: "render_failed" };
  }
  if (pages < 1) return { ok: false, reason: "render_failed" };
  if (bytes.byteLength > maxBytes) return { ok: false, reason: "too_large" };

  let readText: string;
  try {
    readText = await args.readBack(bytes, signalOption(signal));
  } catch (error) {
    const known = classify(error);
    if (known) return known;
    return { ok: false, reason: "not_conserved" };
  }
  // Two checks, composed. (1) Chromium printed exactly what was typeset —
  // a block lost to layout is caught here. (2) What was typeset carries the
  // translation the ZIP holds — a block lost to the Markdown parser is caught
  // here, which (1) cannot see because both of its sides come after the parser.
  if (!sameCodePoints(typesetText(args.input), readText))
    return { ok: false, reason: "not_conserved" };
  if (!carriesTranslation(args.input, readText))
    return { ok: false, reason: "not_conserved" };

  return { ok: true, bytes, pages };
}

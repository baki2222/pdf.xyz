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
 * (`typesetText`). Any difference is `not_conserved` and the PDF is withheld;
 * the ZIP still carries the whole translation.
 *
 * Excluded from both sides: whitespace (layout, not content) and format
 * characters (`\p{Cf}`: zero-width joiners, soft hyphens, bidi marks), which
 * steer shaping and line breaking and are never drawn as glyphs.
 *
 * pdf-lib is used ONLY for metadata and the page count — title, language,
 * producer. No text is drawn with it (`src/deploy/text-drawing-call-sites.test.ts`
 * scans for the text APIs; this file uses none).
 */
import { PDFDocument } from "pdf-lib";
import { rethrowIfAttemptAbort, signalOption } from "../attempt-abort";
import type { RunControl } from "../attempt-abort";
import type { ChromiumPackageRunner } from "../html-render/engine";
import {
  TRANSLATE_PDF_MAX_OUTPUT_BYTES,
  TRANSLATE_PDF_RENDER_TIMEOUT_MS,
  type TranslatePdfReason,
} from "@/lib/jobs/translate-pdf-render";
import { translationDocument, typesetText, type TypesetInput } from "./typeset";

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

export async function renderTranslationPdf(
  args: RenderTranslationArgs,
): Promise<TranslatePdfResult> {
  const timeoutMs = args.timeoutMs ?? TRANSLATE_PDF_RENDER_TIMEOUT_MS;
  const maxBytes = args.maxOutputBytes ?? TRANSLATE_PDF_MAX_OUTPUT_BYTES;
  const pkg = translationDocument(args.input);

  let printed: Uint8Array;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RenderDeadline()), timeoutMs);
    });
    deadline.catch(() => {});
    const parts = await Promise.race([
      args.chromium.renderPackage(pkg, signalOption(args.signal)),
      deadline,
    ]);
    if (parts.length !== 1 || !parts[0])
      return { ok: false, reason: "render_failed" };
    printed = parts[0];
  } catch (error) {
    rethrowIfAttemptAbort(error);
    if (looksLikeTimeout(error)) return { ok: false, reason: "timeout" };
    if (looksTooLarge(error)) return { ok: false, reason: "too_large" };
    return { ok: false, reason: "render_failed" };
  } finally {
    clearTimeout(timer);
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
    bytes = await doc.save();
  } catch (error) {
    rethrowIfAttemptAbort(error);
    return { ok: false, reason: "render_failed" };
  }
  if (pages < 1) return { ok: false, reason: "render_failed" };
  if (bytes.byteLength > maxBytes) return { ok: false, reason: "too_large" };

  let readText: string;
  try {
    readText = await args.readBack(bytes, signalOption(args.signal));
  } catch (error) {
    rethrowIfAttemptAbort(error);
    return { ok: false, reason: "not_conserved" };
  }
  if (!sameCodePoints(typesetText(args.input), readText))
    return { ok: false, reason: "not_conserved" };

  return { ok: true, bytes, pages };
}

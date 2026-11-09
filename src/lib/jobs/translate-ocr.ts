/**
 * OCR inside Translate PDF (audit translate-pdf#3, 2026-11-09) — the words,
 * the rule for mixed documents, and the price, in ONE client-safe place, so
 * the panel, the route, the FAQ and the guide state the same thing.
 *
 * ── WHEN IT RUNS ────────────────────────────────────────────────────────────
 *
 * OCR runs only when the WHOLE document has no selectable text — the
 * worker's own extractor finds none (`hasTranslatableText`). A mixed document
 * (some pages typed, some scanned) is translated from the pages with text and
 * its scanned pages are not read, exactly as before: recognising only some
 * pages would mean OCR's "already has a text layer" refusal, or a second
 * layer over pages that have one, and PDF to Word's switch draws the same
 * line. {@link TRANSLATE_OCR_SCOPE} says that to the reader.
 *
 * ── WHAT THE PAGE CAN KNOW ──────────────────────────────────────────────────
 *
 * Whether the running worker can do it is DYNAMIC (its heartbeat), and the
 * FAQ is static. So nothing static here says it is available: the static
 * sentences say what the page DOES — offers it when our server can, refuses
 * the scan before upload when it cannot — which is true either way.
 *
 * ── THE PRICE ───────────────────────────────────────────────────────────────
 *
 * A scan's text cannot be counted until it has been recognised, so a scan is
 * submitted with no declared count and charged what any undeclared job is
 * charged ({@link TRANSLATE_OCR_CHARGE}; {@link TRANSLATE_OCR_CHARGE_PUBLISHED}
 * in the page's unit). That same reservation is the delivery cap the worker
 * applies to the RECOGNISED text before any provider call: pages past it are
 * withheld and marked in place, never sent.
 */

import {
  AI_CHARACTER_ALLOWANCE_DELIVERED,
  AI_UNDECLARED_JOB_CHARGE,
} from "./ai-allowance";
import { TRANSLATE_EXTRACTOR_HEADROOM } from "./translate-limits";
import {
  OCR_LANGUAGES,
  PDF_TO_WORD_OCR_LANGUAGE_CODES,
  type OcrLanguage,
} from "./ocr";
import { LANGUAGE_NAMES, type TranslateLanguage } from "./translate-pdf";

/**
 * What a scan's job is charged, in the BUCKET's unit (worker-extracted
 * characters) — and the delivery cap the worker applies to the recognised
 * text. Not for copy: the page states the allowance in the reader's unit.
 */
export const TRANSLATE_OCR_CHARGE = AI_UNDECLARED_JOB_CHARGE;

/**
 * The same charge in the unit the page publishes the daily allowance in
 * (browser-counted characters, `AI_CHARACTER_ALLOWANCE_DELIVERED`): the bucket
 * is that figure times the extractor headroom, so this is the charge divided
 * by it. A first draft quoted the bucket's 41,032 beside a published 30,774 —
 * a scan "costing" more than the whole day — which is the unit mistake
 * `ai-allowance.ts` records twice already.
 */
export const TRANSLATE_OCR_CHARGE_PUBLISHED =
  TRANSLATE_OCR_CHARGE / TRANSLATE_EXTRACTOR_HEADROOM;

const CHARGE = TRANSLATE_OCR_CHARGE_PUBLISHED.toLocaleString("en-US");
const DAY = AI_CHARACTER_ALLOWANCE_DELIVERED.toLocaleString("en-US");

/** Which documents OCR runs on — the mixed-document rule, in the reader's words. */
export const TRANSLATE_OCR_SCOPE =
  "Only a PDF with no selectable text on any page is recognised; in a PDF that mixes typed and scanned pages, the typed pages are translated and the scanned ones are not read.";

/**
 * What the panel checks to call a file a scan. A heuristic, so it says what
 * it checks: the text layer the browser can read, not whether pages look
 * like photographs.
 */
export const TRANSLATE_SCAN_CHECK =
  "Your browser found no selectable text on any page of this PDF, so it looks like a scan or a picture of pages.";

/** The honest sentence shown with the language picker, before Run. */
export const TRANSLATE_OCR_EXPLAINER = `Our server recognises the scan's text first (OCR), then translates it, which takes longer than a typed PDF. Pick every language printed on the page: the wrong one gives wrong text, not an error. A scan's length cannot be counted before it is recognised, so it is charged as one full pass, ${CHARGE} of the ${DAY} characters in the daily AI allowance, and the translation stops at what that pays for; any pages past it are marked in place.`;

/**
 * The recognition pack for a Translate source language, or `null` when OCR
 * inside Translate offers none (Arabic: right-to-left, refused as in PDF to
 * Word). Matched by the language's NAME, which both catalogues spell the
 * same — not through `ocr-browser-languages`, whose module is first-load on
 * OCR PDF and would gain an importer (the concatenation cost recorded in
 * memory). `translate-ocr.test.ts` holds this equal to the BCP-47 map for
 * every Translate language.
 */
export function translateSourceOcrPack(
  source: TranslateLanguage,
): OcrLanguage | null {
  const pack = OCR_LANGUAGES.find(
    (language) => language.label === LANGUAGE_NAMES[source],
  )?.code;
  return pack && PDF_TO_WORD_OCR_LANGUAGE_CODES.includes(pack) ? pack : null;
}

/**
 * Said beside the picker when the reader set a Source language whose pack is
 * not selected (review finding, 2026-11-09): OCR in the wrong language does
 * not fail, it returns fluent nonsense that is then translated and charged.
 */
export function translateOcrSourceNotSelected(name: string): string {
  return `The source language is ${name}, but ${name} is not among the recognition languages selected below. Add it if the scan is printed in ${name}: the wrong language gives wrong text, not an error.`;
}

/** The same, when the running worker has no pack for that language at all. */
export function translateOcrSourceNotInstalled(name: string): string {
  return `The source language is ${name}, but our server has no recognition pack for ${name}, so a scan printed in it cannot be read correctly here.`;
}

/** The same, when the language is one OCR inside Translate does not offer. */
export function translateOcrSourceNotOffered(name: string): string {
  return `The source language is ${name}, but ${name} is not offered for recognising a scan here, so a scan printed in it cannot be read correctly.`;
}

/**
 * How a scan is handled, in ONE static sentence that is true whether or not
 * the running worker can recognise scans today — the page cannot know that
 * when it is rendered, so it says what the panel DOES in each case. Read by
 * the Translate page's FAQ and use case and by the translate guide.
 */
export const TRANSLATE_SCAN_ROUTE =
  "A scan has no selectable text. When our server can recognise text in scans, Translate PDF asks which languages are printed on the page, recognises the text on our server (OCR) and then translates it; when it cannot, the page says so before anything uploads, and the scan can go through OCR PDF first.";

/** What a scan costs, for static copy, in the page's unit. */
export const TRANSLATE_OCR_CHARGE_SENTENCE = `A scan is charged as one full pass, ${CHARGE} of the ${DAY} characters in the daily AI allowance, because its length is unknown until it is recognised.`;

/**
 * The route's refusal when a job asks for OCR and the running worker has not
 * proved it can (`translateOcr` and `ocr` on a fresh heartbeat). Said BEFORE
 * the allowance is charged — the upload has already happened, so it does not
 * claim otherwise: an older worker would ignore the request and refuse the
 * scan as having no text, keeping the charge.
 */
/**
 * The route's refusal when a job asks OCR for a language the running worker's
 * fresh heartbeat does not report installed. Said BEFORE the allowance is
 * charged: OCR's own installed-pack check on the worker would refuse the job
 * before any work, and nothing gives the reservation back after a worker
 * failure. Names only the missing languages, so the reader knows what to drop.
 * Takes the NAMES (the route maps codes with `describeOcrLanguage`), so this
 * client-safe module does not import the OCR catalogue.
 */
export function translateOcrMissingPacksMessage(
  missingNames: readonly string[],
): string {
  return `Our server can't recognise ${missingNames.join(", ")} in scans right now, so no translation job was created and nothing was charged. Choose only languages listed on the page and try again.`;
}

export const TRANSLATE_OCR_NOT_RUNNING_MESSAGE =
  "Our server can't recognise scans inside Translate PDF right now, so no translation job was created and nothing was charged. Run the scan through OCR PDF first, then translate the PDF it returns.";

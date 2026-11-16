/**
 * What a truncated document window actually contains — computed once, so all
 * three AI tools disclose the same thing in the same words.
 *
 * Every tool that sends a PDF's text to a model caps it at
 * `DEFAULT_MAX_INPUT_CHARS` and sends `sourceText.slice(0, maxChars)`. Three
 * things were true of that slice and none of them reached anyone who could act
 * on it:
 *
 *  - **The model was not told.** chat-with-pdf is instructed to answer "The
 *    document does not state this." when it cannot find something, so a
 *    question about page 400 of a 400-page contract got a confident denial
 *    about a document that does say it. summarize called its summary of the
 *    first pages "the document". ai-extract reported a field as absent when it
 *    was merely past the cut.
 *  - **The user was not told where it stopped.** The ZIP manifest carried
 *    `truncatedToCharacters`, which is a number nobody can act on. "Up to page
 *    131" is a sentence they can.
 *  - **The cut lands mid-page and usually mid-sentence.** `slice()` counts
 *    characters, not pages, so the last page in the window is a fragment and a
 *    model may answer from half a clause.
 *
 * Measured (2026-08-10, pdf-lib fixtures through pdfjs, grounding assembled as
 * the engines assemble it) — how many pages 500,000 characters buys:
 *
 *     sparse (contract/report)     1,718 chars/page  ->  ~290 pages
 *     ordinary prose               3,794 chars/page  ->  ~131 pages
 *     dense (legal/technical)      6,158 chars/page  ->   ~81 pages
 *
 * A dense 81-page contract is already at the cap. This is not an edge case.
 *
 * CHAT IS THE EXCEPTION since slice 3 (audit #30): when its page-labelled text
 * does not fit, it may send pages chosen for the question instead of a prefix
 * (`@/lib/pdf/page-retrieval`). That window is described by
 * {@link describeSelection} and carries `selection: "relevance"` with the
 * pages sent; both notices then name those pages and never "pages 1–N".
 *
 * BUNDLE: `truncation-notice.tsx` (`"use client"`) imports this module, so
 * whatever it imports ships in every AI panel's chunk. It imports only the
 * dependency-free `page-spans` leaf, never `page-retrieval`.
 */
import type { AiWindowMeta } from "@/lib/jobs/ai-results";
import {
  chosenSpans,
  formatPageSpans,
  formatSpans,
  pagesIn,
  pagesPhrase,
  type PageSpan,
} from "@/lib/pdf/page-spans";

/**
 * What the model saw, in terms a person can act on.
 *
 * Deliberately the SAME type the job record carries to the browser
 * ({@link AiWindowMeta}), not a parallel one: the model's prompt, the packaged
 * manifest, and the panel notice are three renderings of one fact, and two
 * structurally-identical types are how they start disagreeing.
 */
export type TruncationWindow = AiWindowMeta;

/**
 * A window over an untruncated document: everything, nothing to disclose.
 * With a page selection (Summarize's page range) it carries the pages the
 * person chose as `pagesSent`: all of them went, blank ones included (they
 * were chosen, and all of their zero characters were sent).
 */
function whole(
  text: string,
  totalPages: number,
  selection?: readonly PageSpan[],
): TruncationWindow {
  return {
    truncated: false,
    charactersSent: text.length,
    charactersTotal: text.length,
    totalPages,
    lastCompletePage: totalPages || null,
    cutMidPage: false,
    ...(selection ? { pagesSent: selection.map(copySpan) } : {}),
  };
}

const copySpan = ([first, last]: PageSpan): [number, number] => [first, last];

/**
 * A selection clipped at page `upTo`: every span that starts at or before it,
 * the last one ending at `upTo` at the latest. Pages are REAL page numbers,
 * so a clip at page 5 keeps a blank page 4 inside the selection (it was
 * chosen and lies before the cut) and drops everything after page 5.
 */
function clipSelection(
  selection: readonly PageSpan[],
  upTo: number,
): [number, number][] {
  const clipped: [number, number][] = [];
  for (const [first, last] of selection) {
    if (first > upTo) break;
    clipped.push([first, Math.min(last, upTo)]);
  }
  return clipped;
}

/** A page, where its text starts in the assembled string, and how long it is. */
export interface PageStart {
  readonly pageNumber: number;
  readonly offset: number;
  /** Length of this page's text. Carried so the table can be checked against
   * the string it claims to index — see {@link tableDescribes}. */
  readonly length: number;
}

/**
 * Does this offset table actually describe THIS string?
 *
 * The table is built from the per-page chunks; the string being sliced arrives
 * separately (`extracted.text.trim()`). They agree in the real pipeline — and if
 * anything ever shifts one relative to the other (a leading trim, a different
 * join, an extractor whose `text` is not `joinPageTexts(pages)`), every offset
 * is wrong by that shift and the notice names a page confidently and wrongly.
 * That is worse than the number being absent, so it is checked rather than
 * assumed: the last page must end exactly where the string ends.
 *
 * WHAT IT DOES NOT COVER. This is a total-length identity, so it catches any
 * shift that changes the total — a leading trim, a different separator, an
 * extractor whose `text` is not `joinPageTexts(pages)`. It would NOT catch a
 * re-join that preserves the total length while moving interior boundaries
 * (say, a separator that grew by one character between two pages and shrank by
 * one between two others). No such assembly exists in this codebase and the
 * check is deliberately not paid for; the limit is recorded so nobody reads
 * this as a proof that every offset is right.
 */
function tableDescribes(assembled: string, starts: readonly PageStart[]) {
  const last = starts[starts.length - 1];
  if (!last) return false;
  return last.offset + last.length === assembled.length;
}

/**
 * Describe the window a `slice(0, maxChars)` produces.
 *
 * `starts` carries REAL page numbers, not indices. Pages with no text are
 * dropped before joining, so the third chunk may be page 5 — assuming
 * index + 1 would name a page the user could go and check and find wrong,
 * which is a new confident false claim replacing the old one.
 *
 * `selection` (Summarize's page range, canonical spans) is the pages the
 * person chose; `assembled` and `starts` must then be built from those pages
 * only. The window carries `pagesSent`: the whole selection when it fits;
 * when truncated, the selection clipped at the last page whose text STARTED
 * before the cut (that page's own number, never a chunk position); and
 * nothing at all when the table does not describe the string, so the panel
 * reads "not confirmed" rather than a page list derived from a wrong table.
 * Without `selection` the result is exactly what it was before, field for
 * field: chat, ai-extract and translate never pass one.
 */
export function describeWindow(
  assembled: string,
  starts: readonly PageStart[],
  totalPages: number,
  maxChars: number,
  selection?: readonly PageSpan[],
): TruncationWindow {
  if (assembled.length <= maxChars)
    return whole(assembled, totalPages, selection);

  // No usable table ⇒ disclose the truncation but name no page. "The first part
  // of a 400-page document" is honest; a page number derived from a table that
  // does not index this string is not.
  if (!tableDescribes(assembled, starts)) {
    return {
      truncated: true,
      charactersSent: maxChars,
      charactersTotal: assembled.length,
      totalPages,
      lastCompletePage: null,
      cutMidPage: false,
    };
  }

  // The last page whose text STARTS before the cut is the page the cut fell
  // inside; the one before it is the last page present in full.
  let lastStartedIndex = -1;
  for (let i = 0; i < starts.length; i += 1) {
    if (starts[i]!.offset < maxChars) lastStartedIndex = i;
    else break;
  }

  // …UNLESS the cut fell after that page's last character — on the page
  // boundary, or in the separator after it. A cut made BY page (a declared page
  // bound) lands exactly there, and "the text ends mid-page" about a page that
  // is present in full would understate what the model holds by a page — a
  // page number the user can check and find wrong.
  const lastStarted = lastStartedIndex >= 0 ? starts[lastStartedIndex]! : null;
  // The chosen pages that reached the model: clipped at the last STARTED
  // page's own number. No page started (a zero-character cut) names none.
  const chosen =
    selection && lastStarted
      ? { pagesSent: clipSelection(selection, lastStarted.pageNumber) }
      : {};
  if (lastStarted && lastStarted.offset + lastStarted.length <= maxChars) {
    return {
      truncated: true,
      charactersSent: maxChars,
      charactersTotal: assembled.length,
      totalPages,
      lastCompletePage: lastStarted.pageNumber,
      cutMidPage: false,
      ...chosen,
    };
  }

  const lastComplete =
    lastStartedIndex >= 1 ? starts[lastStartedIndex - 1]!.pageNumber : null;

  return {
    truncated: true,
    charactersSent: maxChars,
    charactersTotal: assembled.length,
    totalPages,
    lastCompletePage: lastComplete,
    cutMidPage: lastStartedIndex >= 0,
    ...chosen,
  };
}

/**
 * Describe a window of pages chosen for the question (chat page retrieval).
 * One function for the prompt, the manifest and the meta, so the three
 * cannot disagree. `pages` are REAL page numbers; `cutPage`, when set, is the
 * highest of them (the selector guarantees it, and the notices say "the last
 * of them cut mid-page"). There is no prefix, so `lastCompletePage` is null.
 */
export function describeSelection(
  totalChars: number,
  sentChars: number,
  totalPages: number,
  pages: readonly number[],
  cutPage: number | null,
): TruncationWindow {
  const { spans } = formatPageSpans(pages);
  return {
    truncated: true,
    charactersSent: sentChars,
    charactersTotal: totalChars,
    totalPages,
    lastCompletePage: null,
    cutMidPage: cutPage !== null,
    selection: "relevance",
    pagesSent: spans,
    pagesRead: spans.reduce((sum, [a, b]) => sum + b - a + 1, 0),
  };
}

/** The relevance path of {@link modelTruncationNotice}, supplied by chat. */
export interface SelectionNoticeParts {
  /** How the pages were chosen, e.g. "the opening pages and pages chosen by …". */
  chosenBy: string;
  /** The revocation for a non-contiguous window ("the answer may appear later" is false). */
  revocation: string;
}

/** The pages a relevance window names, or null when it carries no usable list. */
function selectionSpans(
  window: TruncationWindow,
): readonly (readonly [number, number])[] | null {
  if (window.selection !== "relevance") return null;
  const spans = window.pagesSent;
  return spans && spans.length > 0 ? spans : null;
}

/** Page starts for chunks joined by `separator`, preserving each page's number. */
export function pageStartsFor(
  chunks: readonly { pageNumber: number; text: string }[],
  separator: string,
): PageStart[] {
  const starts: PageStart[] = [];
  let at = 0;
  for (const chunk of chunks) {
    starts.push({
      pageNumber: chunk.pageNumber,
      offset: at,
      length: chunk.text.length,
    });
    at += chunk.text.length + separator.length;
  }
  return starts;
}

/**
 * The block appended to a model's system prompt when the window is short.
 *
 * Two jobs, and only the first is tool-agnostic:
 *
 *  1. **State the bound** — which pages the model actually holds.
 *  2. **Revoke the instruction that turns the bound into a false claim** — and
 *     that instruction is different for every tool, which is why `revocation`
 *     is a required argument rather than a default. Chat is told to answer from
 *     the document, so it denies. A summarizer is told to output a summary, so
 *     it presents a partial one as the summary. A translator is told to output
 *     only the translation with no commentary, so it hands back a fifth of a
 *     document with nothing marking where it stops. Same bound, three different
 *     wrong claims, and a prompt that revokes the wrong one is noise: telling a
 *     translator "do NOT say the document does not contain it" is a sentence
 *     about an answer it was never asked to give.
 *
 * `revocation` receives the bound phrase so it can name the pages itself.
 *
 * A RELEVANCE window (chat only) names its pages ("pages 1–3, 60 of 70") and,
 * when the caller passes `selection`, says how they were chosen and uses the
 * caller's relevance revocation instead. The prefix path is untouched by the
 * third argument, byte for byte: summarize, translate and ai-extract never
 * pass it and never produce a relevance window.
 */
export function modelTruncationNotice(
  window: TruncationWindow,
  revocation: (upTo: string) => string,
  selection?: SelectionNoticeParts,
): string {
  const chosen = chosenSpans(window);
  if (chosen) return chosenPagesModelNotice(window, chosen, revocation);
  if (!window.truncated) return "";
  const spans = selectionSpans(window);
  if (spans) {
    const covers = `pages ${formatSpans(spans)} of ${window.totalPages}`;
    const last = spans[spans.length - 1]![1];
    const cut = window.cutMidPage
      ? ` The text of page ${last} ends mid-page.`
      : "";
    return [
      "",
      "IMPORTANT — YOU ARE SEEING ONLY PART OF THIS DOCUMENT.",
      `The text above covers ${covers}${selection ? `: ${selection.chosenBy}` : ""}; other pages were not sent because of a length limit.${cut}`,
      selection ? selection.revocation : revocation(covers),
    ].join("\n");
  }
  const upTo =
    window.lastCompletePage !== null
      ? `pages 1-${window.lastCompletePage} of ${window.totalPages}`
      : `the first part of ${window.totalPages} pages`;
  const fragment = window.cutMidPage
    ? " The text ends mid-page and may break mid-sentence."
    : "";
  return [
    "",
    "IMPORTANT — YOU ARE SEEING ONLY PART OF THIS DOCUMENT.",
    `The text above covers ${upTo}; the rest was not sent because of a length limit.${fragment}`,
    revocation(upTo),
  ].join("\n");
}

/** The one-line disclosure a UI shows beside the result, from `meta` alone. */
export function userTruncationNotice(window: TruncationWindow): string {
  if (!window.truncated) return "";
  // The pages a person chose, cut by the limit: name the chosen pages that
  // were read, never "pages 1–N" of a document they did not ask about.
  const chosen = chosenSpans(window);
  if (chosen) {
    const fragment = window.cutMidPage ? ", cut mid-page" : "";
    return `Only ${pagesPhrase(chosen)} of the pages you chose could be read${fragment} — they hold more text than the limit, so anything after that was not considered.`;
  }
  // A relevance window is FACT ONLY: which pages were read, never why (the
  // why is a claim about the worker's algorithm, made only where the worker's
  // capability was observed). It never says "pages 1–N": page 60 is not part
  // of the first part.
  if (window.selection === "relevance") {
    const lead = "This document is longer than one question can read, so";
    const spans = selectionSpans(window);
    if (!spans)
      return `${lead} only some of its ${window.totalPages} pages were read.`;
    const read = spans.reduce((sum, [a, b]) => sum + b - a + 1, 0);
    const single = read === 1;
    const fragment = window.cutMidPage
      ? single
        ? ", cut mid-page"
        : ", the last of them cut mid-page"
      : "";
    return `${lead} ${read} of its ${window.totalPages} pages ${single ? "was" : "were"} read: ${single ? "page" : "pages"} ${formatSpans(spans)}${fragment}. Pages not listed were not sent.`;
  }
  const upTo =
    window.lastCompletePage !== null
      ? `pages 1–${window.lastCompletePage} of ${window.totalPages}`
      : `the first part of this ${window.totalPages}-page document`;
  const fragment = window.cutMidPage ? ", cut mid-page" : "";
  return `Only ${upTo} could be read${fragment} — this document is longer than the limit, so anything after that was not considered.`;
}

// ---------------------------------------------------------------------------
// The pages a PERSON chose (Summarize's page range)
// ---------------------------------------------------------------------------

/**
 * The model notice for a window over pages a person chose. Unlike a prefix
 * window it is given EVEN WHEN NOT TRUNCATED: the model holds part of the
 * document either way, and a summarizer that is not told so calls its
 * summary of pages 3–5 a summary of the document. The bound phrase handed to
 * `revocation` names the chosen pages, so Summarize's "This summarises …"
 * names them too.
 */
function chosenPagesModelNotice(
  window: TruncationWindow,
  spans: readonly PageSpan[],
  revocation: (upTo: string) => string,
): string {
  const covers = `${pagesPhrase(spans)} of ${window.totalPages}`;
  const chose = pagesIn(spans) === 1 ? "the page" : "the pages";
  const truncation = window.truncated
    ? ` The chosen pages hold more text than the length limit, so the text stops early${window.cutMidPage ? " and may break mid-sentence" : ""}.`
    : "";
  return [
    "",
    "IMPORTANT — YOU ARE SEEING ONLY PART OF THIS DOCUMENT.",
    `The text above covers ${covers}, ${chose} the user chose; no other page was sent.${truncation}`,
    revocation(covers),
  ].join("\n");
}

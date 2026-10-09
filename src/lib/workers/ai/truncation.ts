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
 */
import type { AiWindowMeta } from "@/lib/jobs/ai-results";

/**
 * What the model saw, in terms a person can act on.
 *
 * Deliberately the SAME type the job record carries to the browser
 * ({@link AiWindowMeta}), not a parallel one: the model's prompt, the packaged
 * manifest, and the panel notice are three renderings of one fact, and two
 * structurally-identical types are how they start disagreeing.
 */
export type TruncationWindow = AiWindowMeta;

/** A window over an untruncated document: everything, nothing to disclose. */
function whole(text: string, totalPages: number): TruncationWindow {
  return {
    truncated: false,
    charactersSent: text.length,
    charactersTotal: text.length,
    totalPages,
    lastCompletePage: totalPages || null,
    cutMidPage: false,
  };
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
 */
export function describeWindow(
  assembled: string,
  starts: readonly PageStart[],
  totalPages: number,
  maxChars: number,
): TruncationWindow {
  if (assembled.length <= maxChars) return whole(assembled, totalPages);

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
  if (lastStarted && lastStarted.offset + lastStarted.length <= maxChars) {
    return {
      truncated: true,
      charactersSent: maxChars,
      charactersTotal: assembled.length,
      totalPages,
      lastCompletePage: lastStarted.pageNumber,
      cutMidPage: false,
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
  };
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
 */
export function modelTruncationNotice(
  window: TruncationWindow,
  revocation: (upTo: string) => string,
): string {
  if (!window.truncated) return "";
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
  const upTo =
    window.lastCompletePage !== null
      ? `pages 1–${window.lastCompletePage} of ${window.totalPages}`
      : `the first part of this ${window.totalPages}-page document`;
  const fragment = window.cutMidPage ? ", cut mid-page" : "";
  return `Only ${upTo} could be read${fragment} — this document is longer than the limit, so anything after that was not considered.`;
}

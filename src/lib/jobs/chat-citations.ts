/**
 * The `[p.N]` citation grammar, shared by the two places that read an answer
 * (audit #30, chat-with-pdf#3, 2026-11-15):
 *
 *  - the worker (`workers/chat-with-pdf/engine.ts`) counts it into
 *    manifest.answer.citedPages and the "Cited pages" line;
 *  - the chat panel (`components/tools/citation-buttons.tsx`) turns the same
 *    markers into buttons that show the cited page.
 *
 * ONE grammar, so a button can never open a page the manifest does not list
 * and a listed page can never be missing its button. Pure: no node, worker or
 * React imports, because both tiers load it. The single definition is pinned
 * by `src/lib/tools/citation-grammar-single.test.ts`.
 */

/**
 * A bracket that opens with `p`/`pp`. GLOBAL, so it carries `lastIndex`: every
 * walk below makes a fresh copy rather than sharing this one's state.
 */
const CITATION_BRACKET = /\[(pp?\.?\s*[^\[\]]{1,80})\]/gi;
/** One comma- or semicolon-separated item: a page or a range, `p.` optional. */
const CITATION_ITEM = /^(?:pp?\.?\s*)?(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?$/i;

/** Every bracket match in `answer`, from a fresh regex (no shared lastIndex). */
function brackets(answer: string): RegExpExecArray[] {
  const bracket = new RegExp(CITATION_BRACKET.source, CITATION_BRACKET.flags);
  const found: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = bracket.exec(answer)) !== null) found.push(match);
  return found;
}

/**
 * The in-range pages one bracket's inner text names, sorted and unique. A
 * range is walked only inside the page range, so a wild `[pp. 1-99999]` costs
 * at most `pageCount` steps.
 */
function pagesInBracket(inner: string, pageCount: number): number[] {
  const cited = new Set<number>();
  for (const part of inner.split(/[,;]/)) {
    const one = CITATION_ITEM.exec(part.trim());
    if (!one) continue;
    const from = Number(one[1]);
    const to = one[2] === undefined ? from : Number(one[2]);
    if (to < from) continue;
    for (let page = Math.max(from, 1); page <= Math.min(to, pageCount); page++)
      cited.add(page);
  }
  return [...cited].sort((a, b) => a - b);
}

/**
 * Distinct pages the answer cited, within the document's real page range.
 *
 * The prompt asks for `[p.N]`, but models also group pages — `[p.3, p.5]`,
 * `[p.3, 5]`, `[pp. 3-4]` — and until 2026-11-06 (audit #41) only the single
 * form matched, so a grouped citation vanished from `citedPages` and the
 * "Cited pages" line. A bracket counts when it opens with `p`/`pp`; each
 * comma- or semicolon-separated item is a page or a range, its own `p.`
 * prefix optional. A range is walked only inside the page range, so a wild
 * `[pp. 1-99999]` costs at most `pageCount` steps.
 *
 * Moved here from `workers/chat-with-pdf/engine.ts` on 2026-11-15 (audit
 * #30) so the chat panel reads citations with the same grammar; the worker's
 * output is unchanged.
 */
export function citedPagesIn(answer: string, pageCount: number): number[] {
  const cited = new Set<number>();
  for (const match of brackets(answer))
    for (const page of pagesInBracket(match[1]!, pageCount)) cited.add(page);
  return [...cited].sort((a, b) => a - b);
}

/** A run of the answer: plain text, or a marker that cites in-range pages. */
export type CitationSegment =
  | { kind: "text"; text: string }
  | { kind: "cite"; text: string; pages: number[] };

/**
 * The answer split into text and citations, losing nothing:
 * `segments.map((s) => s.text).join("") === answer`. A bracket that names at
 * least one in-range page becomes a cite whose text is the WHOLE bracket,
 * `[` and `]` included; a bracket that names none (`[p.9]` on a 3-page file,
 * `[Page 3]`) stays text. The union of the cites' pages is exactly
 * {@link citedPagesIn}, because both walk {@link pagesInBracket}.
 */
export function citationSegments(
  answer: string,
  pageCount: number,
): CitationSegment[] {
  const segments: CitationSegment[] = [];
  let at = 0;
  const text = (to: number) => {
    if (to <= at) return;
    const run = answer.slice(at, to);
    const last = segments[segments.length - 1];
    if (last?.kind === "text") last.text += run;
    else segments.push({ kind: "text", text: run });
    at = to;
  };
  for (const match of brackets(answer)) {
    const pages = pagesInBracket(match[1]!, pageCount);
    if (pages.length === 0) continue;
    text(match.index);
    segments.push({ kind: "cite", text: match[0], pages });
    at = match.index + match[0].length;
  }
  text(answer.length);
  return segments;
}

/**
 * A cited physical page (1-based, as `[p.N]` counts) as the renderer's 0-based
 * page index. The ONLY place that conversion is made.
 */
export function citedPageIndex(page: number): number {
  return page - 1;
}

/**
 * Running lines: what a document repeats at the edge of its pages — a page
 * number, a running title, a company name on every page's top line. They
 * are only CANDIDATES for "Ignore page headers and numbers": what the
 * comparison sets aside is decided against the other document, in
 * `furniture.ts`, and this module never drops a line on its own.
 *
 * Only a page's EDGE lines are candidates (its first two and last two), so a
 * body sentence that quotes "Page 3 of 40" is never one. Each candidate
 * carries the KEY it repeats under, and a key must repeat on at least
 * {@link RECURRENCE_FLOOR} text pages and either {@link RECURRENCE_SHARE} of
 * them or {@link RECURRENCE_RUN} consecutive ones (the run is what finds a
 * chapter's running head in a 500-page book). The keys:
 *
 * - a page number by form ({@link RUNNING_PATTERNS}: "Page 3 of 40", "3 /
 *   40", "- 3 -", a bare "3"), keyed by how far its number is from the
 *   page's own — so it repeats only when the numbers TRACK the pages, the
 *   same distance on every page (a book numbered from after its cover);
 * - the line's text, word for word (in the comparison's key, so case
 *   counts unless "Ignore case" is on);
 * - the text with one number folded — at its start or end and set apart by
 *   a delimiter ("Annual report · 3"), or after "page" — tagged with the
 *   same distance from the page, so it repeats only when that number tracks
 *   the page.
 *
 * Until 2026-11-14 the recurrence test folded EVERY run of digits into `#`
 * (history kept): "Balance carried forward: 3000.00" then matched page 4's
 * "4000.00", every one of them was dropped, and a changed balance compared
 * as identical. AMENDED again 2026-11-14 (second review): a page-number
 * form counted on its form alone, on ONE page ("2 / 3" closing a vote tally
 * on page 2 of 3), and a candidate was dropped without asking the other
 * document — so a header that named a different party on both sides was
 * dropped from both, and the comparison said identical
 * (`furniture.test.ts`). Page numbers recur now like everything else, and
 * the decision moved to `furniture.ts`.
 *
 * `running-lines.test.ts` holds both directions with a corpus: every line
 * that must be a candidate is one, every line that must not is not, and
 * every pattern here catches a corpus line.
 */

/** How many lines at the top and at the bottom of a page are candidates. */
export const EDGE_LINES = 2;

/** The share of text pages a line must repeat on, or ... */
export const RECURRENCE_SHARE = 0.4;
/** ... the run of consecutive text pages it must repeat on instead. */
export const RECURRENCE_RUN = 3;
/** And in either case at least this many pages: one page repeats nothing. */
export const RECURRENCE_FLOOR = 2;

/**
 * Page-number forms, matched against a line's SHAPE (digits → `#`). A line
 * of one of these forms is keyed by its number's distance from the page,
 * so it is a candidate only where that distance repeats.
 */
export const RUNNING_PATTERNS: readonly { re: RegExp }[] = [
  { re: /^page\s*#(?:\s*(?:of|\/)\s*#)?$/i },
  { re: /^[-–]\s*#\s*[-–]$/ },
  { re: /^#(?:\s*(?:of|\/)\s*#)?$/i },
];

const ROMAN: Record<string, number> = {
  i: 1,
  v: 5,
  x: 10,
  l: 50,
  c: 100,
  d: 500,
  m: 1000,
};

function romanValue(text: string): number {
  let total = 0;
  const s = text.toLowerCase();
  for (let i = 0; i < s.length; i += 1) {
    const v = ROMAN[s[i]!]!;
    const next = ROMAN[s[i + 1] ?? ""] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

/** A roman numeral after "page" as its arabic value: "Page iv" → "Page 4". */
function arabic(text: string): string {
  return text.replace(
    /\b(page\s*)([ivxlcdm]+)\b/gi,
    (_, page: string, roman: string) => `${page}${romanValue(roman)}`,
  );
}

/** A line's shape: digit runs, and a roman numeral after "page", as `#`. */
export function runningShape(text: string): string {
  return arabic(text).replace(/\d+/g, "#").toLowerCase();
}

const EDGE_PUNCT = /^[\s\p{P}\p{S}]*$/u;
/**
 * What sets a page number apart from a running head's words: "Annual
 * report · 3", "3 | Acme Corp". A number joined to the words by a space
 * alone ("Transactions for week 3") or by a decimal point is not folded.
 */
const DELIMITER_BEFORE = /[|·•—–\-/:]\s*$/u;
const DELIMITER_AFTER = /^\s*[|·•—–\-/:]/u;

/**
 * The keys a line repeats under, in the order they are tried: its page
 * number's distance from the page if it has a page number's form, its text,
 * and for each number that could be a page number — at the line's start or
 * end and set apart by a delimiter, or after "page" — the text with that
 * number folded, tagged with how far the number is from the page's own.
 * Two lines share a folded key only when that number moves with the page.
 */
function repeatKeys(text: string, page: number): string[] {
  const keys: string[] = [];
  const shape = runningShape(text);
  if (RUNNING_PATTERNS.some(({ re }) => re.test(shape))) {
    const first = /\d+/.exec(arabic(text));
    if (first) keys.push(`\u0001${Number(first[0]) - page}`);
  }
  keys.push(text);
  const line = arabic(text);
  for (const m of line.matchAll(/\d+/g)) {
    const before = line.slice(0, m.index);
    const after = line.slice(m.index + m[0].length);
    if (
      (EDGE_PUNCT.test(after) && DELIMITER_BEFORE.test(before)) ||
      (EDGE_PUNCT.test(before) && DELIMITER_AFTER.test(after)) ||
      /\b(?:page|p\.|pg\.?)\s*$/i.test(before)
    ) {
      const offset = Number(m[0]) - page;
      keys.push(`${before}#${after}\u0000${offset}`);
    }
  }
  return keys;
}

/**
 * The running lines of one document, each with the key it repeats under:
 * index into `lines` → key. `lines` are the document's comparable lines in
 * order, each with the page it sits on; `text` is what is matched, so pass
 * the comparison key.
 */
export function runningLines(
  lines: readonly { text: string; page: number }[],
): Map<number, string> {
  const byPage = new Map<number, number[]>();
  lines.forEach((line, i) => {
    const on = byPage.get(line.page);
    if (on) on.push(i);
    else byPage.set(line.page, [i]);
  });
  // Each text page's place in reading order, for the consecutive-run test.
  const rank = new Map([...byPage.keys()].map((page, r) => [page, r]));

  const edges: number[] = [];
  for (const indices of byPage.values()) {
    const picked = new Set([
      ...indices.slice(0, EDGE_LINES),
      ...indices.slice(-EDGE_LINES),
    ]);
    edges.push(...picked);
  }

  const keysOf = new Map<number, string[]>();
  const ranksOfKey = new Map<string, Set<number>>();
  for (const i of edges) {
    const { text, page } = lines[i]!;
    const keys = repeatKeys(text, page);
    keysOf.set(i, keys);
    for (const key of keys) {
      const ranks = ranksOfKey.get(key) ?? new Set<number>();
      ranks.add(rank.get(page)!);
      ranksOfKey.set(key, ranks);
    }
  }
  const share = Math.ceil(RECURRENCE_SHARE * byPage.size);
  const repeats = (ranks: Set<number>): boolean => {
    if (ranks.size < RECURRENCE_FLOOR) return false;
    if (ranks.size >= share) return true;
    const sorted = [...ranks].sort((x, y) => x - y);
    let run = 1;
    for (let k = 1; k < sorted.length; k += 1) {
      run = sorted[k] === sorted[k - 1]! + 1 ? run + 1 : 1;
      if (run >= RECURRENCE_RUN) return true;
    }
    return false;
  };

  const running = new Map<number, string>();
  for (const i of edges) {
    const key = keysOf.get(i)!.find((k) => repeats(ranksOfKey.get(k)!));
    if (key !== undefined) running.set(i, key);
  }
  return running;
}

/** The indices of {@link runningLines}, without their keys. */
export function detectRunningLines(
  lines: readonly { text: string; page: number }[],
): Set<number> {
  return new Set(runningLines(lines).keys());
}

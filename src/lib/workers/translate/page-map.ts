/**
 * Reading the page markers back out of a reply.
 *
 * A marked chunk is sent with `separatorFor(n)` (`./page-markers`) between its
 * pages. When the reply carries every marker back, in order, on lines of their
 * own, it is split at them and the PDF heads each piece "Page N". When it does
 * not, the chunk FALLS BACK: the reply is still the model's whole translation,
 * still in order, with the markers removed. Only page identity inside the
 * chunk is unknown, so the PDF names the range, as it did before markers
 * existed. A fallback is never a job failure and never a retry: a second paid
 * call to repair labels would spend the user's allowance on our furniture.
 *
 * WORKER-ONLY. Imported by the engine, never by `./chunking` or `./preflight`,
 * so none of this reaches the browser.
 *
 * ── TWO PATTERNS, KEPT APART ────────────────────────────────────────────────
 *
 * MARKER LINE (recognition, strict on the word). After NFKC and after
 * trimming whitespace and bidi/format characters, the line is
 * `<{1,3} PDFXYZ _ PAGE _ <digits> >{1,3}`, case-insensitive, inner spaces
 * allowed, optionally wrapped in up to three emphasis/code characters and
 * optionally prefixed by a Markdown heading, quote or bullet. The word must be
 * PAGE. The id is the digit run read by numeric value from any `\p{Nd}` digits,
 * so Arabic-Indic and Devanagari digits read as their values (NFKC maps only
 * the full-width ones). CJK numerals are not digits.
 *
 * STRIP TOKEN (removal, anchored on the BRAND). "pdfxyz" in any compatibility
 * form, plus a tail bounded by the marker grammar (`TAIL`: `_PAGE_<digits>`,
 * or one short Latin word and digits for a translated PAGE), plus adjacent
 * bracket runs (angle of either width, and the CJK pairs in `OPENING`) and
 * glued emphasis characters. The tail never runs "to the next whitespace":
 * CJK and Thai have none between words, and such a tail deleted the next
 * sentence. It is found by normalising each character on its own, so the
 * rest of the line is never NFKC-normalised, and so never edited.
 *
 * ── WHAT `text` IS ──────────────────────────────────────────────────────────
 *
 * Always the reply with this product's markers removed: marker lines deleted,
 * strip tokens cut out of other lines, the pieces between marker lines
 * trimmed, empty pieces dropped, and the rest joined by `PAGE_JOIN`. A reply
 * with no brand token at all comes back as `reply.trim()`, byte for byte. The
 * only edit that is not marker ink is WHITESPACE: a marker line written
 * between single newlines ("A\n<marker>\nB") becomes "A\n\nB".
 *
 * ── WHAT VERIFIED DOES NOT PROVE ────────────────────────────────────────────
 *
 * It proves the markers came back in order and that no piece is empty. It
 * never proves that each piece holds only its own page's words: a sentence the
 * model finishes before the marker on a page that ends mid-sentence, or a
 * caption it moves across a marker that stays in order, is undetectable here.
 * Page headings are therefore approximate by a clause, and no copy may promise
 * exact boundaries.
 *
 * The corpus: `page-map.test.ts`.
 */

import { PAGE_JOIN } from "@/lib/pdf/text";

export type PageMarkerVerdict = "verified" | "missing" | "order" | "empty";

export interface PagePiece {
  readonly page: number;
  readonly text: string;
}

export interface PageMarkerReading {
  readonly verdict: PageMarkerVerdict;
  /** One piece per page, in order. Present only when `verdict` is "verified". */
  readonly pieces?: readonly PagePiece[];
  /** The reply with every marker removed (see the module docblock). */
  readonly text: string;
}

/** Whitespace and the bidi/format characters a model may wrap a line in. */
const EDGE = "\\s\\u061c\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff";
const EDGES = new RegExp(`^[${EDGE}]+|[${EDGE}]+$`, "gu");

/**
 * The marker line, applied to an NFKC-normalised, edge-trimmed line. Group 1
 * is the digit run.
 */
const MARKER_LINE =
  /^(?:#{1,6}\s+|>\s+|[-*+]\s+)?[*_`]{0,3}<{1,3}\s*pdfxyz\s*_\s*page\s*_\s*(\p{Nd}+)\s*>{1,3}[*_`]{0,3}$/iu;

/**
 * Bracket runs stripped beside a token. Angle brackets of either width, then
 * the CJK pairs a model reaches for when it re-brackets a marker:
 * lenticular, corner (both widths), white corner, tortoise-shell and
 * full-width parentheses.
 */
const OPENING = "<＜«‹〈〈⟨《【「｢『〔（";
const CLOSING = ">＞»›〉〉⟩》】」｣』〕）";
/** CJK numerals zero to nine, ten, hundred, thousand. */
const CJK_NUMERALS = "〇一二三四五六七八九十百千";
const EMPHASIS = "*_`";
const BRAND = "pdfxyz";

const isNd = (c: string): boolean => /^\p{Nd}$/u.test(c);
const isSpace = (c: string): boolean => /^\s$/u.test(c);

/**
 * The strip token's tail after the brand, on the per-character folded form:
 * either `_ page _ <digits>` (separators `_` or `-`, inner spaces allowed only
 * around a separator), or one Latin word of at most 12 letters (a translated
 * PAGE, a plural) between optional separators, then at most 6 digits. Bounded
 * on purpose: it can never reach past the marker's own grammar into the text.
 */
const TAIL_PAGE = /^(?:\s*[_-]\s*|)page(?:\s*[_-]\s*|)\p{Nd}{0,6}/u;
const TAIL_WORD = /^[_-]?\p{Script=Latin}{0,12}[_-]?\p{Nd}{0,6}/u;

/**
 * How many folded characters of `rest` belong to the token. The PAGE form
 * wins when it ends on a digit (the id closes the marker); otherwise the
 * longer of the two, so "PAGES_2" is taken whole rather than as "PAGE".
 */
function tailLength(rest: string): number {
  const page = TAIL_PAGE.exec(rest)?.[0] ?? "";
  if (page !== "" && isNd(Array.from(page).pop()!)) return page.length;
  const word = TAIL_WORD.exec(rest)?.[0] ?? "";
  return Math.max(page.length, word.length);
}

/**
 * A decimal digit's value. Every `\p{Nd}` block is a contiguous run 0-9, and
 * adjacent blocks (the mathematical digits) start on a zero, so the value is
 * the position in the run of consecutive digits, modulo ten.
 */
function digitValue(c: string): number {
  let cp = c.codePointAt(0)!;
  let k = 0;
  while (k < 200 && isNd(String.fromCodePoint(cp - 1))) {
    cp -= 1;
    k += 1;
  }
  return k % 10;
}

/** The page id a marker line carries, or `null` when the line is not one. */
export function markerLineId(line: string): number | null {
  const normal = line.normalize("NFKC").replace(EDGES, "");
  const match = MARKER_LINE.exec(normal);
  if (!match) return null;
  let id = 0;
  for (const c of match[1]!) id = id * 10 + digitValue(c);
  return id;
}

/**
 * Each strip token in `line` as `[start, end)` code-point offsets, merged.
 * The brand is found on a per-character NFKC form, so every compatibility
 * spelling of it is caught and nothing else on the line is normalised.
 */
function stripTokenSpans(line: string): Array<[number, number]> {
  const chars = Array.from(line);
  let folded = "";
  const origin: number[] = [];
  chars.forEach((c, i) => {
    const f = c.normalize("NFKC").toLowerCase();
    for (let j = 0; j < f.length; j += 1) origin.push(i);
    folded += f;
  });

  const spans: Array<[number, number]> = [];
  let from = 0;
  for (;;) {
    const at = folded.indexOf(BRAND, from);
    if (at < 0) break;
    from = at + BRAND.length;
    let start = origin[at]!;
    let end = origin[at + BRAND.length - 1]! + 1;

    // The tail: the marker grammar only, never "up to the next whitespace".
    // CJK and Thai put no space between words, so a to-whitespace tail ate
    // the model's next sentence whenever a marker was glued to it.
    const taken = tailLength(folded.slice(at + BRAND.length));
    if (taken > 0) end = origin[at + BRAND.length + taken - 1]! + 1;
    // A CJK-numeral id ("<<<PDFXYZ_PAGE_" + U+4E8C + ">>>") is taken only when
    // a closing bracket closes it: unbracketed, the same characters may be
    // the first word of the next page.
    let id = end;
    while (
      id < chars.length &&
      id - end < 6 &&
      CJK_NUMERALS.includes(chars[id]!)
    )
      id += 1;
    let shut = id;
    while (shut < chars.length && isSpace(chars[shut]!)) shut += 1;
    if (id > end && shut < chars.length && CLOSING.includes(chars[shut]!))
      end = id;
    // A closing bracket run, possibly after inner spaces, then emphasis.
    let probe = end;
    while (probe < chars.length && isSpace(chars[probe]!)) probe += 1;
    if (probe < chars.length && CLOSING.includes(chars[probe]!)) {
      end = probe;
      while (end < chars.length && CLOSING.includes(chars[end]!)) end += 1;
    }
    while (end < chars.length && EMPHASIS.includes(chars[end]!)) end += 1;

    // An opening bracket run before it, possibly before inner spaces, then
    // emphasis.
    probe = start;
    while (probe > 0 && isSpace(chars[probe - 1]!)) probe -= 1;
    if (probe > 0 && OPENING.includes(chars[probe - 1]!)) {
      start = probe;
      while (start > 0 && OPENING.includes(chars[start - 1]!)) start -= 1;
    }
    while (start > 0 && EMPHASIS.includes(chars[start - 1]!)) start -= 1;

    const last = spans[spans.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else spans.push([start, end]);
    while (from < folded.length && origin[from]! < end) from += 1;
  }
  return spans;
}

/** `line` with every strip token cut out, and no doubled space left behind. */
function stripTokens(line: string, spans: Array<[number, number]>): string {
  const chars = Array.from(line);
  let out = "";
  let cursor = 0;
  for (const [start, end] of spans) {
    out += chars.slice(cursor, start).join("");
    const before = out[out.length - 1];
    const after = chars[end];
    if (before === " " && after === " ") out = out.slice(0, -1);
    cursor = end;
  }
  return out + chars.slice(cursor).join("");
}

/**
 * The recognisers, in the order a line is tried. Exported so the corpus can
 * prove each one is the first to catch some reply no other one catches, and
 * that every injected marker is caught by one of them (rule 1, both ways).
 */
export const PAGE_MARKER_PATTERNS: ReadonlyArray<{
  readonly name: "marker-line" | "strip-token";
  readonly matches: (line: string) => boolean;
}> = [
  { name: "marker-line", matches: (line) => markerLineId(line) !== null },
  { name: "strip-token", matches: (line) => stripTokenSpans(line).length > 0 },
];

/**
 * Split `reply` at its page markers, if it kept them. `pages` is the chunk's
 * page list; the marker lines must be exactly `pages.slice(1)`, in order.
 */
export function readPageMarkers(
  reply: string,
  pages: readonly number[],
): PageMarkerReading {
  const ids: number[] = [];
  const groups: string[][] = [[]];
  let inline = false;

  for (const line of reply.split("\n")) {
    const id = markerLineId(line);
    if (id !== null) {
      ids.push(id);
      groups.push([]);
      continue;
    }
    const spans = stripTokenSpans(line);
    if (spans.length === 0) {
      groups[groups.length - 1]!.push(line);
      continue;
    }
    inline = true;
    const kept = stripTokens(line, spans);
    // A line that held nothing but a token goes, and the text either side is
    // rejoined by PAGE_JOIN as at a marker line, rather than leaving a hole.
    // Splitting here cannot fabricate a page: an inline token rules out
    // "verified", so these groups only ever reach `text`, never `pieces`.
    if (kept.trim() === "") groups.push([]);
    else groups[groups.length - 1]!.push(kept);
  }

  const pieces = groups.map((lines) => lines.join("\n").trim());
  const text = pieces.filter((piece) => piece !== "").join(PAGE_JOIN);
  const expected = pages.slice(1);

  if (ids.length < expected.length) return { verdict: "missing", text };
  if (inline || ids.length !== expected.length) {
    return { verdict: "order", text };
  }
  for (const [i, id] of ids.entries()) {
    if (id !== expected[i]) return { verdict: "order", text };
  }
  if (pieces.some((piece) => piece === "")) return { verdict: "empty", text };
  return {
    verdict: "verified",
    pieces: pieces.map((piece, i) => ({ page: pages[i]!, text: piece })),
    text,
  };
}

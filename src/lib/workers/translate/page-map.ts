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
 * form, plus its non-space tail up to the next whitespace or closing bracket,
 * plus adjacent bracket runs of either width and glued emphasis characters. It
 * is found by normalising each character on its own, so the rest of the line
 * is never NFKC-normalised, and so never edited.
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

const OPENING = "<＜«‹〈〈⟨《";
const CLOSING = ">＞»›〉〉⟩》";
const EMPHASIS = "*_`";
const BRAND = "pdfxyz";

const isNd = (c: string): boolean => /^\p{Nd}$/u.test(c);
const isSpace = (c: string): boolean => /^\s$/u.test(c);

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

    // The tail: everything up to the next whitespace or closing bracket.
    while (
      end < chars.length &&
      !isSpace(chars[end]!) &&
      !CLOSING.includes(chars[end]!)
    ) {
      end += 1;
    }
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

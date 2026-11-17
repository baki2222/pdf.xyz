"use client";

import { createElement, Fragment, useMemo, type ReactNode } from "react";
import { AI_RESULT_CHUNK } from "./ai-result-chunk";

/*
 * The Markdown an AI summary or chat answer is written in, drawn as
 * formatted text (competitor audit #4): headings, paragraphs, bullet and
 * numbered lists (nested), quotes, rules, bold, italic, inline code, code
 * blocks, GFM tables, and links.
 *
 * SAFE BY CONSTRUCTION, not by cleaning: the parser below produces a tree of
 * a fixed set of node kinds, and the renderer turns each kind into ONE
 * element React creates. There is no HTML string anywhere, so a `<script>` or
 * `<img onerror=...>` in the model's output is characters on the page. A link
 * is an element only for an http, https or mailto address the URL parser
 * agrees with ({@link safeHref}); any other link is shown as the characters
 * the model wrote. An image (`![alt](src)`) is never loaded: it reads as `!`
 * and a link.
 *
 * BOUNDED: every scan is linear in the text or capped, and nesting stops at
 * {@link MAX_DEPTH} (deeper text is shown as it was written), so a hostile
 * 200 KB answer renders without hanging (ai-markdown.test.tsx times it).
 *
 * NOTHING IS ADDED to the text: the DOM holds the source's own characters
 * minus the marks, so the result views' character cap (PAGE_TEXT_LIMIT) holds
 * of what is drawn, and a list's numbers and bullets are CSS, not text.
 *
 * Not markdown-to-pdf's parser (`src/lib/pdf/markdown-to-pdf.ts`): that one
 * READS inline HTML (it hides comments and turns `<a href>` into a link), and
 * it imports the PDF engine. Only `./ai-result-views` and `./chat-answer`
 * import this module, both inside the lazy AI result chunk
 * (ai-markdown.test.tsx derives the importers).
 */

/** How deep lists, quotes and inline marks may nest before text is shown as written. */
export const MAX_DEPTH = 12;

/** The schemes a link is made clickable for. */
export const LINK_SCHEMES = ["http:", "https:", "mailto:"] as const;

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong" | "em"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] };

export type Block =
  | { t: "h"; depth: number; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "quote"; c: Block[] }
  | { t: "list"; ordered: boolean; start: number; items: Block[][] }
  | { t: "hr" }
  | {
      t: "table";
      align: ("left" | "center" | "right" | undefined)[];
      head: Inline[][];
      rows: Inline[][][];
    };

type HeadingBlock = Extract<Block, { t: "h" }>;

/**
 * The address a link opens, or null. Only an address that STARTS with
 * `http://`, `https://` or `mailto:`, holds no space or control character
 * anywhere, and that the URL parser reads with one of {@link LINK_SCHEMES}.
 * Entities are never decoded, so `&#106;avascript:` starts with `&` and is
 * refused; so is `java\tscript:`, ` javascript:`, `data:` and `vbscript:`.
 */
export function safeHref(raw: string): string | null {
  if (raw.length === 0 || raw.length > 2048) return null;
  // Control characters, spaces, DEL and the C1 range, anywhere.
  if (/[\x00-\x20\x7f-\x9f]/.test(raw)) return null;
  if (!/^(?:https?:\/\/|mailto:)/i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return (LINK_SCHEMES as readonly string[]).includes(url.protocol)
    ? url.href
    : null;
}

// ── Inline ──────────────────────────────────────────────────────────────

const PUNCT = new Set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~");
const isSpace = (c: string | undefined) =>
  c === undefined || c === " " || c === "\t" || c === "\n";
const isWord = (c: string | undefined) =>
  c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Whether `s[i]` is escaped by an odd run of backslashes before it. */
function escaped(s: string, i: number): boolean {
  let n = 0;
  while (i - 1 - n >= 0 && s[i - 1 - n] === "\\") n += 1;
  return n % 2 === 1;
}

/** First index in sorted `list` holding a value >= `min`. */
function lowerBound(list: number[], min: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]! < min) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** How many later candidates an emphasis opener may try before giving up. */
const CLOSER_TRIES = 64;

/**
 * What one pass over a paragraph's text finds once, so that no later step
 * scans it again: code spans (atomic, as in CommonMark), matched brackets
 * and parentheses outside them, and where `*` / `_` could close.
 */
interface Scan {
  s: string;
  /** Code span start → index just past its closing backticks. */
  code: Map<number, number>;
  /** `[` → its `]`, and `(` → its `)`. */
  close: Map<number, number>;
  /** Candidate closer positions per mark, ascending. */
  closers: { "*": number[]; _: number[] };
}

function scan(s: string): Scan {
  const code = new Map<number, number>();
  // Backtick runs, then each opener paired with the next run of equal length.
  const runs: { at: number; n: number }[] = [];
  for (let i = 0; i < s.length;) {
    if (s[i] === "`") {
      let n = 1;
      while (s[i + n] === "`") n += 1;
      runs.push({ at: i, n });
      i += n;
    } else i += 1;
  }
  const nextSame = new Array<number>(runs.length).fill(-1);
  const lastOfLength = new Map<number, number>();
  for (let k = runs.length - 1; k >= 0; k--) {
    nextSame[k] = lastOfLength.get(runs[k]!.n) ?? -1;
    lastOfLength.set(runs[k]!.n, k);
  }
  for (let k = 0; k < runs.length; k++) {
    const run = runs[k]!;
    if (escaped(s, run.at)) continue;
    const j = nextSame[k]!;
    if (j < 0) continue;
    code.set(run.at, runs[j]!.at + run.n);
    // Runs inside the span are content, never openers.
    k = j;
  }

  const close = new Map<number, number>();
  const closers: Scan["closers"] = { "*": [], _: [] };
  const brackets: number[] = [];
  const parens: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const end = code.get(i);
    if (end !== undefined) {
      i = end - 1;
      continue;
    }
    const c = s[i]!;
    if (c === "\\") {
      i += 1;
      continue;
    }
    if (c === "[") brackets.push(i);
    else if (c === "]") {
      const open = brackets.pop();
      if (open !== undefined) close.set(open, i);
    } else if (c === "(") parens.push(i);
    else if (c === ")") {
      const open = parens.pop();
      if (open !== undefined) close.set(open, i);
    } else if ((c === "*" || c === "_") && i > 0 && !isSpace(s[i - 1]))
      closers[c].push(i);
  }
  return { s, code, close, closers };
}

/**
 * Where a `**` (size 2) or `*` (size 1) opened at `open` closes, before
 * `to`, or -1. The closer is right-flanking (no space before it), is the
 * END of its run for a strong closer, and for `_` has no letter after it.
 */
function closerFor(
  sc: Scan,
  ch: "*" | "_",
  size: 1 | 2,
  open: number,
  to: number,
): number {
  const { s } = sc;
  const list = sc.closers[ch];
  let k = lowerBound(list, open + size + 1);
  for (let tries = 0; k < list.length && tries < CLOSER_TRIES; k++, tries++) {
    const q = list[k]!;
    if (q + size > to) return -1;
    if (size === 2) {
      if (s[q + 1] !== ch) continue;
      if (q + 2 < to && s[q + 2] === ch) continue;
    } else {
      if (s[q - 1] === ch) continue;
      if (q + 1 < to && s[q + 1] === ch) continue;
    }
    if (ch === "_" && isWord(s[q + size])) continue;
    return q;
  }
  return -1;
}

/** The destination inside a link's `( )`: up to the first space, `<...>` allowed. */
function destination(inner: string): string {
  const t = inner.trim();
  if (t.startsWith("<")) {
    const gt = t.indexOf(">");
    return gt > 0 ? t.slice(1, gt) : t;
  }
  const space = t.search(/\s/);
  return space < 0 ? t : t.slice(0, space);
}

/** A bare `http(s)://` address's end: its run of non-space, trailing punctuation off. */
function bareUrlEnd(s: string, from: number, to: number): number {
  let end = from;
  let open = 0;
  let shut = 0;
  while (end < to && !isSpace(s[end]) && s[end] !== "<") {
    if (s[end] === "(") open += 1;
    else if (s[end] === ")") shut += 1;
    end += 1;
  }
  for (;;) {
    const last = s[end - 1];
    if (last && ".,:;!?'\"*_~]".includes(last)) end -= 1;
    else if (last === ")" && shut > open) {
      end -= 1;
      shut -= 1;
    } else break;
  }
  return end;
}

function inlines(sc: Scan, from: number, to: number, depth: number): Inline[] {
  const { s } = sc;
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  const deep = depth >= MAX_DEPTH;
  let i = from;
  while (i < to) {
    const c = s[i]!;
    if (c === "\\" && i + 1 < to && PUNCT.has(s[i + 1]!)) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === "`") {
      const end = sc.code.get(i);
      if (end !== undefined && end <= to) {
        let n = 0;
        while (s[i + n] === "`") n += 1;
        let v = s.slice(i + n, end - n).replace(/\n/g, " ");
        if (v.length > 2 && v.startsWith(" ") && v.endsWith(" ") && v.trim())
          v = v.slice(1, -1);
        flush();
        out.push({ t: "code", v });
        i = end;
        continue;
      }
      // A run with no closer is literal, all of it.
      while (i < to && s[i] === "`") buf += s[i++];
      continue;
    }
    if (c === "[" && !deep) {
      const shut = sc.close.get(i);
      const parenShut =
        shut !== undefined && s[shut + 1] === "("
          ? sc.close.get(shut + 1)
          : undefined;
      if (shut !== undefined && parenShut !== undefined && parenShut < to) {
        const href = safeHref(destination(s.slice(shut + 2, parenShut)));
        if (href !== null) {
          flush();
          out.push({ t: "link", href, c: inlines(sc, i + 1, shut, depth + 1) });
        } else buf += s.slice(i, parenShut + 1);
        i = parenShut + 1;
        continue;
      }
    }
    if (c === "<") {
      let gt = i + 1;
      while (gt < to && !isSpace(s[gt]) && s[gt] !== "<" && s[gt] !== ">")
        gt += 1;
      if (gt < to && s[gt] === ">") {
        const raw = s.slice(i + 1, gt);
        const href = safeHref(raw);
        if (href !== null) {
          flush();
          out.push({ t: "link", href, c: [{ t: "text", v: raw }] });
          i = gt + 1;
          continue;
        }
      }
      buf += c;
      i += 1;
      continue;
    }
    if (
      (c === "h" || c === "H") &&
      !isWord(s[i - 1]) &&
      /^https?:\/\//i.test(s.slice(i, i + 8))
    ) {
      const end = bareUrlEnd(s, i, to);
      const raw = s.slice(i, end);
      const href = safeHref(raw);
      if (href !== null) {
        flush();
        out.push({ t: "link", href, c: [{ t: "text", v: raw }] });
      } else buf += raw;
      i = end;
      continue;
    }
    if ((c === "*" || c === "_") && !deep) {
      const leftOk = c === "*" || !isWord(s[i - 1]);
      if (leftOk && s[i + 1] === c && i + 2 < to && !isSpace(s[i + 2])) {
        const q = closerFor(sc, c, 2, i, to);
        if (q >= 0) {
          flush();
          out.push({ t: "strong", c: inlines(sc, i + 2, q, depth + 1) });
          i = q + 2;
          continue;
        }
      }
      if (leftOk && i + 1 < to && !isSpace(s[i + 1])) {
        const q = closerFor(sc, c, 1, i, to);
        if (q >= 0) {
          flush();
          out.push({ t: "em", c: inlines(sc, i + 1, q, depth + 1) });
          i = q + 1;
          continue;
        }
      }
    }
    buf += c;
    i += 1;
  }
  flush();
  return out;
}

/** One paragraph's (or heading's, or cell's) text as inline nodes. */
export function parseInline(text: string): Inline[] {
  return inlines(scan(text), 0, text.length, 0);
}

// ── Blocks ──────────────────────────────────────────────────────────────

/** Leading spaces, a tab counting as up to the next multiple of 4. */
function indentOf(line: string): number {
  let col = 0;
  for (const c of line) {
    if (c === " ") col += 1;
    else if (c === "\t") col += 4 - (col % 4);
    else break;
  }
  return col;
}

/** `line` with up to `cols` columns of its leading whitespace removed. */
function dedent(line: string, cols: number): string {
  let col = 0;
  let i = 0;
  while (i < line.length && col < cols) {
    if (line[i] === " ") col += 1;
    else if (line[i] === "\t") col += 4 - (col % 4);
    else break;
    i += 1;
  }
  return line.slice(i);
}

const blank = (line: string) => line.trim() === "";

function heading(line: string): { depth: number; text: string } | null {
  if (indentOf(line) > 3) return null;
  const t = line.trimStart();
  let n = 0;
  while (t[n] === "#") n += 1;
  if (n < 1 || n > 6) return null;
  if (n < t.length && t[n] !== " " && t[n] !== "\t") return null;
  let text = t.slice(n).trim();
  // A closing run of #s, when a space sets it off (or it is all there is).
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end -= 1;
  if (end === 0) text = "";
  else if (
    end < text.length &&
    (text[end - 1] === " " || text[end - 1] === "\t")
  )
    text = text.slice(0, end).trimEnd();
  return { depth: n, text };
}

function isRule(line: string): boolean {
  if (indentOf(line) > 3) return false;
  const t = line.trim();
  const ch = t[0];
  if (ch !== "-" && ch !== "*" && ch !== "_") return false;
  let count = 0;
  for (const c of t) {
    if (c === ch) count += 1;
    else if (c !== " " && c !== "\t") return false;
  }
  return count >= 3;
}

function fence(line: string): { ch: string; n: number; indent: number } | null {
  const indent = indentOf(line);
  if (indent > 3) return null;
  const t = line.trimStart();
  const ch = t[0];
  if (ch !== "`" && ch !== "~") return null;
  let n = 0;
  while (t[n] === ch) n += 1;
  if (n < 3) return null;
  if (ch === "`" && t.slice(n).includes("`")) return null;
  return { ch, n, indent };
}

function isQuote(line: string): boolean {
  return indentOf(line) <= 3 && line.trimStart().startsWith(">");
}

interface Marker {
  indent: number;
  ordered: boolean;
  start: number;
  /** Where the item's text starts in the line, in characters. */
  content: number;
  /** The same, in columns: lines indented this far belong to the item. */
  contentCols: number;
}

function listMarker(line: string): Marker | null {
  const indent = indentOf(line);
  const t = line.trimStart();
  const lead = line.length - t.length;
  let width = 0;
  let ordered = false;
  let start = 1;
  if (t[0] === "-" || t[0] === "*" || t[0] === "+") width = 1;
  else {
    let d = 0;
    while (d < 9 && t[d] !== undefined && t[d]! >= "0" && t[d]! <= "9") d += 1;
    if (d === 0 || (t[d] !== "." && t[d] !== ")")) return null;
    width = d + 1;
    ordered = true;
    start = Number(t.slice(0, d));
  }
  const after = t[width];
  if (after !== undefined && after !== " " && after !== "\t") return null;
  let gap = 0;
  while (t[width + gap] === " " && gap < 4) gap += 1;
  if (after === undefined || gap === 0) gap = 1;
  return {
    indent,
    ordered,
    start,
    content: Math.min(line.length, lead + width + gap),
    contentCols: indent + width + gap,
  };
}

/**
 * Does `line` start a block that ends a paragraph? As CommonMark has it, a
 * list item does only when it has text and, if numbered, starts at 1: a
 * wrapped line such as "2024. was a good year" goes on with the paragraph
 * (review, 2026-11-18). `anyItem` is for a list item's own lines, where a
 * marker of any number starts the next item.
 */
function interrupts(line: string, anyItem = false): boolean {
  if (
    heading(line) !== null ||
    fence(line) !== null ||
    isRule(line) ||
    isQuote(line)
  )
    return true;
  const m = indentOf(line) <= 3 ? listMarker(line) : null;
  if (m === null) return false;
  return (
    anyItem || ((!m.ordered || m.start === 1) && !blank(line.slice(m.content)))
  );
}

/** A table row's cells: pipes at the ends dropped, `\|` kept as a pipe. */
function cells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !escaped(t, t.length - 1)) t = t.slice(0, -1);
  const out: string[] = [];
  let cell = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && t[i + 1] === "|") {
      cell += "|";
      i += 1;
    } else if (t[i] === "|") {
      out.push(cell.trim());
      cell = "";
    } else cell += t[i];
  }
  out.push(cell.trim());
  return out;
}

function delimiterRow(line: string, width: number) {
  if (!line.includes("-")) return null;
  const parts = cells(line);
  if (parts.length !== width) return null;
  const align: ("left" | "center" | "right" | undefined)[] = [];
  for (const p of parts) {
    if (!/^:?-+:?$/.test(p)) return null;
    const left = p.startsWith(":");
    const right = p.endsWith(":");
    align.push(
      left && right ? "center" : right ? "right" : left ? "left" : undefined,
    );
  }
  return align;
}

/** Do `lines[i]` and the line after it open a table? */
function tableStarts(lines: string[], i: number): boolean {
  const next = lines[i + 1];
  return (
    next !== undefined &&
    lines[i]!.includes("|") &&
    delimiterRow(next, cells(lines[i]!).length) !== null
  );
}

function parseBlocks(lines: string[], depth: number): Block[] {
  const out: Block[] = [];
  // Too deep to nest further: the rest is shown as it was written.
  if (depth >= MAX_DEPTH) {
    const text = lines.join("\n").trim();
    if (text) out.push({ t: "p", c: [{ t: "text", v: text }] });
    return out;
  }
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (blank(line)) {
      i += 1;
      continue;
    }
    const f = fence(line);
    if (f) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        const l = lines[i]!;
        const shut = fence(l);
        if (
          shut &&
          shut.ch === f.ch &&
          shut.n >= f.n &&
          l.trim() === f.ch.repeat(l.trim().length)
        ) {
          i += 1;
          break;
        }
        body.push(dedent(l, f.indent));
        i += 1;
      }
      out.push({ t: "code", v: body.join("\n") });
      continue;
    }
    const h = heading(line);
    if (h) {
      out.push({ t: "h", depth: h.depth, c: parseInline(h.text) });
      i += 1;
      continue;
    }
    if (isRule(line)) {
      out.push({ t: "hr" });
      i += 1;
      continue;
    }
    if (isQuote(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const l = lines[i]!;
        if (isQuote(l)) {
          const t = l.trimStart().slice(1);
          inner.push(t.startsWith(" ") ? t.slice(1) : t);
        } else if (!blank(l) && !interrupts(l) && !blank(lines[i - 1]!))
          inner.push(l);
        else break;
        i += 1;
      }
      out.push({ t: "quote", c: parseBlocks(inner, depth + 1) });
      continue;
    }
    const m = indentOf(line) <= 3 ? listMarker(line) : null;
    if (m) {
      const items: Block[][] = [];
      while (i < lines.length) {
        const at = listMarker(lines[i]!);
        if (!at || at.indent > m.indent || at.ordered !== m.ordered) break;
        if (indentOf(lines[i]!) > 3) break;
        const body: string[] = [lines[i]!.slice(at.content)];
        i += 1;
        while (i < lines.length) {
          const l = lines[i]!;
          if (blank(l)) {
            // A blank line stays in the item only when the item goes on.
            let next = i + 1;
            while (next < lines.length && blank(lines[next]!)) next += 1;
            if (next < lines.length && indentOf(lines[next]!) > m.indent) {
              while (i < next) body.push(lines[i++]!.trim());
              continue;
            }
            break;
          }
          const ind = indentOf(l);
          if (ind > m.indent)
            body.push(dedent(l, Math.min(ind, at.contentCols)));
          else if (!interrupts(l, true) && !blank(lines[i - 1]!))
            body.push(l.trimStart());
          else break;
          i += 1;
        }
        items.push(parseBlocks(body, depth + 1));
        // Blank lines between items keep the list going.
        let next = i;
        while (next < lines.length && blank(lines[next]!)) next += 1;
        const sibling = next < lines.length ? listMarker(lines[next]!) : null;
        if (
          sibling &&
          sibling.indent <= m.indent &&
          sibling.ordered === m.ordered &&
          indentOf(lines[next]!) <= 3
        )
          i = next;
        else break;
      }
      out.push({ t: "list", ordered: m.ordered, start: m.start, items });
      continue;
    }
    if (tableStarts(lines, i)) {
      const head = cells(line);
      const align = delimiterRow(lines[i + 1]!, head.length);
      if (align) {
        const rows: Inline[][][] = [];
        i += 2;
        while (
          i < lines.length &&
          !blank(lines[i]!) &&
          lines[i]!.includes("|")
        ) {
          const row = cells(lines[i]!);
          rows.push(head.map((_, k) => parseInline(row[k] ?? "")));
          i += 1;
        }
        out.push({
          t: "table",
          align,
          head: head.map((cell) => parseInline(cell)),
          rows,
        });
        continue;
      }
    }
    // A paragraph: its lines, their indentation dropped, until a blank line
    // or a line that starts another block.
    const para: string[] = [line.trimStart()];
    i += 1;
    while (
      i < lines.length &&
      !blank(lines[i]!) &&
      !interrupts(lines[i]!) &&
      !tableStarts(lines, i)
    ) {
      para.push(lines[i]!.trimStart());
      i += 1;
    }
    out.push({ t: "p", c: parseInline(para.join("\n")) });
  }
  return out;
}

/** The text as blocks. Pure, so its tests and timings need no DOM. */
export function parseMarkdown(text: string): Block[] {
  return parseBlocks(text.split(/\r\n?|\n/), 0);
}

/** The headings in the order they are drawn, lists and quotes included. */
function headingsIn(blocks: Block[], out: HeadingBlock[] = []): HeadingBlock[] {
  for (const b of blocks) {
    if (b.t === "h") out.push(b);
    else if (b.t === "quote") headingsIn(b.c, out);
    else if (b.t === "list") for (const item of b.items) headingsIn(item, out);
  }
  return out;
}

/**
 * The level each heading is drawn at, so the text continues the page's
 * outline under a heading of level `base - 1` without a gap (axe
 * heading-order; review, 2026-11-18: shifting by the shallowest depth alone
 * kept the model's own gaps, so "##" then "####" drew h4 then h6).
 *
 * The depths the text uses, in rank order, are drawn at base, base + 1 and
 * so on, at most h6; and no heading is drawn more than one level deeper than
 * the heading before it (the first, than `base - 1`), so a text that opens
 * with its deepest heading still starts at the base.
 */
export function headingLevels(
  blocks: Block[],
  base: number,
): Map<HeadingBlock, number> {
  const headings = headingsIn(blocks);
  const ranks = [...new Set(headings.map((h) => h.depth))].sort(
    (a, b) => a - b,
  );
  const levels = new Map<HeadingBlock, number>();
  let previous = base - 1;
  for (const h of headings) {
    const level = Math.min(6, base + ranks.indexOf(h.depth), previous + 1);
    levels.set(h, level);
    previous = level;
  }
  return levels;
}

// ── Render ──────────────────────────────────────────────────────────────

interface Ctx {
  /** The heading level the text's shallowest heading is drawn at. */
  base: number;
  /** The level each heading is drawn at (`headingLevels`). */
  levels: Map<HeadingBlock, number>;
  /** How a run of text is drawn (Chat with PDF's page buttons); plain by default. */
  leaf: (text: string) => ReactNode;
}

const TH = "text-muted px-4 py-2 text-left text-xs font-medium";
const TD = "px-4 py-2 text-left font-normal";

function renderInline(nodes: Inline[], ctx: Ctx, inLink: boolean): ReactNode {
  return nodes.map((n, k) => {
    switch (n.t) {
      case "text":
        // Inside a link the text stays text: a button in a link is two
        // controls in one, and neither works.
        return <Fragment key={k}>{inLink ? n.v : ctx.leaf(n.v)}</Fragment>;
      case "code":
        return (
          <code
            key={k}
            className="bg-wash rounded-tag px-1 font-mono"
            style={{ fontSize: "0.9em" }}
          >
            {inLink ? n.v : ctx.leaf(n.v)}
          </code>
        );
      case "strong":
        return <strong key={k}>{renderInline(n.c, ctx, inLink)}</strong>;
      case "em":
        return <em key={k}>{renderInline(n.c, ctx, inLink)}</em>;
      case "link":
        // A link inside a link label is drawn as its text.
        return inLink ? (
          <Fragment key={k}>{renderInline(n.c, ctx, true)}</Fragment>
        ) : (
          <a
            key={k}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-accent underline underline-offset-4"
          >
            {renderInline(n.c, ctx, true)}
          </a>
        );
    }
  });
}

function renderBlocks(blocks: Block[], ctx: Ctx): ReactNode {
  return blocks.map((b, k) => renderBlock(b, k, ctx));
}

function renderBlock(b: Block, k: number, ctx: Ctx): ReactNode {
  switch (b.t) {
    case "p":
      return <p key={k}>{renderInline(b.c, ctx, false)}</p>;
    case "h": {
      const level = ctx.levels.get(b) ?? ctx.base;
      return createElement(
        `h${level}`,
        {
          key: k,
          className:
            level === ctx.base
              ? "text-fg text-base font-semibold"
              : "text-fg text-sm font-semibold",
        },
        renderInline(b.c, ctx, false),
      );
    }
    case "code":
      return (
        <pre
          key={k}
          className="bg-wash rounded-tag border-line border px-3 py-2 font-mono text-xs"
          style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
        >
          <code>{ctx.leaf(b.v)}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote
          key={k}
          className="border-line flex flex-col gap-2 border-l-2 pl-3"
        >
          {renderBlocks(b.c, ctx)}
        </blockquote>
      );
    case "hr":
      return <hr key={k} className="border-line" />;
    case "list": {
      const items = b.items.map((item, n) => {
        const [first, ...rest] = item;
        const lead =
          first?.t === "p" ? renderInline(first.c, ctx, false) : null;
        const blocks = lead === null ? item : rest;
        return (
          <li key={n} style={n > 0 ? { marginTop: "0.25rem" } : undefined}>
            {lead}
            {blocks.length > 0 && (
              <div
                className="flex flex-col gap-2"
                style={lead === null ? undefined : { marginTop: "0.25rem" }}
              >
                {renderBlocks(blocks, ctx)}
              </div>
            )}
          </li>
        );
      });
      return b.ordered ? (
        <ol
          key={k}
          className="pl-5"
          style={{ listStyleType: "decimal" }}
          {...(b.start !== 1 ? { start: b.start } : {})}
        >
          {items}
        </ol>
      ) : (
        <ul key={k} className="list-disc pl-5">
          {items}
        </ul>
      );
    }
    case "table":
      return (
        // Focusable so a keyboard can scroll a wide table.
        <div
          key={k}
          role="region"
          aria-label="Table"
          tabIndex={0}
          className="border-line rounded-panel overflow-auto border"
          style={{ whiteSpace: "normal" }}
        >
          <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
            <thead>
              <tr>
                {b.head.map((cell, c) => (
                  <th
                    key={c}
                    scope="col"
                    className={TH}
                    style={b.align[c] ? { textAlign: b.align[c] } : undefined}
                  >
                    {renderInline(cell, ctx, false)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r} className="border-line border-t">
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className={TD}
                      style={b.align[c] ? { textAlign: b.align[c] } : undefined}
                    >
                      {renderInline(cell, ctx, false)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

const plain = (text: string): ReactNode => text;

/**
 * `text` drawn as formatted Markdown. `headingBase` is the level of the
 * heading the text sits under plus one, so its shallowest heading continues
 * the page's outline instead of breaking it; deeper ones follow one level at
 * a time, at most h6 (`headingLevels`).
 */
export function MarkdownText({
  text,
  headingBase,
  leaf = plain,
  className,
}: {
  text: string;
  headingBase: number;
  leaf?: (text: string) => ReactNode;
  className?: string;
}) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const levels = useMemo(
    () => headingLevels(blocks, headingBase),
    [blocks, headingBase],
  );
  return (
    <div
      data-chunk={AI_RESULT_CHUNK}
      data-markdown=""
      className={className ?? "flex flex-col gap-3"}
      style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
    >
      {renderBlocks(blocks, { base: headingBase, levels, leaf })}
    </div>
  );
}

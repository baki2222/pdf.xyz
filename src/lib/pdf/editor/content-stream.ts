/**
 * A PDF content-stream tokenizer: the bytes of a page (or a Form XObject, or
 * a CMap) as a list of OPERATIONS, each with its parsed operands and the byte
 * range it occupies in the source.
 *
 * The byte ranges are the point. Edit text and Redact remove glyphs by
 * rewriting ONLY the operators that painted them; every other operation is
 * copied across as the very bytes it was (`spliceOps`), so a run nobody
 * touched stays byte-identical in the stream — which `content-edit.test.ts`
 * checks on the saved file, not on this module's own output.
 *
 * Pure: no pdf-lib, no DOM. A leaf so the CMap parser and the interpreter
 * share it.
 */

export type PdfValue =
  | number
  | boolean
  | null
  | PdfName
  | PdfString
  | PdfValue[]
  | PdfDictValue;

export interface PdfName {
  t: "name";
  v: string;
}
export interface PdfString {
  t: "str";
  bytes: Uint8Array;
  hex: boolean;
}
export interface PdfDictValue {
  t: "dict";
  v: Map<string, PdfValue>;
}

export interface ContentOp {
  op: string;
  args: PdfValue[];
  /** Byte offset of the first operand (or of the operator, with none). */
  start: number;
  /** Byte offset just past the operator (past `EI` for an inline image). */
  end: number;
  /** An inline image (`BI … ID … EI`): its dictionary. */
  inline?: Map<string, PdfValue>;
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

const isWs = (b: number | undefined) => b !== undefined && WS.has(b);
const isRegular = (b: number | undefined) =>
  b !== undefined && !WS.has(b) && !DELIM.has(b);

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** Latin-1 view of a byte range (operators and numbers are ASCII). */
export function latin1(bytes: Uint8Array, from = 0, to = bytes.length): string {
  let s = "";
  for (let i = from; i < to; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

export function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

type Token =
  | { kind: "value"; value: PdfValue; start: number; end: number }
  | { kind: "op"; op: string; start: number; end: number }
  | { kind: "open"; ch: "[" | "<<"; start: number; end: number }
  | { kind: "close"; ch: "]" | ">>"; start: number; end: number };

class Lexer {
  pos = 0;
  constructor(readonly b: Uint8Array) {}

  skip(): void {
    const b = this.b;
    while (this.pos < b.length) {
      const c = b[this.pos]!;
      if (WS.has(c)) this.pos++;
      else if (c === 37) {
        // % comment to end of line
        while (this.pos < b.length && b[this.pos] !== 10 && b[this.pos] !== 13)
          this.pos++;
      } else break;
    }
  }

  next(): Token | null {
    this.skip();
    const b = this.b;
    if (this.pos >= b.length) return null;
    const start = this.pos;
    const c = b[start]!;
    if (c === 40) return this.literal(start);
    if (c === 60) {
      if (b[start + 1] === 60) {
        this.pos += 2;
        return { kind: "open", ch: "<<", start, end: this.pos };
      }
      return this.hex(start);
    }
    if (c === 62) {
      this.pos += b[start + 1] === 62 ? 2 : 1;
      return { kind: "close", ch: ">>", start, end: this.pos };
    }
    if (c === 91) {
      this.pos++;
      return { kind: "open", ch: "[", start, end: this.pos };
    }
    if (c === 93) {
      this.pos++;
      return { kind: "close", ch: "]", start, end: this.pos };
    }
    if (c === 123 || c === 125 || c === 41) {
      // PostScript procedure braces (CMaps) and a stray ')': no meaning here.
      this.pos++;
      return this.next();
    }
    if (c === 47) {
      this.pos++;
      let name = "";
      while (isRegular(b[this.pos])) {
        const ch = b[this.pos]!;
        if (ch === 35 && this.pos + 2 < b.length) {
          const code = parseInt(latin1(b, this.pos + 1, this.pos + 3), 16);
          if (!Number.isNaN(code)) {
            name += String.fromCharCode(code);
            this.pos += 3;
            continue;
          }
        }
        name += String.fromCharCode(ch);
        this.pos++;
      }
      return {
        kind: "value",
        value: { t: "name", v: name },
        start,
        end: this.pos,
      };
    }
    while (isRegular(b[this.pos])) this.pos++;
    if (this.pos === start) {
      this.pos++;
      return this.next();
    }
    const word = latin1(b, start, this.pos);
    if (NUMBER.test(word)) {
      return { kind: "value", value: Number(word), start, end: this.pos };
    }
    if (word === "true" || word === "false") {
      return {
        kind: "value",
        value: word === "true",
        start,
        end: this.pos,
      };
    }
    if (word === "null") {
      return { kind: "value", value: null, start, end: this.pos };
    }
    return { kind: "op", op: word, start, end: this.pos };
  }

  private literal(start: number): Token {
    const b = this.b;
    this.pos = start + 1;
    const out: number[] = [];
    let depth = 1;
    while (this.pos < b.length) {
      const c = b[this.pos++]!;
      if (c === 92) {
        const n = b[this.pos++];
        if (n === undefined) break;
        if (n === 110) out.push(10);
        else if (n === 114) out.push(13);
        else if (n === 116) out.push(9);
        else if (n === 98) out.push(8);
        else if (n === 102) out.push(12);
        else if (n === 13) {
          if (b[this.pos] === 10) this.pos++;
        } else if (n === 10) {
          // line continuation
        } else if (n >= 48 && n <= 55) {
          let v = n - 48;
          for (let k = 0; k < 2; k++) {
            const d = b[this.pos];
            if (d !== undefined && d >= 48 && d <= 55) {
              v = v * 8 + (d - 48);
              this.pos++;
            } else break;
          }
          out.push(v & 0xff);
        } else out.push(n);
        continue;
      }
      if (c === 40) depth++;
      else if (c === 41) {
        depth--;
        if (depth === 0) break;
      }
      out.push(c);
    }
    return {
      kind: "value",
      value: { t: "str", bytes: Uint8Array.from(out), hex: false },
      start,
      end: this.pos,
    };
  }

  private hex(start: number): Token {
    const b = this.b;
    this.pos = start + 1;
    let digits = "";
    while (this.pos < b.length && b[this.pos] !== 62) {
      const c = b[this.pos++]!;
      if (!WS.has(c)) digits += String.fromCharCode(c);
    }
    this.pos++;
    if (digits.length % 2 === 1) digits += "0";
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16) || 0;
    }
    return {
      kind: "value",
      value: { t: "str", bytes: out, hex: true },
      start,
      end: this.pos,
    };
  }
}

/** Find `EI` after an inline image's data: whitespace before, whitespace or end after. */
function findInlineEnd(b: Uint8Array, from: number): number {
  for (let i = from; i < b.length - 1; i++) {
    if (
      b[i] === 69 &&
      b[i + 1] === 73 &&
      (i === from || isWs(b[i - 1])) &&
      (i + 2 >= b.length || isWs(b[i + 2]) || !isRegular(b[i + 2]))
    ) {
      return i;
    }
  }
  return b.length;
}

/** Parse a content stream (or a CMap) into operations. Never throws. */
export function parseContent(bytes: Uint8Array): ContentOp[] {
  const lx = new Lexer(bytes);
  const ops: ContentOp[] = [];
  let args: PdfValue[] = [];
  let argStart = -1;
  // Nested arrays / dicts under construction.
  const stack: { kind: "[" | "<<"; items: PdfValue[] }[] = [];

  const push = (value: PdfValue) => {
    const top = stack[stack.length - 1];
    if (top) top.items.push(value);
    else args.push(value);
  };

  for (;;) {
    const tok = lx.next();
    if (!tok) break;
    if (argStart < 0 && stack.length === 0) argStart = tok.start;
    if (tok.kind === "value") {
      push(tok.value);
      continue;
    }
    if (tok.kind === "open") {
      stack.push({ kind: tok.ch, items: [] });
      continue;
    }
    if (tok.kind === "close") {
      const top = stack.pop();
      if (!top) continue;
      if (top.kind === "[") push(top.items);
      else {
        const map = new Map<string, PdfValue>();
        for (let i = 0; i + 1 < top.items.length; i += 2) {
          const key = top.items[i];
          if (key && typeof key === "object" && "t" in key && key.t === "name")
            map.set(key.v, top.items[i + 1]!);
        }
        push({ t: "dict", v: map });
      }
      continue;
    }
    // An operator. Anything still open was malformed: flatten it into args.
    while (stack.length) {
      const top = stack.pop()!;
      push(top.items);
    }
    if (tok.op === "BI") {
      // Inline image: key/value pairs up to ID, then raw data up to EI.
      const dict = new Map<string, PdfValue>();
      const start = argStart < 0 ? tok.start : argStart;
      let key: string | null = null;
      let dataStart = bytes.length;
      for (;;) {
        const t = lx.next();
        if (!t) break;
        if (t.kind === "op" && t.op === "ID") {
          dataStart = lx.pos + 1;
          break;
        }
        if (t.kind === "value") {
          const v = t.value;
          if (key === null) {
            if (v && typeof v === "object" && "t" in v && v.t === "name")
              key = v.v;
          } else {
            dict.set(key, v);
            key = null;
          }
        } else if (t.kind === "open" && t.ch === "[") {
          // Arrays in an inline image dict (Decode, Filter): read flat.
          const items: PdfValue[] = [];
          for (;;) {
            const a = lx.next();
            if (!a || a.kind === "close") break;
            if (a.kind === "value") items.push(a.value);
          }
          if (key !== null) {
            dict.set(key, items);
            key = null;
          }
        }
      }
      const ei = findInlineEnd(bytes, dataStart);
      lx.pos = Math.min(bytes.length, ei + 2);
      ops.push({ op: "BI", args: [], start, end: lx.pos, inline: dict });
      args = [];
      argStart = -1;
      continue;
    }
    ops.push({
      op: tok.op,
      args,
      start: argStart < 0 ? tok.start : argStart,
      end: tok.end,
    });
    args = [];
    argStart = -1;
  }
  return ops;
}

/** A replacement for one operation's bytes. */
export interface OpReplacement {
  index: number;
  bytes: Uint8Array;
}

/**
 * The source with some operations' byte ranges replaced and everything else
 * — every other operation, and every byte between operations — copied as is.
 */
export function spliceOps(
  source: Uint8Array,
  ops: readonly ContentOp[],
  replacements: readonly OpReplacement[],
): Uint8Array {
  const sorted = [...replacements].sort((a, b) => a.index - b.index);
  const parts: Uint8Array[] = [];
  let at = 0;
  for (const r of sorted) {
    const op = ops[r.index]!;
    parts.push(source.subarray(at, op.start), r.bytes);
    at = op.end;
  }
  parts.push(source.subarray(at));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** A number as a content stream writes it: up to 4 decimals, no exponent. */
export function num(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 10000) / 10000;
  if (Object.is(r, -0) || r === 0) return "0";
  let s = r.toFixed(4);
  s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

export function hexString(bytes: ArrayLike<number>): string {
  let s = "<";
  for (let i = 0; i < bytes.length; i++)
    s += (bytes[i]! & 0xff).toString(16).padStart(2, "0");
  return `${s}>`;
}

/** Narrowing helpers for operands. */
export const isName = (v: PdfValue | undefined): v is PdfName =>
  !!v && typeof v === "object" && !Array.isArray(v) && v.t === "name";
export const isStr = (v: PdfValue | undefined): v is PdfString =>
  !!v && typeof v === "object" && !Array.isArray(v) && v.t === "str";
export const isNum = (v: PdfValue | undefined): v is number =>
  typeof v === "number";

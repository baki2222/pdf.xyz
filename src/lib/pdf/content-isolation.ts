import type { PDFObject, PDFPage } from "pdf-lib";
import { loadPdfLib, type PdfLibModule } from "./pdf-lib";

/**
 * Isolate a page's ORIGINAL content from whatever an engine draws after it
 * (hostile matrix STAMP-09 / EDIT-09, 2026-11-08).
 *
 * WHY. Every stamping and editing engine draws through pdf-lib, which wraps
 * the page's existing streams ONCE, as `[q, …original, Q]`, and appends its
 * own stream after them. One pair of brackets is only enough when the
 * original is balanced. A page whose content pops past the wrapper's `q`
 * (a surplus `Q`), or leaves two or more `q` open, ends with a transformed
 * CTM still in force when the appended drawing runs, so a page number came
 * out 0.1x size in the corner and an edited box landed at (1,1) instead of
 * (10,10), with the tool reporting success.
 *
 * WHAT. Scan the decoded streams once, counting graphics-state depth the way
 * a viewer executes it: a `Q` with nothing saved is IGNORED (pdf.js, Acrobat).
 * - Every such surplus `Q` is blanked to a space in a rewritten copy of the
 *   page's content. A viewer already ignored it on the page alone, so the
 *   page itself renders as it did before any tool touched it; only now it
 *   cannot pop the wrapper's `q`.
 * - One `Q` per `q` left open is appended after the original, in its own
 *   small stream, so everything it left open is closed.
 * The appended drawing then starts from the page's default state.
 *
 * Why blank rather than prepend one `q` per surplus `Q` (the first design):
 * pdf.js is quadratic in save depth. Measured on this repo's pdf.js, a page
 * with 20,000 nested saves took 4.7 s to read and 100,000 did not finish in
 * 300 s, so prepending would turn a page that renders instantly into one the
 * reader's viewer never finishes. Blanking adds no depth.
 *
 * A balanced page is left byte-identical: nothing is inserted or rewritten.
 * A page with only unclosed `q` keeps its original streams; only the closing
 * stream is added. Only a page with a surplus `Q` gets a rewritten copy (the
 * original stream objects are left alone, in case another page shares them).
 *
 * The scan skips what is not an operator: literal strings (escapes and
 * nested parentheses), hex strings, names, comments, and inline image data
 * between `ID` and `EI` — a `Q` byte inside any of those is not a `Q`.
 *
 * BOUNDED. Decoding stops at {@link ISOLATION_DECODE_BUDGET} decoded bytes
 * per page, read in chunks, so a decompression bomb is not inflated here. A
 * page over the budget, or whose streams pdf-lib cannot decode, is left
 * exactly as before (outcome `skipped`): no worse than before this module,
 * and never a refusal of a real file.
 *
 * ORDER. Call it before drawing on the page. It also works after pdf-lib has
 * already wrapped the page: it finds the wrapper's shared `q`/`Q` streams and
 * works inside them. Results are memoized per page.
 */

/**
 * Decoded content bytes scanned per page before giving up (left as before).
 * 32 MiB: every page of the 14-file legit corpus decodes to under 64 KB
 * (measured, and pinned in content-isolation.test.ts), so the headroom is
 * over 500x; and a scan of 32 MiB stays well under a second.
 */
export const ISOLATION_DECODE_BUDGET = 32 * 1024 * 1024;

/** Graphics-state balance of a page's content, as a viewer executes it. */
export interface ContentBalance {
  /** Byte offsets of each `Q` that pops an empty stack (a viewer ignores it). */
  surplus: number[];
  /** `q` still open at the end. */
  open: number;
}

export type IsolationOutcome =
  | { kind: "balanced" }
  | { kind: "isolated"; blanked: number; closed: number }
  | { kind: "skipped"; reason: "budget" | "unreadable" };

// PDF whitespace: NUL, TAB, LF, FF, CR, SPACE.
const WS = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) WS[c] = 1;
// Delimiters: ( ) < > [ ] { } / %
const DELIM = new Uint8Array(256);
for (const c of [40, 41, 60, 62, 91, 93, 123, 125, 47, 37]) DELIM[c] = 1;

const regular = (c: number | undefined): boolean =>
  c !== undefined && WS[c] === 0 && DELIM[c] === 0;

/** Index of the `EI` ending inline image data that starts at `from`. */
function inlineImageEnd(b: Uint8Array, from: number): number {
  for (let i = from; i < b.length - 1; i += 1) {
    if (
      b[i] === 69 &&
      b[i + 1] === 73 &&
      (i === from || WS[b[i - 1]!] === 1) &&
      (i + 2 >= b.length || !regular(b[i + 2]))
    ) {
      return i;
    }
  }
  return b.length;
}

/**
 * Find the surplus `Q`s and count the `q` left open, in decoded content
 * bytes. Pure, never throws. A page's streams are scanned as one, joined by
 * a newline (a stream boundary is a token boundary).
 */
export function scanContentBalance(b: Uint8Array): ContentBalance {
  let depth = 0;
  const surplus: number[] = [];
  let inInlineDict = false;
  const n = b.length;
  let i = 0;
  while (i < n) {
    const c = b[i]!;
    if (WS[c] === 1) {
      i += 1;
    } else if (c === 37) {
      // % comment, to end of line
      while (i < n && b[i] !== 10 && b[i] !== 13) i += 1;
    } else if (c === 40) {
      // literal string: balanced parentheses, backslash escapes one byte
      let p = 1;
      i += 1;
      while (i < n) {
        const ch = b[i]!;
        i += 1;
        if (ch === 92) i += 1;
        else if (ch === 40) p += 1;
        else if (ch === 41 && --p === 0) break;
      }
    } else if (c === 60) {
      if (b[i + 1] === 60) i += 2;
      else {
        // hex string
        i += 1;
        while (i < n && b[i] !== 62) i += 1;
        i += 1;
      }
    } else if (c === 47) {
      // name
      i += 1;
      while (i < n && regular(b[i])) i += 1;
    } else if (DELIM[c] === 1) {
      // > ] [ { } and a stray )
      i += 1;
    } else {
      const start = i;
      while (i < n && regular(b[i])) i += 1;
      const len = i - start;
      if (inInlineDict) {
        if (len === 2 && b[start] === 73 && b[start + 1] === 68) {
          // ID: one whitespace byte, then raw data up to EI.
          const ei = inlineImageEnd(b, i + 1);
          i = Math.min(n, ei + 2);
          inInlineDict = false;
        }
      } else if (len === 1) {
        if (c === 113) depth += 1;
        else if (c === 81) {
          if (depth === 0) surplus.push(start);
          else depth -= 1;
        }
      } else if (len === 2 && c === 66 && b[start + 1] === 73) {
        inInlineDict = true; // BI
      }
    }
  }
  return { surplus, open: depth };
}

const memo = new WeakMap<object, IsolationOutcome>();

const DECODE_CHUNK = 64 * 1024;

/** Decode one content stream within `remaining` bytes; null = unreadable. */
function decodeStream(
  lib: PdfLibModule,
  obj: PDFObject | undefined,
  remaining: number,
): Uint8Array | "budget" | null {
  if (obj instanceof lib.PDFRawStream) {
    try {
      // In chunks: pdf-lib's decoder preallocates whatever one getBytes
      // asks for, so a single budget-sized read would allocate the budget.
      const stream = lib.decodePDFRawStream(obj);
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const chunk = stream.getBytes(DECODE_CHUNK);
        if (chunk.length === 0) break;
        total += chunk.length;
        if (total > remaining) return "budget";
        chunks.push(new Uint8Array(chunk));
      }
      return join(chunks, total, false);
    } catch {
      return null;
    }
  }
  const unencoded = obj as unknown as {
    getUnencodedContents?: () => Uint8Array;
  };
  if (typeof unencoded?.getUnencodedContents === "function") {
    try {
      const bytes = unencoded.getUnencodedContents();
      return bytes.length > remaining ? "budget" : bytes;
    } catch {
      return null;
    }
  }
  // Not a stream (a null, a dangling ref): viewers skip it; so do we.
  return new Uint8Array(0);
}

/** Concatenate, optionally with a newline after each part. */
function join(parts: Uint8Array[], size: number, newline: boolean): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
    if (newline) out[at++] = 10;
  }
  return out;
}

/**
 * Make sure what is drawn on `page` after this call starts at the page's
 * default graphics state, whatever q/Q imbalance its original content has.
 */
export async function isolatePageContent(
  page: PDFPage,
  budget: number = ISOLATION_DECODE_BUDGET,
): Promise<IsolationOutcome> {
  const known = memo.get(page.node);
  if (known) return known;
  const lib = await loadPdfLib();
  const outcome = isolate(lib, page, budget);
  memo.set(page.node, outcome);
  return outcome;
}

function isolate(
  lib: PdfLibModule,
  page: PDFPage,
  budget: number,
): IsolationOutcome {
  const { PDFArray, PDFName, PDFStream } = lib;
  const ctx = page.doc.context;
  const key = PDFName.of("Contents");
  const raw = page.node.get(key);
  if (raw === undefined) return { kind: "balanced" };
  const contents = ctx.lookup(raw);

  let entries: PDFObject[];
  let lo = 0;
  let hi: number;
  if (contents instanceof PDFArray) {
    entries = contents.asArray();
    hi = entries.length;
    // Already wrapped by pdf-lib (`[q, …, Q, drawn…]`): work inside its
    // shared q/Q streams.
    const shared = ctx as unknown as {
      pushGraphicsStateContentStreamRef?: PDFObject;
      popGraphicsStateContentStreamRef?: PDFObject;
    };
    const push = shared.pushGraphicsStateContentStreamRef;
    const pop = shared.popGraphicsStateContentStreamRef;
    if (push && entries[0] === push) {
      const end = entries.lastIndexOf(pop as PDFObject);
      if (end > 0) {
        lo = 1;
        hi = end;
      }
    }
  } else if (contents instanceof PDFStream) {
    entries = [raw];
    hi = 1;
  } else {
    return { kind: "balanced" };
  }

  const parts: Uint8Array[] = [];
  let used = 0;
  for (let k = lo; k < hi; k += 1) {
    const data = decodeStream(lib, ctx.lookup(entries[k]!), budget - used);
    if (data === null) return { kind: "skipped", reason: "unreadable" };
    if (data === "budget") return { kind: "skipped", reason: "budget" };
    parts.push(data);
    used += data.length + 1;
    if (used > budget) return { kind: "skipped", reason: "budget" };
  }
  const joined = join(parts, used, true);
  const { surplus, open } = scanContentBalance(joined);
  if (surplus.length === 0 && open === 0) return { kind: "balanced" };

  // The original streams, or one rewritten copy with each surplus Q blanked.
  let body: PDFObject[] = entries.slice(lo, hi);
  if (surplus.length > 0) {
    for (const at of surplus) joined[at] = 32;
    body = [ctx.register(ctx.flateStream(joined))];
  }
  if (open > 0) {
    // Deflated: a hostile page can leave thousands open.
    body.push(ctx.register(ctx.flateStream("Q\n".repeat(open))));
  }
  if (contents instanceof PDFArray) {
    for (let k = hi - 1; k >= lo; k -= 1) contents.remove(k);
    body.forEach((ref, k) => contents.insert(lo + k, ref));
  } else {
    page.node.set(key, ctx.obj(body));
  }
  return { kind: "isolated", blanked: surplus.length, closed: open };
}

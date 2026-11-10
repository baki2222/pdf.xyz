/**
 * What pdf.js's page lookup will push, read from the file's text: every
 * `/Kids` array's elements, and every `/Kids` key, for the pdf.js
 * preflight's page-tree bound (`PDFJS_BOARD_MAX_WALK` in ./pdfjs-guard).
 *
 * pdf.js finds page i (`Catalog.getPageDict`) by walking the page tree from
 * its root, and every node it expands pushes EVERY element of its /Kids,
 * whatever page it wants. Each node is expanded at most once per lookup (a
 * second visit is pdf.js's "circular reference" refusal), so one lookup
 * pushes at most the sum of every /Kids array's length and expands at most
 * every /Kids-bearing node. Those two numbers are what this counts: from the
 * arrays the file CONTAINS, never from the /Count it declares (hostile
 * review, 2026-11-10: a /Count of 10,000 over a root /Kids of 1,000,000
 * entries passed a bound on /Count and read for 130 s).
 *
 * Fed in chunks (the file's bytes, then each decoded object stream), like
 * `ContentsRefs` beside it. It reads stream data too, so it may count more
 * than a page tree holds; never fewer, for any text it is fed — strings,
 * hex strings, comments, nested arrays and dictionaries are lexed as pdf.js
 * lexes them, so a `]` inside `(...)` does not end an array early.
 *
 * Its own module so that nothing here reaches a first-load bundle
 * (pdfjs-guard is loaded with `import()`).
 */
import { isDelimiter, isWhite } from "./pdf-scan-bytes";

/** Containers deeper than this are not followed: the count is unbounded. */
const MAX_NESTING = 1024;

const isRegular = (b: number): boolean => !isWhite(b) && !isDelimiter(b);

const decodeName = (raw: string): string =>
  raw.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) =>
    String.fromCharCode(parseInt(h, 16)),
  );

const KIDS = "Kids";

// Outside every /Kids array.
const O_SCAN = 0;
const O_NAME = 1;
const O_VALUE = 2;
const O_REF = 3;
// Inside one: a full lexer.
const I_BETWEEN = 10;
const I_REGULAR = 11;
const I_NAME = 12;
const I_STRING = 13;
const I_HEX = 14;
const I_AFTER_LT = 15;
const I_AFTER_GT = 16;

/** A /Kids array being counted, opened at container depth `depth`. */
interface OpenArray {
  depth: number;
  elements: number;
  /** Integers read at this depth that may still be the start of `n g R`. */
  pending: number;
}

/**
 * The elements of every `/Kids` array in the text it is fed, the `/Kids`
 * keys, and each `/Kids n g R` (an array held in another object).
 */
export class KidsCounter {
  /** Elements of every direct /Kids array, nested ones included, summed. */
  entries = 0;
  /** /Kids keys whose value is an array or a reference: nodes pdf.js may expand. */
  nodes = 0;
  /** Each lone `/Kids n g R`: how many times it appears, by object number. */
  readonly indirect = new Map<number, number>();
  /** Containers nested past {@link MAX_NESTING}: nothing here bounds the count. */
  unbounded = false;

  private state = O_SCAN;
  private comment = false;
  /** The name being read (outside: after `/`; inside: a name token). */
  private name = "";
  /** Outside, after `/Kids`: the integers of a lone `n g R`. */
  private ints: number[] = [];
  /** Inside: open containers, `[` as 1 and `<<` as 2. */
  private containers: number[] = [];
  /** Inside: the /Kids arrays open, innermost last. */
  private open: OpenArray[] = [];
  /** Inside: the regular token being read. */
  private tokLen = 0;
  private tokDigits = true;
  private tokValue = 0;
  private tokFirst = 0;
  /** Inside: string paren depth, and whether the last byte was a `\`. */
  private parens = 0;
  private escaped = false;
  /**
   * Inside, after a `/Kids` name: 1 waiting for its value, 2 after one
   * integer, 3 after two; `kidsNum` holds the first.
   */
  private kidsAfter = 0;
  private kidsNum = 0;
  /** Set by {@link arrayElementsAt}: stop once the first array closes. */
  private stopOnClose = false;
  private stopped = false;

  /**
   * End the text fed so far and forget the tokenizer state: the next chunk
   * does not continue this one. An array still open is counted as far as it
   * was read.
   */
  reset(): void {
    if (this.state === O_REF) this.finishLoneRef();
    this.endToken();
    for (const a of this.open) this.entries += a.elements + a.pending;
    this.state = O_SCAN;
    this.comment = false;
    this.name = "";
    this.ints = [];
    this.containers = [];
    this.open = [];
    this.kidsAfter = 0;
    this.parens = 0;
    this.escaped = false;
  }

  feed(chunk: Uint8Array): void {
    let i = 0;
    while (i < chunk.length && !this.stopped) {
      const s = this.state;
      if (s === O_SCAN) {
        const slash = chunk.indexOf(0x2f, i);
        if (slash === -1) return;
        this.state = O_NAME;
        this.name = "";
        i = slash + 1;
        continue;
      }
      const b = chunk[i]!;
      if (this.comment) {
        if (b === 0x0a || b === 0x0d) this.comment = false;
        i += 1;
        continue;
      }
      if (s === O_NAME) {
        if (isRegular(b)) {
          if (this.name.length < 64) this.name += String.fromCharCode(b);
          i += 1;
          continue;
        }
        this.state = decodeName(this.name) === KIDS ? O_VALUE : O_SCAN;
        continue; // the delimiter is read again in the new state
      }
      if (s === O_VALUE) {
        if (isWhite(b)) i += 1;
        else if (b === 0x25) {
          this.comment = true;
          i += 1;
        } else if (b === 0x5b) {
          this.nodes += 1;
          this.enterArray();
          i += 1;
        } else if (isRegular(b)) {
          this.state = O_REF;
          this.ints = [];
          this.name = "";
        } else this.state = O_SCAN;
        continue;
      }
      if (s === O_REF) {
        if (isRegular(b)) {
          if (this.name.length < 16) this.name += String.fromCharCode(b);
          i += 1;
          continue;
        }
        if (this.name !== "") {
          const tok = this.name;
          this.name = "";
          if (/^\d+$/.test(tok) && this.ints.length < 2) {
            this.ints.push(Number(tok));
          } else {
            if (tok === "R" && this.ints.length === 2) this.addIndirect();
            this.state = O_SCAN;
            continue;
          }
        }
        if (b === 0x25) this.comment = true;
        else if (!isWhite(b)) {
          this.state = O_SCAN;
          continue;
        }
        i += 1;
        continue;
      }
      i = this.inside(chunk, i);
    }
  }

  private enterArray(): void {
    this.state = I_BETWEEN;
    this.containers = [1];
    this.open = [{ depth: 1, elements: 0, pending: 0 }];
  }

  private addIndirect(): void {
    const num = this.ints[0]!;
    this.nodes += 1;
    this.indirect.set(num, (this.indirect.get(num) ?? 0) + 1);
    this.ints = [];
  }

  private finishLoneRef(): void {
    if (this.name === "R" && this.ints.length === 2) this.addIndirect();
    this.name = "";
    this.ints = [];
  }

  /** An element of kind `k` starts at the current depth: 0 int, 1 `R`, 2 other. */
  private element(k: 0 | 1 | 2): void {
    const top = this.open[this.open.length - 1];
    if (!top || top.depth !== this.containers.length) return;
    if (k === 0) {
      top.pending += 1;
      if (top.pending > 2) {
        top.elements += 1;
        top.pending = 2;
      }
    } else if (k === 1 && top.pending === 2) {
      top.elements += 1;
      top.pending = 0;
    } else {
      top.elements += top.pending + 1;
      top.pending = 0;
    }
  }

  /** Anything but an integer or `R` follows a `/Kids` name: not a node. */
  private notKids(): void {
    this.kidsAfter = 0;
  }

  private push(kind: 1 | 2): void {
    if (this.containers.length >= MAX_NESTING) {
      this.unbounded = true;
      return;
    }
    this.containers.push(kind);
  }

  /** Close the innermost container; leave the inside state when none is left. */
  private pop(): void {
    const depth = this.containers.length;
    const top = this.open[this.open.length - 1];
    if (top && top.depth === depth) {
      this.entries += top.elements + top.pending;
      this.open.pop();
    }
    this.containers.pop();
    if (this.containers.length === 0) {
      this.state = O_SCAN;
      this.open = [];
      if (this.stopOnClose) this.stopped = true;
    }
  }

  /** Finish a regular token (inside) if one is in progress. */
  private endToken(): void {
    if (this.state !== I_REGULAR) return;
    this.state = I_BETWEEN;
    const isInt = this.tokDigits && this.tokLen > 0;
    const isR = this.tokLen === 1 && this.tokFirst === 0x52;
    this.element(isInt ? 0 : isR ? 1 : 2);
    if (this.kidsAfter > 0) {
      if (isInt && this.kidsAfter < 3) {
        if (this.kidsAfter === 1) this.kidsNum = this.tokValue;
        this.kidsAfter += 1;
      } else {
        if (isR && this.kidsAfter === 3) {
          this.nodes += 1;
          this.indirect.set(
            this.kidsNum,
            (this.indirect.get(this.kidsNum) ?? 0) + 1,
          );
        }
        this.kidsAfter = 0;
      }
    }
  }

  /** One step of the lexer inside a /Kids array; the next index. */
  private inside(chunk: Uint8Array, i: number): number {
    const b = chunk[i]!;
    switch (this.state) {
      case I_REGULAR:
        if (isRegular(b)) {
          this.tokLen += 1;
          if (this.tokDigits && b >= 0x30 && b <= 0x39) {
            if (this.tokLen <= 15) this.tokValue = this.tokValue * 10 + b - 48;
          } else this.tokDigits = false;
          return i + 1;
        }
        this.endToken();
        return i; // the delimiter is read again
      case I_NAME:
        if (isRegular(b)) {
          if (this.name.length < 64) this.name += String.fromCharCode(b);
          return i + 1;
        }
        this.state = I_BETWEEN;
        if (decodeName(this.name) === KIDS) this.kidsAfter = 1;
        return i;
      case I_STRING:
        if (this.escaped) this.escaped = false;
        else if (b === 0x5c) this.escaped = true;
        else if (b === 0x28) this.parens += 1;
        else if (b === 0x29) {
          this.parens -= 1;
          if (this.parens === 0) this.state = I_BETWEEN;
        }
        return i + 1;
      case I_HEX:
        if (b === 0x3e) this.state = I_BETWEEN;
        return i + 1;
      case I_AFTER_LT:
        this.state = I_BETWEEN;
        if (b === 0x3c) {
          this.element(2);
          this.notKids();
          this.push(2);
          return i + 1;
        }
        this.element(2);
        this.notKids();
        this.state = I_HEX;
        return i;
      case I_AFTER_GT:
        this.state = I_BETWEEN;
        if (b === 0x3e) {
          // `>>` closes a dictionary; inside an array it is an element.
          if (this.containers[this.containers.length - 1] === 2) this.pop();
          else {
            this.element(2);
            this.notKids();
          }
          return i + 1;
        }
        return i; // a lone `>`: pdf.js skips it
      default:
        break;
    }
    // I_BETWEEN
    if (isWhite(b)) return i + 1;
    if (isRegular(b)) {
      this.state = I_REGULAR;
      this.tokLen = 1;
      this.tokFirst = b;
      this.tokDigits = b >= 0x30 && b <= 0x39;
      this.tokValue = this.tokDigits ? b - 48 : 0;
      return i + 1;
    }
    switch (b) {
      case 0x25: // %
        this.comment = true;
        return i + 1;
      case 0x2f: // /
        this.element(2);
        this.notKids();
        this.state = I_NAME;
        this.name = "";
        return i + 1;
      case 0x28: // (
        this.element(2);
        this.notKids();
        this.state = I_STRING;
        this.parens = 1;
        this.escaped = false;
        return i + 1;
      case 0x3c: // <
        this.state = I_AFTER_LT;
        return i + 1;
      case 0x3e: // >
        this.state = I_AFTER_GT;
        return i + 1;
      case 0x5b: {
        // [
        const wasKids = this.kidsAfter === 1;
        this.element(2);
        this.notKids();
        this.push(1);
        if (wasKids) {
          this.nodes += 1;
          this.open.push({
            depth: this.containers.length,
            elements: 0,
            pending: 0,
          });
        }
        return i + 1;
      }
      case 0x5d: // ]
        // Inside a dictionary pdf.js ignores a `]`.
        if (this.containers[this.containers.length - 1] === 1) {
          this.notKids();
          this.pop();
        }
        return i + 1;
      default:
        // `{`, `}`, a stray `)`: pdf.js reads each as a command.
        this.element(2);
        this.notKids();
        return i + 1;
    }
  }

  /**
   * The elements of the array that opens at `i` (a `[`), nested /Kids
   * arrays' elements included, reading at most `limit` bytes.
   */
  static arrayElementsAt(bytes: Uint8Array, i: number, limit: number): number {
    const c = new KidsCounter();
    c.stopOnClose = true;
    c.enterArray();
    c.feed(bytes.subarray(i + 1, Math.min(bytes.length, i + limit)));
    c.reset();
    return c.unbounded ? Number.POSITIVE_INFINITY : c.entries;
  }
}

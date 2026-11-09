import { inflateSync, constants } from "node:zlib";

/**
 * A reader for "is this text ANYWHERE in the saved file?" that does not trust
 * the library that wrote the file. It finds every `N G obj … endobj` in the
 * raw bytes, DECODES every Flate stream (object streams included, whose
 * decoded body is read as more objects), and decodes every literal and hex
 * string it meets — UTF-16BE with its byte-order mark, or bytes. The corpus
 * it returns is what a person with a text editor and zlib could read.
 *
 * Budgeted: one stream inflates to at most {@link STREAM_BUDGET} bytes, and
 * every stream together to {@link TOTAL_BUDGET}; a stream past it is
 * reported in `overBudget`, never silently skipped.
 *
 * `stats` is the health check: a reader that found no objects or decoded no
 * stream would answer "absent" for every marker, the strongest possible
 * pass. Callers assert on it.
 */

const STREAM_BUDGET = 32 * 1024 * 1024;
const TOTAL_BUDGET = 256 * 1024 * 1024;

export interface DecodedScan {
  /** Raw object text, decoded stream bodies, and decoded strings. */
  corpus: string;
  stats: {
    objects: number;
    streams: number;
    decoded: number;
    objectStreams: number;
    strings: number;
    overBudget: number;
  };
}

const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");

function decodeStringBytes(raw: number[]): string {
  if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < raw.length; i += 2) {
      out += String.fromCharCode((raw[i]! << 8) | raw[i + 1]!);
    }
    return out;
  }
  return String.fromCharCode(...raw);
}

/** Every literal `( … )` and hex `< … >` string in `text`, decoded. */
function strings(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "%") {
      while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i += 1;
    } else if (c === "(") {
      const raw: number[] = [];
      let depth = 1;
      i += 1;
      for (; i < text.length && depth > 0; i += 1) {
        const ch = text[i]!;
        if (ch === "\\") {
          const next = text[i + 1] ?? "";
          const esc: Record<string, number> = {
            n: 10,
            r: 13,
            t: 9,
            b: 8,
            f: 12,
            "(": 40,
            ")": 41,
            "\\": 92,
          };
          if (next in esc) {
            raw.push(esc[next]!);
            i += 1;
          } else if (/[0-7]/.test(next)) {
            let oct = "";
            while (oct.length < 3 && /[0-7]/.test(text[i + 1] ?? "")) {
              oct += text[i + 1];
              i += 1;
            }
            raw.push(parseInt(oct, 8) & 0xff);
          } else if (next === "\r" || next === "\n") {
            i += next === "\r" && text[i + 2] === "\n" ? 2 : 1;
          }
          continue;
        }
        if (ch === "(") depth += 1;
        if (ch === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
        raw.push(ch.charCodeAt(0) & 0xff);
      }
      out.push(decodeStringBytes(raw));
    } else if (c === "<" && text[i + 1] !== "<") {
      const end = text.indexOf(">", i);
      if (end < 0) break;
      const hex = text.slice(i + 1, end).replace(/[^0-9a-fA-F]/g, "");
      const raw: number[] = [];
      for (let j = 0; j < hex.length; j += 2) {
        raw.push(parseInt((hex[j]! + (hex[j + 1] ?? "0")).padEnd(2, "0"), 16));
      }
      out.push(decodeStringBytes(raw));
      i = end;
    } else if (c === "<") {
      i += 1; // a dictionary's `<<`
    }
  }
  return out;
}

const isSpace = (c: string | undefined) =>
  c === " " ||
  c === "\n" ||
  c === "\r" ||
  c === "\t" ||
  c === "\f" ||
  c === "\0";

/**
 * Walk an object body from `start` as TOKENS — skipping literal strings
 * (escapes and nesting), hex strings and comments — to the first `endobj`
 * keyword, or to a `stream` keyword that follows a dictionary's `>>`.
 * Matching either word as a substring read `(see the upstream fix)` as a
 * stream and `(endobj …)` as the object's end (pdf-decoded-scan.test.ts).
 */
function objectExtent(
  text: string,
  start: number,
): { stream: number; endobj: number } {
  let lastToken = "";
  for (let i = start; i < text.length;) {
    const c = text[i]!;
    if (isSpace(c)) {
      i += 1;
    } else if (c === "%") {
      while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i += 1;
    } else if (c === "(") {
      let depth = 1;
      i += 1;
      while (i < text.length && depth > 0) {
        const ch = text[i]!;
        if (ch === "\\") i += 2;
        else {
          if (ch === "(") depth += 1;
          else if (ch === ")") depth -= 1;
          i += 1;
        }
      }
      lastToken = ")";
    } else if (c === "<" && text[i + 1] === "<") {
      i += 2;
      lastToken = "<<";
    } else if (c === ">" && text[i + 1] === ">") {
      i += 2;
      lastToken = ">>";
    } else if (c === "<") {
      const end = text.indexOf(">", i);
      i = end < 0 ? text.length : end + 1;
      lastToken = ">";
    } else if (text.startsWith("endobj", i)) {
      return { stream: -1, endobj: i };
    } else if (
      text.startsWith("stream", i) &&
      lastToken === ">>" &&
      (isSpace(text[i + 6]) || i + 6 >= text.length)
    ) {
      return { stream: i, endobj: -1 };
    } else {
      // A name, number, keyword or delimiter: one character at a time is
      // enough, since only the two keywords above end the walk.
      lastToken = c;
      i += 1;
    }
  }
  return { stream: -1, endobj: -1 };
}

export function decodedScan(bytes: Uint8Array): DecodedScan {
  const stats = {
    objects: 0,
    streams: 0,
    decoded: 0,
    objectStreams: 0,
    strings: 0,
    overBudget: 0,
  };
  const parts: string[] = [];
  let spent = 0;

  const scanObjects = (text: string, data: Uint8Array | null) => {
    const header = /(\d+)\s+(\d+)\s+obj\b/g;
    let m: RegExpExecArray | null;
    while ((m = header.exec(text))) {
      stats.objects += 1;
      const start = m.index + m[0].length;
      const extent = objectExtent(text, start);
      const streamAt = extent.stream;
      if (streamAt < 0 || !data) {
        const end = extent.endobj < 0 ? text.length : extent.endobj;
        parts.push(text.slice(start, end));
        // Forward only: a cursor moved backwards loops forever.
        header.lastIndex = Math.max(end, start);
        continue;
      }
      const dict = text.slice(start, streamAt);
      parts.push(dict);
      let dataStart = streamAt + "stream".length;
      if (text[dataStart] === "\r") dataStart += 1;
      if (text[dataStart] === "\n") dataStart += 1;
      const lengthMatch = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dict);
      let dataEnd =
        lengthMatch && !lengthMatch[2]
          ? dataStart + Number(lengthMatch[1])
          : text.indexOf("endstream", dataStart);
      if (dataEnd < dataStart || dataEnd > text.length) {
        dataEnd = text.indexOf("endstream", dataStart);
      }
      // No end at all: the rest of the file is this stream's data.
      if (dataEnd < dataStart) dataEnd = text.length;
      stats.streams += 1;
      const body = data.subarray(dataStart, dataEnd);
      let decoded: Uint8Array = body;
      if (/\/FlateDecode|\/Fl\b/.test(dict)) {
        if (spent > TOTAL_BUDGET) {
          stats.overBudget += 1;
          decoded = new Uint8Array();
        } else {
          try {
            decoded = inflateSync(body, {
              maxOutputLength: STREAM_BUDGET,
              finishFlush: constants.Z_SYNC_FLUSH,
            });
            stats.decoded += 1;
            spent += decoded.byteLength;
          } catch {
            stats.overBudget += 1;
            decoded = new Uint8Array();
          }
        }
      }
      const decodedText = latin1(decoded);
      parts.push(decodedText);
      if (/\/Type\s*\/ObjStm/.test(dict)) {
        stats.objectStreams += 1;
        // An object stream's objects carry no `obj` headers: its strings are
        // read from the decoded text below, as the rest is.
      }
      const after = text.indexOf("endobj", dataEnd);
      header.lastIndex = Math.max(after < 0 ? text.length : after, dataEnd);
    }
  };
  scanObjects(latin1(bytes), bytes);
  // The trailer (an Info reference, an ID) sits outside every object.
  const tail = latin1(bytes).lastIndexOf("trailer");
  if (tail >= 0) parts.push(latin1(bytes).slice(tail));

  const raw = parts.join("\n");
  const decodedStrings = strings(raw);
  stats.strings = decodedStrings.length;
  return { corpus: `${raw}\n${decodedStrings.join("\n")}`, stats };
}

/** The markers of `markers` that appear anywhere in the decoded file. */
export function markersFound(
  bytes: Uint8Array,
  markers: readonly string[],
): string[] {
  const { corpus } = decodedScan(bytes);
  return markers.filter((m) => corpus.includes(m));
}

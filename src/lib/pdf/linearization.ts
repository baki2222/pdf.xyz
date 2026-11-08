/**
 * Is this PDF actually linearized ("fast web view")? Read from the BYTES.
 *
 * Optimize for Web promises one property: the file is linearized, so a viewer
 * can show page one before the rest downloads. Until 2026-09-27 nothing
 * anywhere read an output for it. The worker trusted `qpdf --linearize` to
 * have done it, the deployment proof checked `%PDF-` at byte 0 and printed
 * "linearized PDF", and the panel said "Your web-optimized PDF is ready." on
 * any success. A worker image that ran a rewrite without the flag would have
 * stayed green at every one of those, while every user downloaded a file that
 * loads no faster than the one they uploaded.
 *
 * The test is the one ISO 32000 defines, and the one pdf.js applies before it
 * trusts a file as linearized (`Linearization.create`):
 *
 *  - the FIRST indirect object after the header is a dictionary carrying
 *    `/Linearized` with a positive number, and it sits wholly inside the first
 *    1024 bytes;
 *  - its `/L` integer — "the length of the entire file in bytes" — equals the
 *    file's actual length.
 *
 * The second clause is what makes this a claim about THESE bytes rather than
 * about a marker: a file with an incremental update appended after
 * linearization keeps the dictionary but no longer loads linearly, and pdf.js
 * treats it as not linearized. So does this.
 *
 * Node-free and dependency-free, so the worker engine, the deployment proof and
 * the browser panel all ask the same question of the same bytes.
 */

/** ISO 32000-1 §F.2: the linearization dictionary lies in the first 1024 bytes. */
export const LINEARIZATION_WINDOW = 1024;

/** PDF white-space characters (ISO 32000-1 Table 1), as a regex class body. */
const WS = "\\0\\t\\n\\f\\r ";

/**
 * Header line, then any run of white space and comment lines (the binary
 * marker comment `%âãÏÓ` is one), then `N G obj <<`: the first object's
 * opening. Where the dictionary ENDS is found by {@link topLevelDict}, not by
 * this regex: a lazy `<<…>>` stopped at the first nested `>>` and read a
 * nested dictionary's `/L` as the file's (hostile matrix SIB-13).
 */
const FIRST_OBJECT = new RegExp(
  `^%PDF-[^\\r\\n]*(?:[${WS}]|%[^\\r\\n]*)*` +
    `(\\d+)[${WS}]+(\\d+)[${WS}]+obj[${WS}]*<<`,
);

/**
 * The dictionary that opens at `from` (just past its `<<`), with everything
 * nested in it — dictionaries, arrays, literal and hex strings — blanked to
 * spaces, so only its OWN keys remain to be read. `null` when it does not
 * close inside `text` (the window).
 */
function topLevelDict(text: string, from: number): string | null {
  let out = "";
  let depth = 0; // nested `<<` / `[` inside the top-level dictionary
  let i = from;
  while (i < text.length) {
    const c = text[i]!;
    const pair = text.slice(i, i + 2);
    if (c === "(") {
      // A literal string, with its balanced parens and `\` escapes.
      let parens = 1;
      i += 1;
      while (i < text.length && parens > 0) {
        const s = text[i]!;
        if (s === "\\") i += 1;
        else if (s === "(") parens += 1;
        else if (s === ")") parens -= 1;
        i += 1;
      }
      if (parens > 0) return null;
      out += " ";
      continue;
    }
    if (pair === "<<" || c === "[") {
      depth += 1;
      i += c === "[" ? 1 : 2;
      out += " ";
      continue;
    }
    if (pair === ">>" || c === "]") {
      if (depth === 0) return c === "]" ? null : out;
      depth -= 1;
      i += c === "]" ? 1 : 2;
      out += " ";
      continue;
    }
    if (c === "<") {
      // A hex string.
      const end = text.indexOf(">", i + 1);
      if (end < 0) return null;
      i = end + 1;
      out += " ";
      continue;
    }
    out += depth === 0 ? c : " ";
    i += 1;
  }
  return null;
}

/** `/Linearized <positive number>` — the name must end where the key ends. */
const LINEARIZED_KEY = new RegExp(
  `/Linearized(?=[${WS}/\\[<(])[${WS}]*([+-]?(?:\\d+\\.?\\d*|\\.\\d+))`,
);

/**
 * `/L <integer>`. An integer after a name needs white space between them (a
 * digit would continue the name), which also keeps this off `/Linearized`.
 */
const LENGTH_KEY = new RegExp(`/L[${WS}]+(\\d+)(?![\\d.])`);

export interface LinearizationDict {
  /** The `/L` the file declares for itself: its own length, in bytes. */
  declaredLength: number;
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

/**
 * The linearization dictionary, when the first object is one. `null` when the
 * first object is anything else, lies past the window, or lacks a positive
 * `/Linearized` or an integer `/L`.
 */
export function readLinearizationDict(
  bytes: Uint8Array,
): LinearizationDict | null {
  const head = latin1(
    bytes.subarray(0, Math.min(bytes.byteLength, LINEARIZATION_WINDOW)),
  );
  // The spec tolerates junk before the header; the window is still counted
  // from byte 0, so the dictionary must close inside it either way.
  const start = head.indexOf("%PDF-");
  if (start < 0) return null;
  const tail = head.slice(start);
  const first = FIRST_OBJECT.exec(tail);
  if (!first) return null;
  const dict = topLevelDict(tail, first[0].length);
  if (dict === null) return null;

  const flag = LINEARIZED_KEY.exec(dict);
  if (!flag || !(Number(flag[1]) > 0)) return null;
  const length = LENGTH_KEY.exec(dict);
  if (!length) return null;
  const declaredLength = Number(length[1]);
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) return null;
  return { declaredLength };
}

/** True only when the first object is a linearization dict whose `/L` is this file's length. */
export function isLinearized(bytes: Uint8Array): boolean {
  const dict = readLinearizationDict(bytes);
  return dict !== null && dict.declaredLength === bytes.byteLength;
}

/**
 * The same test as {@link isLinearized}, with the measurement spelled out —
 * for a proof whose operator should read what was checked, not just "ok".
 */
export function linearizationVerdict(bytes: Uint8Array): {
  ok: boolean;
  detail: string;
} {
  const dict = readLinearizationDict(bytes);
  if (!dict) {
    return {
      ok: false,
      detail: `no linearization dictionary as the first object in the first ${LINEARIZATION_WINDOW} bytes of ${bytes.byteLength}B`,
    };
  }
  if (dict.declaredLength !== bytes.byteLength) {
    return {
      ok: false,
      detail: `linearization dictionary declares /L=${dict.declaredLength}, but the file is ${bytes.byteLength}B`,
    };
  }
  return {
    ok: true,
    detail: `linearized: /L=${dict.declaredLength} matches the ${bytes.byteLength}B file`,
  };
}

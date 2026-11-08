// An independent q/Q/cm interpreter for hostile-matrix lane l06 (STAMP-09 /
// EDIT-09). Deliberately NOT built on src/lib/pdf/content-isolation.ts: it is
// the second bound on that module, so it shares none of its code, works on a
// latin1 string instead of bytes, and follows the matrix's ctmAtStamp
// (test/hostile-matrix, src/tests/hostile/stamping.cells.ts). A `Q` with
// nothing saved is ignored, as pdf.js and Acrobat do.
//
// It reads a page pdf.js would need minutes for (100,000 nested q), which is
// why the 100k fixtures are measured here and the small ones through pdf.js.
import type { PDFDocument as PDFDocumentType } from "pdf-lib";

export type Matrix = [number, number, number, number, number, number];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

/** Page 1's content streams, decoded and joined, as latin1 text. */
async function pageSource(bytes: Uint8Array): Promise<string> {
  const lib = await import("pdf-lib");
  const doc: PDFDocumentType = await lib.PDFDocument.load(bytes, {
    ignoreEncryption: true,
  });
  const contents = doc.getPage(0).node.Contents();
  if (!contents) return "";
  const refs =
    contents instanceof lib.PDFArray ? contents.asArray() : [contents];
  const chunks: string[] = [];
  for (const ref of refs) {
    const stream = doc.context.lookup(ref);
    if (stream instanceof lib.PDFRawStream) {
      chunks.push(
        Buffer.from(lib.decodePDFRawStream(stream).decode()).toString("latin1"),
      );
    } else if (stream instanceof lib.PDFContentStream) {
      chunks.push(Buffer.from(stream.getContents()).toString("latin1"));
    }
  }
  return chunks.join("\n");
}

/**
 * The CTM in force at the LAST painting operator of page 1 (`BT`, `Do`, or a
 * path painted by `f`/`S`/`B`/`re`), which every engine draws last, and the
 * save depth there.
 */
export async function ctmAtLastDraw(
  bytes: Uint8Array,
): Promise<{ ctm: Matrix; depth: number } | null> {
  const src = await pageSource(bytes);
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const saved: Matrix[] = [];
  const operands: number[] = [];
  let at: { ctm: Matrix; depth: number } | null = null;
  const n = src.length;
  const isWs = (c: string) => " \t\r\n\f\0".includes(c);
  const isDelim = (c: string) => "()<>[]{}/%".includes(c);
  let i = 0;
  while (i < n) {
    const c = src[i]!;
    if (isWs(c)) i += 1;
    else if (c === "%") {
      while (i < n && src[i] !== "\n" && src[i] !== "\r") i += 1;
    } else if (c === "(") {
      let depth = 1;
      i += 1;
      while (i < n && depth > 0) {
        if (src[i] === "\\") i += 2;
        else {
          if (src[i] === "(") depth += 1;
          else if (src[i] === ")") depth -= 1;
          i += 1;
        }
      }
      operands.length = 0;
    } else if (c === "<" && src[i + 1] !== "<") {
      i = src.indexOf(">", i);
      i = i < 0 ? n : i + 1;
      operands.length = 0;
    } else if ("<>[]{})".includes(c)) {
      i += c === "<" || c === ">" ? 2 : 1;
    } else if (c === "/") {
      i += 1;
      while (i < n && !isWs(src[i]!) && !isDelim(src[i]!)) i += 1;
    } else {
      const start = i;
      while (i < n && !isWs(src[i]!) && !isDelim(src[i]!)) i += 1;
      const token = src.slice(start, i);
      const num = Number(token);
      if (Number.isFinite(num) && /^[+-]?[\d.]/.test(token)) {
        operands.push(num);
        continue;
      }
      if (token === "q") saved.push([...ctm]);
      else if (token === "Q") ctm = saved.pop() ?? ctm;
      else if (token === "cm" && operands.length >= 6) {
        ctm = multiply(operands.slice(-6) as Matrix, ctm);
      } else if (["BT", "Do", "re", "f", "S", "B"].includes(token)) {
        at = { ctm: [...ctm], depth: saved.length };
      } else if (token === "BI") {
        const end = src.indexOf(" EI", i);
        i = end < 0 ? n : end + 3;
      }
      operands.length = 0;
    }
  }
  return at;
}

/** The linear scale of a matrix (sqrt of |det|): 1 for no scaling. */
export const scaleOf = (m: Matrix): number =>
  Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

/**
 * Lane l02, SIB-03 after the second review: files that hand pdf.js a long
 * xref-row walk through routes the first two pre-scans did not read. Each
 * builder takes the row count, so the same file at an honest count is its own
 * positive control (the reviewer's controls used /Size 6; every one opens as
 * one unencrypted page in pdf.js).
 */
import { deflateSync } from "node:zlib";
import {
  ONE_PAGE,
  concatBytes,
  latin1,
  xrefStreamPdf,
} from "./security-in-browser.fixtures";

/** 2^31 - 1: the row count every reviewer repro used. */
export const HUGE_ROWS = 2_147_483_647;

/** `N 0 obj`, with an optional stream (its /Length added). */
function obj(num: number, dict: string, stream?: Uint8Array): Uint8Array {
  if (!stream) return latin1(`${num} 0 obj\n${dict}\nendobj\n`);
  return concatBytes(
    latin1(`${num} 0 obj\n<< ${dict} /Length ${stream.length} >>\nstream\n`),
    stream,
    latin1("\nendstream\nendobj\n"),
  );
}

/** Header, catalog, pages and one page: objects 1 to 3. */
function body(): Uint8Array[] {
  return [
    latin1("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"),
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>"),
  ];
}

const sizeOf = (parts: Uint8Array[]) => parts.reduce((n, p) => n + p.length, 0);

/**
 * (a), (b): zero-width rows with /Index an empty string. pdf.js reads
 * `dict.get("Index") || [0, Size]`, and `()` and `<>` are both "".
 */
export function indexEmptyString(spelling: "()" | "<>", size: number) {
  return xrefStreamPdf({
    objects: ONE_PAGE,
    w: "[0 0 0]",
    index: spelling,
    size: String(size),
  });
}

/**
 * (c): startxref points at nothing, so pdf.js rebuilds by scanning and reads
 * the `/Type /XRef` stream it finds, then follows its /Prev to an older
 * stream with no /Type and rows zero bytes wide.
 */
export function recoveryPrev(size: number): Uint8Array {
  const parts = body();
  const olderAt = sizeOf(parts);
  parts.push(obj(4, `/W [0 0 0] /Size ${size}`, new Uint8Array(0)));
  const rows = new Uint8Array([0, 0, 0, 0, 1, 0, 15, 0]);
  parts.push(
    obj(5, `/Type /XRef /W [1 2 1] /Size 2 /Root 1 0 R /Prev ${olderAt}`, rows),
  );
  parts.push(latin1("startxref\n999999\n%%EOF\n"));
  return concatBytes(...parts);
}

/**
 * (d): a classic trailer with `/Prev 6 0 R`, and object 6 is the integer
 * offset of the zero-width stream. pdf.js's Dict.get resolves the reference
 * to that integer; the reference's NUMBER (6) is nothing.
 */
export function prevIndirectInteger(size: number): Uint8Array {
  const parts = body();
  const olderAt = sizeOf(parts);
  parts.push(obj(4, `/W [0 0 0] /Size ${size}`, new Uint8Array(0)));
  const sixAt = sizeOf(parts);
  parts.push(latin1(`6 0 obj\n${olderAt}\nendobj\n`));
  const head = concatBytes(...parts);
  const text = new TextDecoder("latin1").decode(head);
  const at = (n: number) => text.indexOf(`\n${n} 0 obj`) + 1;
  const row = (o: number, g: number, f: "n" | "f") =>
    `${String(o).padStart(10, "0")} ${String(g).padStart(5, "0")} ${f} \n`;
  const table =
    `xref\n0 7\n${row(0, 65535, "f")}${row(at(1), 0, "n")}${row(at(2), 0, "n")}` +
    `${row(at(3), 0, "n")}${row(0, 0, "f")}${row(0, 0, "f")}${row(sixAt, 0, "n")}` +
    `trailer\n<< /Size 7 /Root 1 0 R /Prev 6 0 R >>\nstartxref\n${head.length}\n%%EOF\n`;
  return concatBytes(head, latin1(table));
}

/**
 * Rows ONE byte wide over a FlateDecode stream of `rows` zero bytes: every
 * row reads a byte, so pdf.js walks all of them (a zero type byte is a free
 * entry). 20,000,000 rows deflate to under 20 KB and peak pdf.js at 3.3 GB.
 */
export function flateRows(rows: number): Uint8Array {
  return xrefStreamPdf({
    objects: ONE_PAGE,
    w: "[1 0 0]",
    index: `[0 ${rows}]`,
    xrefBody: deflateSync(Buffer.alloc(rows), { level: 9 }),
    xrefDict: "/Filter /FlateDecode",
  });
}

/**
 * The pre-scan's own quadratic: `n` units that each open a dictionary that
 * never closes, so every one is lexed to the end of what may be read.
 */
export function unclosedUnits(kind: "xref" | "trailer", n: number) {
  const unit = kind === "xref" ? "1 0 obj<< /XRef " : "trailer<< /A ";
  return latin1(`%PDF-1.7\n${unit.repeat(n)}`);
}

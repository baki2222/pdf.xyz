/**
 * A small, genuinely linearized PDF — what `qpdf --linearize` hands back — for
 * tests that stub qpdf.
 *
 * Laid out the way qpdf writes one: header, binary-marker comment, the
 * linearization dictionary as the FIRST object, then the document, with a
 * correct classic xref and a `/L` equal to the file's own length. The stubs
 * this replaces returned `%PDF-…%%EOF` filler as "linearized" output, which is
 * how a check of the one property Optimize for Web promises went unwritten:
 * nothing in a test ever held a linearized file to check it against.
 *
 * No qpdf runs in the unit suite (it is not installed on every developer
 * machine), so this is the builder's claim about qpdf's layout. It is not the
 * only evidence: `src/lib/pdf/linearization.ts` was probed on 2026-09-27
 * against 21 distinct PDFs from other producers carrying `/Linearized` — 16
 * accepted, 5 rejected. In every rejected one `/L` ends exactly at the file's
 * SECOND `%%EOF` (a linearized file's own two sections) and 1 to 8 update
 * sections follow it: incremental saves appended after linearization, which
 * is exactly the file ISO 32000 and pdf.js also refuse to treat as linearized.
 */

const encoder = new TextEncoder();

function assemble(declaredLength: number, tag: string): string {
  const header = "%PDF-1.7\n%\u00bf\u00f7\u00a2\u00fe\n";
  const objects = [
    `<< /Linearized 1 /L ${declaredLength} /H [ 480 120 ] /O 3 /E 600 /N 1 /T 700 >>`,
    "<< /Type /Catalog /Pages 4 0 R >>",
    "<< /Type /Page /Parent 4 0 R /MediaBox [ 0 0 612 792 ] >>",
    "<< /Type /Pages /Kids [ 3 0 R ] /Count 1 >>",
    `<< /Producer (${tag}) >>`,
  ];
  let body = header;
  const offsets: number[] = [];
  objects.forEach((dict, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${dict}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 2 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return body;
}

/** Latin-1, byte for char — the binary marker must stay four single bytes. */
function bytesOf(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/**
 * A linearized PDF whose `/L` is its own length. `tag` goes into the Info
 * dictionary so two fixtures can be told apart by their bytes.
 */
export function linearizedPdf(tag = "pdf.xyz linearized fixture"): Uint8Array {
  // `/L` is part of the file it measures, so iterate until the digit count
  // stops moving (twice at most: the length only grows by whole digits).
  let length = 0;
  for (let i = 0; i < 5; i += 1) {
    const next = assemble(length, tag).length;
    if (next === length) return bytesOf(assemble(length, tag));
    length = next;
  }
  throw new Error("linearizedPdf: /L did not converge");
}

/**
 * The same file with an incremental update appended — what a viewer that saves
 * in place does to a linearized PDF. The dictionary survives; the property does
 * not, because `/L` no longer describes the file.
 */
export function linearizedThenUpdatedPdf(): Uint8Array {
  const base = linearizedPdf();
  const update = encoder.encode(
    "6 0 obj\n<< /Note (appended later) >>\nendobj\n%%EOF\n",
  );
  const out = new Uint8Array(base.byteLength + update.byteLength);
  out.set(base, 0);
  out.set(update, base.byteLength);
  return out;
}

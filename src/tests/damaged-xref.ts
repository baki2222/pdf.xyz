/**
 * A PDF that opens in every viewer but that qpdf must REPAIR before it can do
 * anything else with it: the `startxref` offset of a classic xref table is
 * replaced by one past the end of the file. qpdf rebuilds the xref, writes its
 * output, and exits 3 ("warnings, output written").
 *
 * ONE builder, used by both the real-qpdf integration suite
 * (`pdf-security/native.integration.test.ts`) and the production proof
 * (`scripts/worker-prove-tools.ts`). They were copies of each other; a fix to one
 * would have left the other proving something else.
 *
 * Two ways this fixture has been, or would be, wrong for the wrong reason — both
 * thrown here rather than left to a comment:
 *  - An xref STREAM (pdf-lib's default `useObjectStreams: true`) leaves qpdf no
 *    trailer to reconstruct from, so it refuses outright instead of repairing.
 *    The caller must save with `useObjectStreams: false`; a bytes-in without a
 *    classic `xref` table and `trailer` is refused.
 *  - The digits are SPLICED, never overwritten in place. A small document's
 *    offset has three or four digits; writing a longer lie over them eats the
 *    `%%EOF` after it, the engine's preflight then refuses the upload as not a
 *    PDF, and nothing downstream ever reaches qpdf.
 */
export function spliceStartxrefPastEnd(classicXref: Uint8Array): Uint8Array {
  const whole = Buffer.from(classicXref);
  const text = whole.toString("latin1");
  if (!/(?:^|[\r\n])xref\s*[\r\n]/.test(text) || !/\btrailer\b/.test(text)) {
    throw new Error(
      "fixture has no classic xref table; save it with useObjectStreams: false",
    );
  }
  const at = whole.lastIndexOf("startxref");
  const offset = at < 0 ? null : /^startxref\s+(\d+)/.exec(text.slice(at));
  if (!offset) throw new Error("fixture has no startxref offset");
  const digitsAt = at + offset[0].length - offset[1]!.length;
  const damaged = Buffer.concat([
    whole.subarray(0, digitsAt),
    Buffer.from(String(whole.length * 10), "latin1"),
    whole.subarray(digitsAt + offset[1]!.length),
  ]);
  if (!damaged.subarray(-16).toString("latin1").includes("%%EOF")) {
    throw new Error("damaged fixture lost its %%EOF");
  }
  return new Uint8Array(damaged);
}

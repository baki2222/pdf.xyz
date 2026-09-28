// @vitest-environment node
/**
 * `isLinearized` is the one check standing between Optimize for Web and a
 * file that loads no faster than the upload. It runs on the worker (a job
 * whose output fails it is not delivered), in the deployment proof, and in the
 * panel before the word "linearized" is shown — so both of its errors cost a
 * user: a false negative fails every real job, a false positive restores the
 * silence it replaced.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  LINEARIZATION_WINDOW,
  isLinearized,
  linearizationVerdict,
  readLinearizationDict,
} from "./linearization";
import {
  linearizedPdf,
  linearizedThenUpdatedPdf,
} from "@/tests/linearized-pdf-fixture";

const latin1 = (text: string) =>
  Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);

/** Rewrite `/L` to the length of the text it ends up in (it counts itself). */
function withOwnLength(text: string): Uint8Array {
  let out = text;
  for (let i = 0; i < 5; i += 1) {
    const next = out.replace(/\/L \d+/, `/L ${out.length}`);
    if (next === out) return latin1(out);
    out = next;
  }
  throw new Error("/L did not converge");
}

/** The proof's `textPdf`, rebuilt: what every PDF tool without --linearize emits. */
async function plainPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc
    .addPage([595, 842])
    .drawText("pdf.xyz deployment proof", { x: 60, y: 770, size: 20, font });
  return doc.save();
}

/**
 * Acrobat's compact spelling — no space before a name, `\r` line ends — with
 * `/L` solved for its own length. The shape of the 16 third-party linearized
 * files the helper was probed against on 2026-09-27.
 */
function compactLinearized(): Uint8Array {
  const build = (l: number) =>
    `%PDF-1.6\r%\u00e2\u00e3\u00cf\u00d3\r\n12 0 obj\r<</Linearized 1/L ${l}/O 14/E 900/N 1/T 800/H [ 500 120]>>\rendobj\r      \r\n` +
    `1 0 obj\r<</Type/Catalog>>\rendobj\r${"%".repeat(40)}\r\n%%EOF\r\n`;
  let l = 0;
  while (build(l).length !== l) l = build(l).length;
  return latin1(build(l));
}

describe("isLinearized — the file's own claim, held to its own length", () => {
  it("HEALTH: the fixture is a PDF a real parser opens, one page", async () => {
    const doc = await PDFDocument.load(linearizedPdf());
    expect(doc.getPageCount()).toBe(1);
  });

  it("POSITIVE CONTROL: a linearized file passes, with its /L measured", () => {
    const bytes = linearizedPdf();
    expect(readLinearizationDict(bytes)).toEqual({
      declaredLength: bytes.byteLength,
    });
    expect(isLinearized(bytes)).toBe(true);
    expect(linearizationVerdict(bytes)).toEqual({
      ok: true,
      detail: `linearized: /L=${bytes.byteLength} matches the ${bytes.byteLength}B file`,
    });
  });

  it("POSITIVE CONTROL: Acrobat's compact syntax passes too", () => {
    expect(isLinearized(compactLinearized())).toBe(true);
  });

  it("a plain PDF — the proof's input, unlinearized — fails", async () => {
    const plain = await plainPdf();
    expect(isLinearized(plain)).toBe(false);
    expect(linearizationVerdict(plain).ok).toBe(false);
    expect(linearizationVerdict(plain).detail).toMatch(/no linearization/);
  });

  it("an update appended after linearization fails: the marker stays, the property does not", () => {
    const updated = linearizedThenUpdatedPdf();
    const dict = readLinearizationDict(updated);
    // The dictionary is still there and still readable…
    expect(dict).not.toBeNull();
    expect(dict!.declaredLength).toBeLessThan(updated.byteLength);
    // …and still does not make the file linearized.
    expect(isLinearized(updated)).toBe(false);
    expect(linearizationVerdict(updated).detail).toMatch(
      new RegExp(`/L=${dict!.declaredLength}, but the file is`),
    );
  });

  it("a /Linearized dictionary that is not the FIRST object does not count", () => {
    const bytes = linearizedPdf();
    const text = String.fromCharCode(...bytes);
    // Insert an ordinary object ahead of it; keep /L honest for the new length.
    const grown = withOwnLength(
      text.replace(
        "1 0 obj\n",
        "99 0 obj\n<< /Type /Filler >>\nendobj\n1 0 obj\n",
      ),
    );
    // Health check: only the position moved — /L still names the file, and
    // the same rewrite without the insertion still passes.
    const declared = /\/L (\d+)/.exec(String.fromCharCode(...grown))![1];
    expect(Number(declared)).toBe(grown.byteLength);
    expect(isLinearized(withOwnLength(text))).toBe(true);
    expect(readLinearizationDict(grown)).toBeNull();
    expect(isLinearized(grown)).toBe(false);
  });

  it(`a dictionary that does not close inside the first ${LINEARIZATION_WINDOW} bytes does not count`, () => {
    const bytes = linearizedPdf();
    const text = String.fromCharCode(...bytes);
    const pad = " ".repeat(LINEARIZATION_WINDOW);
    const padded = withOwnLength(
      text.replace("/Linearized 1", `/Linearized 1${pad}`),
    );
    // Health check: /L is still the file's length, so ONLY the window fails it.
    const declared = /\/L (\d+)/.exec(String.fromCharCode(...padded))![1];
    expect(Number(declared)).toBe(padded.byteLength);
    expect(isLinearized(padded)).toBe(false);
  });

  it("/Linearized 0 is not a linearization flag", () => {
    const text = String.fromCharCode(...linearizedPdf());
    expect(
      isLinearized(latin1(text.replace("/Linearized 1", "/Linearized 0"))),
    ).toBe(false);
  });

  it("empty and non-PDF bytes fail without throwing", () => {
    expect(isLinearized(new Uint8Array(0))).toBe(false);
    expect(isLinearized(new Uint8Array(4096).fill(0x41))).toBe(false);
  });
});

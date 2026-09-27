// @vitest-environment node
/**
 * The damaged-xref fixture runs everywhere, even where qpdf does not: the
 * real-binary suites that consume it skip without qpdf, so this is the only
 * place its shape is checked on a machine without the worker image. What it
 * cannot check is the point of it — that qpdf answers 3. That is proven only by
 * the integration suite's positive control and the production proof.
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { looksLikePdf } from "@/lib/workers/compression/engine";
import { spliceStartxrefPastEnd } from "./damaged-xref";

async function classic(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([320, 240]);
  return doc.save({ useObjectStreams: false });
}

const startxrefOf = (bytes: Uint8Array): number => {
  const text = Buffer.from(bytes).toString("latin1");
  const m = /startxref\s+(\d+)\s*%%EOF\s*$/.exec(text);
  if (!m) throw new Error("no startxref at the tail");
  return Number(m[1]);
};

describe("spliceStartxrefPastEnd", () => {
  it("points startxref past the end and changes nothing else", async () => {
    const whole = await classic();
    // Positive control: the input's offset is a real one.
    expect(startxrefOf(whole)).toBeLessThan(whole.byteLength);

    const damaged = spliceStartxrefPastEnd(whole);
    expect(startxrefOf(damaged)).toBeGreaterThan(damaged.byteLength);

    // Only the offset digits differ: the prefix up to them is byte-identical.
    const at = Buffer.from(whole).lastIndexOf("startxref");
    expect(Buffer.from(damaged.subarray(0, at))).toEqual(
      Buffer.from(whole.subarray(0, at)),
    );
  });

  it("still passes the engine's preflight, so a consumer reaches qpdf", async () => {
    const damaged = spliceStartxrefPastEnd(await classic());
    expect(looksLikePdf(damaged)).toBe(true);
  });

  it("refuses an xref-stream PDF, which qpdf would reject instead of repair", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([320, 240]);
    const streamed = await doc.save(); // pdf-lib default: xref stream
    expect(() => spliceStartxrefPastEnd(streamed)).toThrow(/classic xref/);
  });
});

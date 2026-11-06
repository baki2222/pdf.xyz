// @vitest-environment node
/**
 * The batch's per-file result, run on the real pdf-lib repack.
 *
 * Until 2026-11-06 (audit #20) a row handed back the repack whatever its size: a small,
 * already-compact PDF came back LARGER (a 329-byte file grew past 500 bytes, metadata
 * rewritten, name suffixed "-optimized"), while `savedBytes` was clamped to 0 and the
 * row said "Already lean — no change". The single-file path already offered the
 * original in that case; the batch now does the same.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { compressBatchFile } from "./compress-batch";

/** A minimal hand-written, classic-xref, one-page PDF with no metadata. */
function compactPdf(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

/** A PDF with slack a repack removes: unused objects and no object streams. */
async function loosePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 20; i += 1) {
    doc.addPage([300, 200]).drawText(`Page ${i + 1}`, { x: 20, y: 100, font });
  }
  return doc.save({ useObjectStreams: false });
}

const pdfFile = (bytes: Uint8Array, name: string) =>
  new File([bytes.slice()], name, { type: "application/pdf" });

describe("compressBatchFile never ships a file larger than the input", () => {
  it("health check: the compact fixture really grows when repacked", async () => {
    // Without this, the test below could pass because the fixture shrank.
    const input = compactPdf();
    const { optimizeLossless } = await import("@/lib/pdf/analyze");
    const repacked = await optimizeLossless(input);
    expect(repacked.bytes.byteLength).toBeGreaterThan(input.byteLength);
  });

  it("returns the original bytes, under the original name, when the repack is not smaller", async () => {
    const input = compactPdf();
    const result = await compressBatchFile(pdfFile(input, "tiny.pdf"));
    expect(result.bytes.byteLength).toBeLessThanOrEqual(input.byteLength);
    expect(Array.from(result.bytes)).toEqual(Array.from(input));
    expect(result.outputName).toBe("tiny.pdf");
    expect(result.savedBytes).toBe(0);
    expect(result.optimizedBytes).toBe(input.byteLength);
  });

  it("POSITIVE CONTROL: a file the repack shrinks still gets the smaller bytes", async () => {
    const input = await loosePdf();
    const result = await compressBatchFile(pdfFile(input, "loose.pdf"));
    expect(result.bytes.byteLength).toBeLessThan(input.byteLength);
    expect(result.savedBytes).toBe(input.byteLength - result.bytes.byteLength);
    expect(result.outputName).not.toBe("loose.pdf");
  });
});

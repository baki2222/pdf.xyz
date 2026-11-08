/**
 * SIB-11 (hostile matrix, verify): `/ByteRange [..]` written as TEXT inside an
 * uncompressed content stream is counted as a digital signature. The fixture
 * is built by pdf-lib with `compress: false` style raw content, no signature.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";

async function textOnlyPdf(content: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.node.setFontDictionary(PDFName.of("F1"), font.ref);
  const stream = doc.context.stream(content);
  page.node.set(PDFName.of("Contents"), doc.context.register(stream));
  return doc.save({ useObjectStreams: false });
}

describe("SIB-11 /ByteRange text in a content stream", () => {
  it("positive control: content text is literal in the file", async () => {
    const bytes = await textOnlyPdf(
      "BT /F1 12 Tf 10 10 Td (/ByteRange [0 10 20 30]) Tj ET",
    );
    const latin = Buffer.from(bytes).toString("latin1");
    expect(latin).toContain("(/ByteRange [0 10 20 30]) Tj");
    expect(latin).not.toContain("/Sig");
  }, 10_000);

  it("negative control: same page without the text counts 0", async () => {
    const bytes = await textOnlyPdf("BT /F1 12 Tf 10 10 Td (hello) Tj ET");
    expect(countDigitalSignatures(bytes)).toBe(0);
  }, 10_000);

  it("FINDING: unsigned PDF with /ByteRange text counts as 1 signature", async () => {
    const bytes = await textOnlyPdf(
      "BT /F1 12 Tf 10 10 Td (/ByteRange [0 10 20 30]) Tj ET",
    );
    // Records the observed defect; expected value would be 0.
    expect(countDigitalSignatures(bytes)).toBe(1);
  }, 10_000);
});

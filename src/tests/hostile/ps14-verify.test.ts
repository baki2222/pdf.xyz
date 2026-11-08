import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { openForBatch } from "@/components/tools/runner/batch/open-for-batch";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import { ONE_PAGE, latin1, rawPdf } from "./page-structure.raw";

// PS-14 verify: an unsigned file whose content stream shows the text
// "/ByteRange [0 10 20 30]" is counted as carrying one digital signature.

const page = (contents: { dict: string; stream: Uint8Array }) =>
  rawPdf({
    objects: [
      ONE_PAGE[0]!,
      ONE_PAGE[1]!,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
      contents,
    ],
  });

const SHOWN = "BT /F1 10 Tf 10 100 Td (/ByteRange [0 10 20 30]) Tj ET";

describe("PS-14 verify", () => {
  it("uncompressed content stream literal string is counted", { timeout: 10000 }, async () => {
    const bytes = page({ dict: "", stream: latin1(SHOWN) });
    expect(new TextDecoder("latin1").decode(bytes)).toContain("(/ByteRange [0 10 20 30])");
    const opened = await openForBatch(new File([bytes], "x.pdf"));
    console.log("UNCOMPRESSED signatures =", opened.signatures);
    expect(opened.signatures).toBe(1);
  });

  it("control: same text Flate-compressed is not counted", { timeout: 10000 }, async () => {
    const bytes = page({ dict: "/Filter /FlateDecode", stream: new Uint8Array(deflateSync(latin1(SHOWN))) });
    expect(countDigitalSignatures(bytes)).toBe(0);
  });

  it("control: pdf-lib drawText of the same text is not counted", { timeout: 10000 }, async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([200, 200]).drawText("/ByteRange [0 10 20 30]", { x: 10, y: 100, size: 10, font });
    const compressed = await doc.save();
    const plain = await doc.save({ useObjectStreams: false });
    console.log("PDFLIB", countDigitalSignatures(compressed), countDigitalSignatures(plain));
    expect(countDigitalSignatures(compressed)).toBe(0);
  });

  it("an /Info literal string also counts (same root cause)", { timeout: 10000 }, () => {
    const bytes = rawPdf({
      objects: [...ONE_PAGE, "<< /Subject (/ByteRange [0 10 20 30]) >>"],
    });
    expect(countDigitalSignatures(bytes)).toBe(1);
  });
});

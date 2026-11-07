import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  MAX_CARRIED_FIELD_CHARS,
  carriedValue,
  docInfoPdfmark,
  readCarriedDocInfo,
} from "./docinfo";
import { pdfaDefinition } from "./native";

async function pdf(set: (doc: PDFDocument) => void): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage();
  set(doc);
  return doc.save();
}

describe("carrying document properties into the PDF/A prefix (audit pdf-to-pdfa#3)", () => {
  it("reads the four fields back from a real PDF, UTF-16 strings included", async () => {
    expect(
      await readCarriedDocInfo(
        await pdf((doc) => {
          doc.setTitle("Thesis — draft"); // an em dash: not carried
          doc.setAuthor("Zoë");
          doc.setSubject("Line one\nline two");
          doc.setKeywords(["a", "b"]);
        }),
      ),
    ).toEqual({ Author: "Zoë", Subject: "Line one line two", Keywords: "a b" });
  });

  it("an encrypted input carries nothing: pdf-lib would read ciphertext", async () => {
    const bytes = await pdf((doc) => {
      doc.setTitle("Secret");
      doc.context.trailerInfo.Encrypt = doc.context.obj({});
    });
    // Health check: the fixture really is encrypted, and really has a title.
    const reread = await PDFDocument.load(bytes, { ignoreEncryption: true });
    expect(reread.isEncrypted).toBe(true);
    expect(await readCarriedDocInfo(bytes)).toEqual({});
  });

  it("an unreadable input carries nothing and does not throw", async () => {
    expect(await readCarriedDocInfo(new Uint8Array([1, 2, 3]))).toEqual({});
  });

  it("keeps only text whose bytes PDFDocEncoding and Latin-1 agree on", () => {
    expect(carriedValue("Report ©2025 ½")).toBe("Report ©2025 ½");
    for (const raw of ["“quoted”", "a–b", "€", "soft­hyphen", "日本"])
      expect(carriedValue(raw), raw).toBeUndefined();
    expect(carriedValue("x".repeat(MAX_CARRIED_FIELD_CHARS))).toBeDefined();
    expect(
      carriedValue("x".repeat(MAX_CARRIED_FIELD_CHARS + 1)),
    ).toBeUndefined();
    expect(carriedValue("   ")).toBeUndefined();
  });

  it("writes PostScript strings that cannot break out of the pdfmark", () => {
    const line = docInfoPdfmark({ Title: "a) /Author (x" });
    expect(line).toBe(String.raw`[/Title (a\) /Author \(x) /DOCINFO pdfmark`);
    expect(docInfoPdfmark({ Title: "back\\slash" })).toBe(
      String.raw`[/Title (back\\slash) /DOCINFO pdfmark`,
    );
    expect(docInfoPdfmark({})).toBeNull();
  });

  it("CONTROL: with nothing to carry the prefix is byte-for-byte the old one", () => {
    expect(pdfaDefinition("/icc")).toBe(pdfaDefinition("/icc", {}));
    expect(pdfaDefinition("/icc")).not.toContain("DOCINFO");
  });
});

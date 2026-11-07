import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  MAX_CARRIED_FIELD_CHARS,
  carriedValue,
  docInfoPdfmark,
  readCarriedDocInfo,
} from "./docinfo";
import { pdfaDefinition } from "./native";
import { CARRIED_DOCINFO_RULE } from "./docinfo-words";

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
          doc.setAuthor("Zoë"); // an accented letter: not carried (measured)
          doc.setSubject("Line one\nline two");
          doc.setKeywords(["a", "b"]);
        }),
      ),
    ).toEqual({ Subject: "Line one line two", Keywords: "a b" });
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

  /*
   * INVERTED 2026-11-08. This test used to pin that Latin-1 ("Report ©2025
   * ½", "Zoë") WAS carried, on the theory that gs 10.00.0 refused only the
   * input's UTF-16 pairs. A production-image run refuted it: each verdict
   * below is what Ghostscript 10.00.0 did with that value in a /DOCINFO
   * pdfmark in the PDF/A prefix (2026-11-07, worker image c425923d08e6,
   * `docker run --network none`, -dPDFA=2): `true` = arrived in the
   * output's Info dictionary and XMP, `false` = absent from both. The
   * predicate must agree with every measured verdict, in both directions.
   */
  const MEASURED_GS_10_00_0: ReadonlyArray<readonly [string, boolean]> = [
    ["Annual report", true],
    ["Annual report 2025", true],
    ["Zoe Muller", true],
    ["Quarterly figures", true],
    ["finance", true],
    ["Smith's report & co: 50% - ok?", true],
    ["Annual report (2025)", false],
    ["a\\b", false],
    ["Zoë Müller", false],
    ["Smith’s report", false],
  ];

  it("carries exactly what Ghostscript was measured keeping", () => {
    // Health check: the fixture holds both verdicts.
    expect(
      MEASURED_GS_10_00_0.filter(([, kept]) => kept).length,
    ).toBeGreaterThan(0);
    expect(
      MEASURED_GS_10_00_0.filter(([, kept]) => !kept).length,
    ).toBeGreaterThan(0);
    for (const [value, kept] of MEASURED_GS_10_00_0)
      expect(carriedValue(value) !== undefined, value).toBe(kept);
  });

  it("refuses every other unmeasured shape the rule names, and bounds the length", () => {
    for (const raw of [
      "“quoted”",
      "a–b",
      "€",
      "©2025",
      "soft­hyphen",
      "日本",
      "a)b",
    ])
      expect(carriedValue(raw), raw).toBeUndefined();
    expect(carriedValue("x".repeat(MAX_CARRIED_FIELD_CHARS))).toBeDefined();
    expect(
      carriedValue("x".repeat(MAX_CARRIED_FIELD_CHARS + 1)),
    ).toBeUndefined();
    expect(carriedValue("   ")).toBeUndefined();
  });

  it("the sentence every surface uses states the rule the predicate applies", () => {
    expect(CARRIED_DOCINFO_RULE).toMatch(/plain ASCII/);
    expect(CARRIED_DOCINFO_RULE).toMatch(/round brackets/);
    expect(CARRIED_DOCINFO_RULE).toMatch(/backslash/);
    expect(CARRIED_DOCINFO_RULE).toMatch(/not encrypted/);
    expect(CARRIED_DOCINFO_RULE).toContain(
      MAX_CARRIED_FIELD_CHARS.toLocaleString("en-US"),
    );
    // Each kind the sentence says is left out, the predicate leaves out.
    for (const [kind, sample] of [
      ["accented letter", "é"],
      ["curly quote", "’"],
      ["en dash", "–"],
      ["another script", "日"],
    ] as const) {
      expect(CARRIED_DOCINFO_RULE).toContain(kind);
      expect(carriedValue(`a${sample}b`), kind).toBeUndefined();
    }
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

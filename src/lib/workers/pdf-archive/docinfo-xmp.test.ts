/**
 * Audit wave 2, pdf-to-pdfa#3: Title, Author, Subject and Keywords that
 * Ghostscript 10.00.0 drops in PDF/A mode — a round bracket, a backslash, any
 * character above 0x7E — are written into the PDF/A copy AFTER Ghostscript,
 * into BOTH its Info dictionary and its XMP packet, so the two agree.
 *
 * Read back as a reader would: Info with pdf-lib, the XMP packet as XML text
 * (each property's element text, XML-unescaped), and the file's structure
 * that PDF/A-1 requires of a rewrite (no Filter on the metadata stream, a
 * classic xref and no object streams, the trailer ID kept, the packet still
 * wrapped in its xpacket processing instructions).
 */
import { PDFDocument, type PDFArray } from "pdf-lib";
import { gsLikePdfA, readXmp } from "@/tests/pdfa-xmp-fixtures";
import { describe, expect, it } from "vitest";
import { rewriteDocInfo } from "./docinfo-xmp";
import { readWidenedDocInfo, widenedValue } from "./docinfo";

const WIDE = {
  Title: "Annual report (2025)",
  Author: "José Müller",
  Subject: "Back\\slash & <angle> “quotes” — 年度",
  Keywords: "café, naïve, 😀",
} as const;

describe("rewriteDocInfo: the fields Ghostscript drops, in Info and XMP", () => {
  it("Info and XMP both hold the exact Unicode strings", async () => {
    const out = await rewriteDocInfo(await gsLikePdfA(), WIDE);
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    expect(doc.getTitle()).toBe(WIDE.Title);
    expect(doc.getAuthor()).toBe(WIDE.Author);
    expect(doc.getSubject()).toBe(WIDE.Subject);
    expect(doc.getKeywords()).toBe(WIDE.Keywords);
    const xmp = await readXmp(out);
    expect(xmp.title).toEqual([WIDE.Title]);
    expect(xmp.creator).toEqual([WIDE.Author]);
    expect(xmp.description).toEqual([WIDE.Subject]);
    expect(xmp.keywords).toEqual([WIDE.Keywords]);
  });

  it("keeps what PDF/A needs of a rewrite", async () => {
    const out = await rewriteDocInfo(await gsLikePdfA(), WIDE);
    const text = Buffer.from(out).toString("latin1");
    const xmp = await readXmp(out);
    expect(xmp.filtered).toBe(false);
    expect(xmp.xml).toMatch(/^<\?xpacket begin=/);
    expect(xmp.xml).toMatch(/<\?xpacket end="w"\?>\s*$/);
    expect(xmp.xml).toContain('pdfaid:part="2"');
    expect(xmp.xml).toContain('pdf:Producer="GPL Ghostscript 10.00.0"');
    expect(text).not.toMatch(/\/Type\s*\/ObjStm/);
    expect(text).toMatch(/\nxref\r?\n/);
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    // The producer is still Ghostscript's: nothing else was touched.
    expect(doc.getProducer()).toBe("GPL Ghostscript 10.00.0");
    const id = doc.context.trailerInfo.ID as PDFArray;
    expect(id.size()).toBe(2);
  });

  it("replaces an existing title, and a Keywords attribute, rather than adding a second", async () => {
    const out = await rewriteDocInfo(
      await gsLikePdfA({ keywordsAttr: "old" }),
      WIDE,
    );
    const xmp = await readXmp(out);
    expect(xmp.xml.match(/<dc:title>/g)).toHaveLength(1);
    expect(xmp.xml).not.toContain("Untitled");
    expect(xmp.xml).not.toContain('pdf:Keywords="old"');
    expect(xmp.keywords).toEqual([WIDE.Keywords]);
  });

  it("CONTROL: the stand-in does not already hold the fields", async () => {
    const xmp = await readXmp(await gsLikePdfA());
    expect(xmp.title).toEqual(["Untitled"]);
    expect(xmp.creator).toEqual([]);
  });
});

describe("widenedValue: what is now carried", () => {
  it("keeps brackets, backslashes and any script; drops control-only and over-long text", () => {
    expect(widenedValue("Annual report (2025)")).toBe("Annual report (2025)");
    expect(widenedValue("José\tMüller\n")).toBe("José Müller");
    expect(widenedValue("年度報告")).toBe("年度報告");
    expect(widenedValue("   ")).toBeUndefined();
    expect(widenedValue("x".repeat(2001))).toBeUndefined();
    expect(widenedValue(`a${String.fromCharCode(7)}b`)).toBeUndefined();
  });

  // Review of pdf-to-pdfa#3 (2026-11-28): only C0 and C1 controls were
  // refused, so a noncharacter (U+FFFE, U+FFFF, U+FDD0), which XML 1.0 does
  // not allow, was written raw into the XMP, and an unpaired surrogate
  // became U+FFFD in the XMP while the UTF-16 Info kept it — the two
  // disagreed. Built from char codes (a raw U+FFFE does not survive the
  // tool layer, see MEMORY "invisible characters").
  it("refuses noncharacters and unpaired surrogates; keeps a paired one", () => {
    const c = String.fromCharCode;
    for (const bad of [
      `Report${c(0xfffe)}x`,
      `Report${c(0xffff)}x`,
      `Report${c(0xfdd0)}x`,
      `Bad${c(0xd800)}`,
      `Bad${c(0xdc00)}x`,
      `Bad${c(0xdc00)}${c(0xd800)}`,
    ])
      expect(widenedValue(bad), JSON.stringify(bad)).toBeUndefined();
    // POSITIVE CONTROL: a smiley is a surrogate PAIR, one character.
    const smile = `Team ${c(0xd83d, 0xde00)}`;
    expect(widenedValue(smile)).toBe(smile);
  });

  it("reads the four fields from an input", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.setTitle(WIDE.Title);
    doc.setAuthor(WIDE.Author);
    expect(await readWidenedDocInfo(await doc.save())).toEqual({
      Title: WIDE.Title,
      Author: WIDE.Author,
    });
  });
});

// @vitest-environment node
// @native-canvas
/**
 * "Remove text under boxes" and ATTACHED FILES (audit redact-pdf#1).
 *
 * The off-page check (`offPageHit`) read every string in the output and the
 * decoded XMP packet, but of an attached file only its name (/F, /UF,
 * /Desc): the stream holding the attachment's bytes was skipped. So a PDF
 * whose page text and an attached notes.txt both held "Jane Q. Example" was
 * saved with the name inside the attachment, while the result said the
 * match was "not in it".
 *
 * Now every embedded file in the OUTPUT is decoded and searched; one that
 * still holds a chosen match, or that cannot be read as text (so cannot be
 * checked), stops the save and is named. Every assertion reads the output
 * bytes: each embedded-file stream is inflated, and counted as a health
 * check, so "no stream holds the name" cannot pass over zero streams.
 */
import { describe, expect, it } from "vitest";
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import { findTextMatches, readRedactText } from "./redact-find";
import { redactPdfByRemoval } from "./redact-remove";
import { extractPdfText, type PdfTextReader } from "./text";

const legacy: PdfTextReader = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Awaited<
    ReturnType<PdfTextReader>
  >;

const NAME = "Jane Q. Example";

async function withAttachment(
  attachments: readonly { name: string; bytes: Uint8Array }[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText(`Patient: ${NAME}`, { x: 56, y: 780, size: 12, font });
  page.drawText("Keep this sentence exactly.", {
    x: 56,
    y: 756,
    size: 12,
    font,
  });
  for (const a of attachments)
    await doc.attach(a.bytes, a.name, { mimeType: "text/plain" });
  return doc.save();
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Every embedded-file stream in `bytes`, by its file name, inflated. */
async function embeddedFiles(bytes: Uint8Array): Promise<Map<string, string>> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const out = new Map<string, string>();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const ef = obj.lookup(PDFName.of("EF"));
    if (!(ef instanceof PDFDict)) continue;
    const stream = ef.lookup(PDFName.of("F"));
    if (!(stream instanceof PDFRawStream)) continue;
    const name = obj.lookup(PDFName.of("UF")) ?? obj.lookup(PDFName.of("F"));
    out.set(
      String((name as unknown as { decodeText(): string }).decodeText()),
      new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode()),
    );
  }
  return out;
}

async function removeName(bytes: Uint8Array) {
  const index = await readRedactText(bytes, legacy);
  const { matches } = findTextMatches(index, NAME, {
    matchCase: true,
    wholeWord: false,
  });
  expect(matches.length).toBe(1);
  return redactPdfByRemoval(
    bytes,
    {
      rects: matches.flatMap((f) =>
        f.rects.map((r) => ({ ...r, fromText: true })),
      ),
      verify: matches,
      loadReader: legacy,
    },
    { decodeJpeg: null },
  );
}

describe("redactPdfByRemoval: the chosen text inside an attached file", () => {
  it("health: the fixture's attachment is a real, compressed embedded file holding the name", async () => {
    const source = await withAttachment([
      { name: "notes.txt", bytes: utf8(`Call ${NAME} on Monday.\n`) },
    ]);
    const files = await embeddedFiles(source);
    expect([...files.keys()]).toEqual(["notes.txt"]);
    expect(files.get("notes.txt")).toContain(NAME);
    // Stored compressed, so a raw byte search of the file cannot see it.
    expect(new TextDecoder("latin1").decode(source)).not.toContain(NAME);
  });

  it("refuses to save, naming the attachment, when an attached text file still holds the name", async () => {
    const source = await withAttachment([
      { name: "notes.txt", bytes: utf8(`Call ${NAME} on Monday.\n`) },
    ]);
    await expect(removeName(source)).rejects.toThrow(
      /“Jane Q\. Example” is still in the attached file “notes\.txt”, so the file was not saved/,
    );
  });

  it("sees the name in a UTF-16 attachment too", async () => {
    const text = `﻿Call ${NAME}.`;
    const bytes = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      bytes[i * 2] = text.charCodeAt(i) & 0xff;
      bytes[i * 2 + 1] = text.charCodeAt(i) >> 8;
    }
    const source = await withAttachment([{ name: "wide.txt", bytes }]);
    await expect(removeName(source)).rejects.toThrow(/“wide\.txt”/);
  });

  it("refuses an attachment it cannot read as text, since it cannot check it", async () => {
    const binary = new Uint8Array(256).map((_, i) => i);
    const source = await withAttachment([{ name: "scan.bin", bytes: binary }]);
    await expect(removeName(source)).rejects.toThrow(
      /attached file “scan\.bin” could not be checked for “Jane Q\. Example”, so the file was not saved/,
    );
  });

  it("control: an attachment without the name is kept, byte for byte, and the save goes ahead", async () => {
    const kept = `Appointment on Monday at 10.\n`;
    const source = await withAttachment([
      { name: "kept.txt", bytes: utf8(kept) },
    ]);
    const result = await removeName(source);
    const files = await embeddedFiles(result.bytes);
    // Health: the output's embedded files were found and inflated.
    expect(files.size).toBe(1);
    expect(files.get("kept.txt")).toBe(kept);
    for (const content of files.values()) expect(content).not.toContain(NAME);
    const { pages } = await extractPdfText(result.bytes, legacy);
    expect(pages[0]!.text).not.toContain(NAME);
    expect(pages[0]!.text).toContain("Keep this sentence exactly.");
    expect(result.verified).toBe(1);
  });
});

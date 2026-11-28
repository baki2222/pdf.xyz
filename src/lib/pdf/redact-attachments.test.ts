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
import {
  PLAIN_TEXT_ATTACHMENT_EXTENSIONS,
  PLAIN_TEXT_ATTACHMENT_TYPES,
  plainTextAttachmentList,
} from "./redact-attachment-formats";
import redactContent from "@/lib/tools/content/redact-pdf";
import { extractPdfText, type PdfTextReader } from "./text";

const legacy: PdfTextReader = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Awaited<
    ReturnType<PdfTextReader>
  >;

const NAME = "Jane Q. Example";

async function withAttachment(
  attachments: readonly {
    name: string;
    bytes: Uint8Array;
    mimeType?: string;
  }[],
  name: string = NAME,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText(`Patient: ${name}`, { x: 56, y: 780, size: 12, font });
  page.drawText("Keep this sentence exactly.", {
    x: 56,
    y: 756,
    size: 12,
    font,
  });
  for (const a of attachments)
    await doc.attach(a.bytes, a.name, {
      mimeType: a.mimeType ?? "text/plain",
    });
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

async function removeName(bytes: Uint8Array, name: string = NAME) {
  const index = await readRedactText(bytes, legacy);
  const { matches } = findTextMatches(index, name, {
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
      /attached file “scan\.bin” could not be checked for “Jane Q\. Example” \(only plain \.txt, \.csv and \.tsv files can be\), so the file was not saved/,
    );
  });

  it("refuses a .txt whose bytes are not text, since it cannot check it", async () => {
    const binary = new Uint8Array(256).map((_, i) => i);
    const source = await withAttachment([{ name: "scan.txt", bytes: binary }]);
    await expect(removeName(source)).rejects.toThrow(
      /attached file “scan\.txt” could not be checked/,
    );
  });

  /*
   * Review 2026-11-28 (finding 1, reproduced on the served page): the check
   * ran the plain search over an attachment's raw bytes, so a format that
   * can write the name ANOTHER way — an HTML entity, a JSON \u escape, a
   * base64 e-mail body, an XML &amp;, an RTF \'e9 — was saved with the name
   * still inside, under a note saying every attached file had been checked.
   * Only formats whose raw text IS their content (.txt, .csv, .tsv, typed as
   * such) can be checked; every other attachment is refused as uncheckable,
   * like a binary one. Each case below holds the name ONLY in its encoded
   * spelling, so a plain search cannot see it.
   */
  const b64 = (s: string) => btoa(s);
  const ENCODED: readonly {
    name: string;
    mimeType: string;
    text: string;
  }[] = [
    {
      name: "letter.html",
      mimeType: "text/html",
      text: "<p>Dear Jane&nbsp;Q.&nbsp;Example,</p>",
    },
    {
      name: "data.json",
      mimeType: "application/json",
      text: '{"patient":"Jane\\u0020Q.\\u0020Example"}',
    },
    {
      name: "message.eml",
      mimeType: "message/rfc822",
      text: `Content-Transfer-Encoding: base64\r\n\r\n${b64(`Dear ${NAME},`)}\r\n`,
    },
    {
      name: "invoice.xml",
      mimeType: "text/xml",
      text: "<buyer>Jane&#32;Q.&#32;Example</buyer>",
    },
    {
      name: "letter.rtf",
      mimeType: "application/rtf",
      text: "{\\rtf1 Jane\\~Q.\\~Example}",
    },
  ];

  it("health: no encoded case holds the name in a spelling the plain search sees", () => {
    expect(ENCODED.length).toBe(5);
    for (const c of ENCODED) expect(c.text).not.toContain(NAME);
  });

  it.each(ENCODED)(
    "refuses $name, a format that can spell the name another way",
    async ({ name, mimeType, text }) => {
      const source = await withAttachment([
        { name, mimeType, bytes: utf8(text) },
      ]);
      await expect(removeName(source)).rejects.toThrow(
        new RegExp(
          `attached file “${name.replace(".", "\\.")}” could not be checked for “Jane Q\\. Example”`,
        ),
      );
    },
  );

  it.each(
    PLAIN_TEXT_ATTACHMENT_EXTENSIONS.map((ext, i) => ({
      ext,
      mimeType: PLAIN_TEXT_ATTACHMENT_TYPES[i]!,
    })),
  )(
    "checks every listed format ($ext) and finds the name in it",
    async ({ ext, mimeType }) => {
      const source = await withAttachment([
        { name: `notes.${ext}`, mimeType, bytes: utf8(`id\t${NAME}\n`) },
      ]);
      await expect(removeName(source)).rejects.toThrow(
        new RegExp(`is still in the attached file “notes\\.${ext}”`),
      );
    },
  );

  it("the page copy names exactly the formats the check takes", () => {
    expect(PLAIN_TEXT_ATTACHMENT_EXTENSIONS.length).toBe(3);
    const answers = redactContent.faqs.map((f) => f.a).join("\n");
    expect(answers).toContain(
      `anything but a plain ${plainTextAttachmentList("or")} file`,
    );
    expect(plainTextAttachmentList("or")).toBe(".txt, .csv or .tsv");
  });

  it("refuses a .txt whose recorded type is not plain text", async () => {
    const source = await withAttachment([
      {
        name: "notes.txt",
        mimeType: "text/html",
        bytes: utf8("<b>Jane&nbsp;Q.&nbsp;Example</b>"),
      },
    ]);
    await expect(removeName(source)).rejects.toThrow(
      /attached file “notes\.txt” could not be checked/,
    );
  });

  it("control: a typed .csv without the name is kept and the save goes ahead", async () => {
    const kept = "date,room\n2026-11-28,4\n";
    const source = await withAttachment([
      { name: "visits.csv", mimeType: "text/csv", bytes: utf8(kept) },
    ]);
    const result = await removeName(source);
    const files = await embeddedFiles(result.bytes);
    expect(files.size).toBe(1);
    expect(files.get("visits.csv")).toBe(kept);
  });

  it("sees a name written in Latin-1 (windows-1252), not only UTF-8", async () => {
    const latin = "José Núñez";
    const text = `Call ${latin}.\n`;
    // One byte per character: é and ñ are single bytes, which UTF-8 rejects.
    const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).not.toContain(latin);
    const source = await withAttachment([{ name: "latin.txt", bytes }], latin);
    await expect(removeName(source, latin)).rejects.toThrow(
      /“José Núñez” is still in the attached file “latin\.txt”/,
    );
  });

  it("checks an embedded-file stream that no /EF entry names", async () => {
    const source = await withAttachment([]);
    const doc = await PDFDocument.load(source, { updateMetadata: false });
    const stream = doc.context.flateStream(utf8(`Call ${NAME}.\n`), {
      Type: "EmbeddedFile",
    });
    doc.catalog.set(PDFName.of("XYZData"), doc.context.register(stream));
    const orphaned = await doc.save();
    // Health: the stream is in the source and no /EF names it.
    expect(await embeddedFiles(orphaned)).toEqual(new Map());
    await expect(removeName(orphaned)).rejects.toThrow(
      /attached file “unnamed”/,
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

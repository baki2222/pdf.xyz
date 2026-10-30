// @native-canvas
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PDFDocument, PDFName, PDFStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  METADATA_DATE_FIELDS,
  METADATA_TEXT_FIELDS,
  buildXmpPacket,
  fromLocalInputValue,
  metadataOutputName,
  readPdfMetadata,
  toLocalInputValue,
  writePdfMetadata,
  type PdfMetadata,
} from "./metadata";

/**
 * Edit PDF Metadata, read back TWICE: by pdf-lib (the library that wrote it)
 * and by pdf.js (an independent reader — Firefox's viewer and this site's
 * previews), whose `getMetadata()` reports the Info dictionary and the XMP
 * packet separately. A value only pdf-lib can see is not a value a reader gets.
 */

const require = createRequire(import.meta.url);
type Pdfjs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<Pdfjs> | null = null;
function pdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= import(
    /* @vite-ignore */ pathToFileURL(
      require.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
    ).href
  ) as Promise<Pdfjs>;
  return pdfjsPromise;
}

interface PdfjsMeta {
  info: Record<string, unknown>;
  xmp: { get(name: string): unknown } | null;
}

async function pdfjsMetadata(bytes: Uint8Array): Promise<PdfjsMeta> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const { info, metadata } = await doc.getMetadata();
  await task.destroy();
  return {
    info: info as Record<string, unknown>,
    xmp: metadata as PdfjsMeta["xmp"],
  };
}

const OLD_XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Old XMP title</rdf:li></rdf:Alt></dc:title>
</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

/** "Old title" as UTF-16BE hex — how pdf-lib's setTitle stores it. */
const OLD_TITLE_HEX = Array.from("Old title", (ch) =>
  ch.charCodeAt(0).toString(16).padStart(4, "0"),
)
  .join("")
  .toUpperCase();

async function sourcePdf({ xmp = false } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  doc.addPage([300, 300]);
  doc.setTitle("Old title");
  doc.setAuthor("Old author");
  doc.setSubject("Old subject");
  doc.setKeywords(["old", "words"]);
  doc.setCreator("Old creator");
  doc.setProducer("Old producer");
  doc.setCreationDate(new Date("2001-02-03T04:05:06Z"));
  doc.setModificationDate(new Date("2002-03-04T05:06:07Z"));
  if (xmp) {
    const stream = doc.context.stream(new TextEncoder().encode(OLD_XMP), {
      Type: "Metadata",
      Subtype: "XML",
    });
    doc.catalog.set(PDFName.of("Metadata"), doc.context.register(stream));
  }
  return doc.save({ useObjectStreams: false });
}

const NEW_VALUES: PdfMetadata = {
  title: "Quarterly report — Q3",
  author: "Ada Lovelace",
  subject: "Results and outlook",
  keywords: "finance, q3, বাংলা",
  creator: "Report Builder 2",
  producer: "Press 9",
  creationDate: new Date("2020-01-02T03:04:05Z"),
  modificationDate: new Date("2021-06-07T08:09:10Z"),
};

describe("readPdfMetadata", () => {
  it("reads all eight values without rewriting any of them", async () => {
    const read = await readPdfMetadata(await sourcePdf());
    expect(read).toMatchObject({
      title: "Old title",
      author: "Old author",
      subject: "Old subject",
      keywords: "old words",
      creator: "Old creator",
      producer: "Old producer",
      hasXmp: false,
    });
    expect(read.creationDate?.toISOString()).toBe("2001-02-03T04:05:06.000Z");
    expect(read.modificationDate?.toISOString()).toBe(
      "2002-03-04T05:06:07.000Z",
    );
  });

  it("sees an XMP packet when the catalog has one", async () => {
    expect((await readPdfMetadata(await sourcePdf({ xmp: true }))).hasXmp).toBe(
      true,
    );
  });

  it("names every field the type has, once (health)", () => {
    const ids = [
      ...METADATA_TEXT_FIELDS.map((f) => f.id),
      ...METADATA_DATE_FIELDS.map((f) => f.id),
    ].sort();
    expect(ids).toEqual(Object.keys(NEW_VALUES).sort());
  });
});

describe("writePdfMetadata — edit", () => {
  it("re-opens with the new values, in pdf-lib and in pdf.js", async () => {
    const source = await sourcePdf();
    const result = await writePdfMetadata(source, {
      kind: "edit",
      values: NEW_VALUES,
    });

    const doc = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getTitle()).toBe(NEW_VALUES.title);
    expect(doc.getAuthor()).toBe(NEW_VALUES.author);
    expect(doc.getSubject()).toBe(NEW_VALUES.subject);
    expect(doc.getKeywords()).toBe(NEW_VALUES.keywords);
    expect(doc.getCreator()).toBe(NEW_VALUES.creator);
    expect(doc.getProducer()).toBe(NEW_VALUES.producer);
    expect(doc.getCreationDate()?.toISOString()).toBe(
      NEW_VALUES.creationDate!.toISOString(),
    );
    expect(doc.getModificationDate()?.toISOString()).toBe(
      NEW_VALUES.modificationDate!.toISOString(),
    );

    const { info } = await pdfjsMetadata(result.bytes);
    expect(info.Title).toBe(NEW_VALUES.title);
    expect(info.Author).toBe(NEW_VALUES.author);
    expect(info.Subject).toBe(NEW_VALUES.subject);
    expect(info.Keywords).toBe(NEW_VALUES.keywords);
    expect(info.Creator).toBe(NEW_VALUES.creator);
    expect(info.Producer).toBe(NEW_VALUES.producer);
    expect(String(info.CreationDate)).toMatch(/^D:20200102030405/);
    expect(String(info.ModDate)).toMatch(/^D:20210607080910/);

    // The result reports what the saved file holds.
    expect(result.saved.title).toBe(NEW_VALUES.title);
    expect(result.replacedXmp).toBe(false);
  });

  it("removes a field left blank instead of writing an empty one", async () => {
    const result = await writePdfMetadata(await sourcePdf(), {
      kind: "edit",
      values: { ...NEW_VALUES, author: "  ", creationDate: null },
    });
    const { info } = await pdfjsMetadata(result.bytes);
    expect(info.Author).toBeUndefined();
    expect(info.CreationDate).toBeUndefined();
    expect(info.Title).toBe(NEW_VALUES.title);
  });

  it("does not let pdf-lib overwrite the values on the way in", async () => {
    // A plain PDFDocument.load() stamps Producer/Creator/ModDate itself.
    const result = await writePdfMetadata(await sourcePdf(), {
      kind: "edit",
      values: { ...NEW_VALUES, producer: "", modificationDate: null },
    });
    const { info } = await pdfjsMetadata(result.bytes);
    expect(info.Producer).toBeUndefined();
    expect(info.ModDate).toBeUndefined();
  });

  it("replaces an XMP packet so readers that prefer XMP see the new title", async () => {
    const source = await sourcePdf({ xmp: true });
    // Control: the source's XMP says the OLD title.
    const before = await pdfjsMetadata(source);
    expect(before.xmp?.get("dc:title")).toBe("Old XMP title");

    const result = await writePdfMetadata(source, {
      kind: "edit",
      values: NEW_VALUES,
    });
    expect(result.replacedXmp).toBe(true);
    const { xmp } = await pdfjsMetadata(result.bytes);
    expect(xmp?.get("dc:title")).toBe(NEW_VALUES.title);
    expect(xmp?.get("dc:creator")).toEqual([NEW_VALUES.author]);
    expect(xmp?.get("dc:description")).toBe(NEW_VALUES.subject);
    expect(xmp?.get("pdf:keywords")).toBe(NEW_VALUES.keywords);
    expect(xmp?.get("xmp:creatortool")).toBe(NEW_VALUES.creator);
  });

  it("adds no XMP packet to a file that had none", async () => {
    const result = await writePdfMetadata(await sourcePdf(), {
      kind: "edit",
      values: NEW_VALUES,
    });
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.catalog.get(PDFName.of("Metadata"))).toBeUndefined();
    expect((await pdfjsMetadata(result.bytes)).xmp).toBeNull();
  });
});

describe("writePdfMetadata — remove all", () => {
  it("strips the Info dictionary and the XMP stream, pages kept", async () => {
    const source = await sourcePdf({ xmp: true });
    const result = await writePdfMetadata(source, { kind: "remove-all" });
    expect(result.removedXmp).toBe(true);

    const { info, xmp } = await pdfjsMetadata(result.bytes);
    for (const key of [
      "Title",
      "Author",
      "Subject",
      "Keywords",
      "Creator",
      "Producer",
      "CreationDate",
      "ModDate",
    ]) {
      expect(info[key], key).toBeUndefined();
    }
    expect(xmp).toBeNull();

    const doc = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(2);
    expect(doc.catalog.get(PDFName.of("Metadata"))).toBeUndefined();
    // No stream left anywhere in the file that is an XMP packet.
    const leftovers = doc.context
      .enumerateIndirectObjects()
      .filter(
        ([, obj]) =>
          obj instanceof PDFStream &&
          obj.dict.get(PDFName.of("Type"))?.toString() === "/Metadata",
      );
    expect(leftovers).toEqual([]);
    // Neither old value survives anywhere in the saved bytes: the XMP title
    // as plain text, the Info title as the UTF-16 hex pdf-lib writes.
    const raw = Buffer.from(result.bytes).toString("latin1").toUpperCase();
    expect(raw).not.toContain("OLD XMP TITLE");
    expect(raw).not.toContain(OLD_TITLE_HEX);
  });

  it("control: the source really did carry everything removed", async () => {
    const source = await sourcePdf({ xmp: true });
    const { info, xmp } = await pdfjsMetadata(source);
    expect(info.Title).toBe("Old title");
    expect(xmp).not.toBeNull();
    const raw = Buffer.from(source).toString("latin1").toUpperCase();
    expect(raw).toContain("OLD XMP TITLE");
    expect(raw).toContain(OLD_TITLE_HEX);
  });
});

describe("helpers", () => {
  it("names the copy after the source", () => {
    expect(metadataOutputName("report.pdf")).toBe("report-metadata.pdf");
  });

  it("round-trips a datetime-local value", () => {
    const date = new Date(2024, 4, 6, 7, 8);
    expect(fromLocalInputValue(toLocalInputValue(date))?.getTime()).toBe(
      date.getTime(),
    );
    expect(fromLocalInputValue("")).toBeNull();
    expect(toLocalInputValue(null)).toBe("");
  });

  it("escapes XML in the packet", () => {
    const xml = buildXmpPacket({ ...NEW_VALUES, title: "A <b> & C" });
    expect(xml).toContain("A &lt;b&gt; &amp; C");
  });
});

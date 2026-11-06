// @native-canvas
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFStream,
  PDFString,
  decodePDFRawStream,
} from "pdf-lib";
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

/**
 * Audit #29 (2026-11-06): an edit replaced the XMP packet wholesale, so a
 * PDF/A file (our own PDF to PDF/A output among them) lost its pdfaid
 * identification on a title change; and both dates went through the editor's
 * minute-precision field and back, so an untouched CreationDate lost its
 * seconds and its offset became Z.
 */
describe("writePdfMetadata — edit keeps what was not edited", () => {
  // Ghostscript writes the attribute spelling; others write elements.
  const PDFA_XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Archived</rdf:li></rdf:Alt></dc:title>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:id="http://www.aiim.org/pdfa/ns/id/" id:part='2'>
<id:conformance>B</id:conformance>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/">
<pdfuaid:part>1</pdfuaid:part>
</rdf:Description>
</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

  async function withXmp(xmp: string, creationDate?: string) {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]);
    doc.setTitle("Archived");
    const stream = doc.context.stream(new TextEncoder().encode(xmp), {
      Type: "Metadata",
      Subtype: "XML",
    });
    doc.catalog.set(PDFName.of("Metadata"), doc.context.register(stream));
    const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
    if (creationDate) {
      info.set(PDFName.of("CreationDate"), PDFString.of(creationDate));
      info.set(PDFName.of("ModDate"), PDFString.of(creationDate));
    }
    return doc.save({ useObjectStreams: false });
  }

  /** What the runner sends: every field through its draft and back. */
  async function titleOnlyEdit(source: Uint8Array, title: string) {
    const reading = await readPdfMetadata(source);
    const values: PdfMetadata = {
      ...reading,
      title,
      creationDate: fromLocalInputValue(
        toLocalInputValue(reading.creationDate),
      ),
      modificationDate: fromLocalInputValue(
        toLocalInputValue(reading.modificationDate),
      ),
    };
    return writePdfMetadata(source, { kind: "edit", values });
  }

  it("keeps the PDF/A and PDF/UA identification through a title edit", async () => {
    const source = await withXmp(PDFA_XMP);
    // Control: the source declares it.
    expect(new TextDecoder().decode(source)).toContain("id:part='2'");
    const result = await titleOnlyEdit(source, "New title");
    const { xmp } = await pdfjsMetadata(result.bytes);
    expect(xmp?.get("dc:title")).toBe("New title");
    expect(xmp?.get("pdfaid:part")).toBe("2");
    expect(xmp?.get("pdfaid:conformance")).toBe("B");
    expect(xmp?.get("pdfuaid:part")).toBe("1");
  });

  /**
   * Review of the #29 fix: pdfaid and pdfuaid were carried, the extension
   * schema that DESCRIBES pdfuaid was not. In PDF/A-2 and -3 pdfuaid is not a
   * predefined schema, so a PDF/A + PDF/UA file (LibreOffice writes these) is
   * valid only with that description (veraPDF 6.6.2.3.1). Here the bindings
   * its body uses sit on rdf:RDF, as they may: the copy must bring them.
   */
  const EXTENSION = `<pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">
<pdfaSchema:namespaceURI>http://www.aiim.org/pdfua/ns/id/</pdfaSchema:namespaceURI>
<pdfaSchema:prefix>pdfuaid</pdfaSchema:prefix>
<pdfaSchema:schema>PDF/UA identification schema</pdfaSchema:schema>
<pdfaSchema:property><rdf:Seq><rdf:li rdf:parseType="Resource">
<pdfaProperty:category>internal</pdfaProperty:category>
<pdfaProperty:description>PDF/UA version identifier</pdfaProperty:description>
<pdfaProperty:name>part</pdfaProperty:name>
<pdfaProperty:valueType>Integer</pdfaProperty:valueType>
</rdf:li></rdf:Seq></pdfaSchema:property>
</rdf:li></rdf:Bag></pdfaExtension:schemas>`;
  const PDFA_UA_XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Archived</rdf:li></rdf:Alt></dc:title>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
<pdfaid:part>2</pdfaid:part><pdfaid:conformance>A</pdfaid:conformance>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/">
<pdfuaid:part>1</pdfuaid:part>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/">
${EXTENSION}
</rdf:Description>
</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

  function outputXmp(bytes: Uint8Array): Promise<string> {
    return PDFDocument.load(bytes, { updateMetadata: false }).then((doc) => {
      const xmp = doc.catalog.lookup(PDFName.of("Metadata"));
      if (!(xmp instanceof PDFRawStream))
        throw new Error("no catalog XMP stream");
      return new TextDecoder().decode(decodePDFRawStream(xmp).decode());
    });
  }

  it("keeps the extension schema that describes pdfuaid, with its namespace bindings", async () => {
    const source = await withXmp(PDFA_UA_XMP);
    const result = await titleOnlyEdit(source, "New title");
    const packet = await outputXmp(result.bytes);
    // The identification and the description of it, both.
    expect(packet).toContain("<pdfuaid:part>1</pdfuaid:part>");
    expect(packet).toContain(EXTENSION);
    // Every prefix the copied element uses is bound in the new packet.
    const used = new Set(
      [...EXTENSION.matchAll(/<\/?([A-Za-z_][\w.-]*):/g)].map((m) => m[1]!),
    );
    expect([...used].sort()).toEqual([
      "pdfaExtension",
      "pdfaProperty",
      "pdfaSchema",
      "rdf",
    ]);
    for (const prefix of used) {
      expect(packet, prefix).toMatch(new RegExp(`xmlns:${prefix}="`));
    }
    const { xmp } = await pdfjsMetadata(result.bytes);
    expect(xmp?.get("dc:title")).toBe("New title");
    expect(xmp?.get("pdfuaid:part")).toBe("1");
  });

  it("carries no extension schema from a packet that declares no identification", async () => {
    const NO_ID = PDFA_UA_XMP.replace(
      /<rdf:Description rdf:about="" xmlns:pdfu?aid=[\s\S]*?<\/rdf:Description>\n/g,
      "",
    );
    // Control: the identification is gone and the extension is still there.
    expect(NO_ID).not.toContain("pdfuaid:part");
    expect(NO_ID).not.toContain("pdfaid:part");
    expect(NO_ID).toContain(EXTENSION);
    const result = await titleOnlyEdit(await withXmp(NO_ID), "New title");
    expect(await outputXmp(result.bytes)).not.toContain("pdfaExtension");
  });

  it("adds no identification to a packet that had none", async () => {
    const result = await titleOnlyEdit(await withXmp(OLD_XMP), "New title");
    const { xmp } = await pdfjsMetadata(result.bytes);
    expect(xmp?.get("dc:title")).toBe("New title");
    expect(xmp?.get("pdfaid:part")).toBeNull();
    expect(xmp?.get("pdfuaid:part")).toBeNull();
  });

  it("an untouched date keeps its seconds and its offset", async () => {
    const STAMP = "D:20200101123456+05'00'";
    const source = await withXmp(OLD_XMP, STAMP);
    const result = await titleOnlyEdit(source, "New title");
    const out = await PDFDocument.load(result.bytes, { updateMetadata: false });
    const info = out.context.lookup(out.context.trailerInfo.Info, PDFDict);
    for (const key of ["CreationDate", "ModDate"]) {
      const value = info.lookup(PDFName.of(key));
      expect(
        value instanceof PDFString || value instanceof PDFHexString
          ? value.decodeText()
          : value,
        key,
      ).toBe(STAMP);
    }
    expect(result.saved.creationDate?.toISOString()).toBe(
      "2020-01-01T07:34:56.000Z",
    );
  });

  it("a date the person changed is written as typed", async () => {
    const source = await withXmp(OLD_XMP, "D:20200101123456+05'00'");
    const reading = await readPdfMetadata(source);
    const result = await writePdfMetadata(source, {
      kind: "edit",
      values: {
        ...reading,
        creationDate: fromLocalInputValue("2021-03-04T05:06"),
      },
    });
    expect(result.saved.creationDate?.getTime()).toBe(
      fromLocalInputValue("2021-03-04T05:06")!.getTime(),
    );
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

  /**
   * Audit #4 (2026-11-06): remove-all deleted only the object the trailer's
   * /Info named and the catalog XMP, then saved every object pdf-lib had
   * parsed — an earlier Info left orphaned by an incremental save, a page's
   * own XMP and its /PieceInfo all came through the "clean" file.
   */
  it("leaves no old author anywhere: orphaned Info, page XMP, PieceInfo", async () => {
    const doc = await PDFDocument.load(await sourcePdf({ xmp: true }));
    const ctx = doc.context;
    // An earlier Info dictionary nothing refers to any more.
    ctx.register(ctx.obj({ Author: PDFString.of("SecretOldAuthor") }));
    const page = doc.getPage(0).node;
    page.set(
      PDFName.of("Metadata"),
      ctx.register(
        ctx.stream("<x:xmpmeta>PageXmpAuthor</x:xmpmeta>", {
          Type: "Metadata",
          Subtype: "XML",
        }),
      ),
    );
    page.set(
      PDFName.of("PieceInfo"),
      ctx.obj({
        Illustrator: { Private: { Author: PDFString.of("PieceInfoAuthor") } },
      }),
    );
    doc.catalog.set(
      PDFName.of("PieceInfo"),
      ctx.obj({ Word: { Private: PDFString.of("DocPieceInfoAuthor") } }),
    );
    // A string that is reachable and no metadata: it must survive, which
    // proves the walk below reads the output's strings at all.
    doc.catalog.set(PDFName.of("Lang"), PDFString.of("en-GB"));
    const source = await doc.save({ useObjectStreams: false });
    const NAMES = [
      "SecretOldAuthor",
      "PageXmpAuthor",
      "PieceInfoAuthor",
      "DocPieceInfoAuthor",
    ];

    /** Every string and every decoded stream in every object of `bytes`. */
    const everything = async (bytes: Uint8Array): Promise<string> => {
      const d = await PDFDocument.load(bytes, { updateMetadata: false });
      const parts: string[] = [];
      const visit = (o: unknown): void => {
        if (o instanceof PDFString || o instanceof PDFHexString) {
          parts.push(o.decodeText());
        } else if (o instanceof PDFDict) {
          for (const [, v] of o.entries()) visit(v);
        } else if (o instanceof PDFArray) {
          o.asArray().forEach(visit);
        } else if (o instanceof PDFRawStream) {
          visit(o.dict);
          parts.push(
            new TextDecoder("latin1").decode(decodePDFRawStream(o).decode()),
          );
        }
      };
      for (const [, obj] of d.context.enumerateIndirectObjects()) visit(obj);
      return parts.join(" | ");
    };
    // Positive control: the source holds every one of them.
    const before = await everything(source);
    for (const name of NAMES) expect(before, name).toContain(name);

    const result = await writePdfMetadata(source, { kind: "remove-all" });
    const after = await everything(result.bytes);
    for (const name of NAMES) expect(after, name).not.toContain(name);
    // Pages and their content are still there.
    const out = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(out.getPageCount()).toBe(2);
    expect(after).toContain("en-GB");
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

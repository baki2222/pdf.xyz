/**
 * PDF to PDF/A metadata fixtures (audit wave 2, pdf-to-pdfa#3): a stand-in
 * for Ghostscript's PDF/A output, and a reader of a file's XMP packet that
 * returns each document property as a reader would see it.
 */
import { inflateSync } from "node:zlib";
import {
  PDFDocument,
  PDFName,
  PDFString,
  type PDFRawStream,
  type PDFRef,
} from "pdf-lib";

/** A stand-in for Ghostscript's PDF/A output: an XMP packet and an ID. */
export async function gsLikePdfA(opts: { keywordsAttr?: string } = {}) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 200]);
  doc.setProducer("GPL Ghostscript 10.00.0");
  const xmp = `<?xpacket begin="\u{feff}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" pdf:Producer="GPL Ghostscript 10.00.0"${opts.keywordsAttr ? ` pdf:Keywords="${opts.keywordsAttr}"` : ""}/>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" dc:format="application/pdf"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Untitled</rdf:li></rdf:Alt></dc:title></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" pdfaid:part="2" pdfaid:conformance="B"/>
</rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;
  const stream = doc.context.stream(new TextEncoder().encode(xmp), {
    Type: "Metadata",
    Subtype: "XML",
  });
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(stream));
  // The output intent Ghostscript's PDF/A prefix writes, so the processor's
  // PDF/A marker gate (`pdfa-markers.ts`) accepts the stand-in.
  const profile = doc.context.register(
    doc.context.stream(new Uint8Array(128).fill(7), { N: 3 }),
  );
  doc.catalog.set(
    PDFName.of("OutputIntents"),
    doc.context.obj([
      doc.context.register(
        doc.context.obj({
          Type: "OutputIntent",
          S: "GTS_PDFA1",
          OutputConditionIdentifier: PDFString.of("sRGB"),
          DestOutputProfile: profile,
        }),
      ),
    ]),
  );
  const id = doc.context.obj([
    doc.context.obj(new Uint8Array(16).fill(7)),
    doc.context.obj(new Uint8Array(16).fill(9)),
  ]);
  doc.context.trailerInfo.ID = id;
  return doc.save({ useObjectStreams: false });
}

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

/** The XMP packet's text, and each property's value(s). */
export async function readXmp(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ref = doc.catalog.get(PDFName.of("Metadata")) as PDFRef;
  const stream = doc.context.lookup(ref) as PDFRawStream;
  const filter = stream.dict.get(PDFName.of("Filter"));
  const raw = filter ? inflateSync(stream.contents) : stream.contents;
  const xml = new TextDecoder().decode(raw);
  const items = (tag: string) => {
    const el = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1];
    if (el === undefined) {
      const attr = new RegExp(`\\s${tag}="([^"]*)"`).exec(xml)?.[1];
      return attr === undefined ? [] : [unescape(attr)];
    }
    const li = [...el.matchAll(/<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/g)].map((m) =>
      unescape(m[1]!),
    );
    // A simple property (pdf:Keywords) is the element's own text.
    return li.length > 0 || /<rdf:/.test(el) ? li : [unescape(el)];
  };
  return {
    xml,
    filtered: filter !== undefined,
    title: items("dc:title"),
    creator: items("dc:creator"),
    description: items("dc:description"),
    keywords: items("pdf:Keywords"),
  };
}

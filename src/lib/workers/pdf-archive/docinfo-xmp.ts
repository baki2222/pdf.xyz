/**
 * Write a PDF/A copy's Title, Author, Subject and Keywords AFTER Ghostscript,
 * into its Info dictionary AND its XMP packet (audit wave 2, pdf-to-pdfa#3).
 * WORKER-ONLY: pdf-lib is loaded here.
 *
 * Ghostscript 10.00.0 drops, in PDF/A mode, any DOCINFO value holding a round
 * bracket, a backslash or a character above 0x7E, however the prefix spells
 * it (measured 2026-11-07, `./docinfo`). So "Annual report (2025)" and "José
 * Müller" never reached the copy. Both places PDF/A keeps document
 * properties can hold any Unicode text: Info as a UTF-16BE text string, XMP
 * as UTF-8 XML. Written together they agree, which is what PDF/A requires of
 * them.
 *
 * What the rewrite keeps, because PDF/A needs it: the loaded file is saved
 * with a classic cross-reference table and no object streams (PDF/A-1
 * forbids both), the trailer ID and every other object as they were, the
 * Producer and dates untouched (`updateMetadata: false`), and the XMP
 * packet's own wrapper; the new metadata stream carries no Filter (PDF/A-1
 * 6.7.2). Inside the packet, any existing `dc:title`, `dc:creator`,
 * `dc:description` and `pdf:Keywords` (as an element or an attribute) is
 * removed and one `rdf:Description` holding the new values is added.
 */
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";
import {
  CARRIED_DOCINFO_FIELDS,
  type CarriedDocInfo,
  type CarriedDocInfoField,
} from "./docinfo";

const xml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Each field's XMP property, and how its value is shaped. */
const XMP: Record<
  CarriedDocInfoField,
  { tag: string; shape: "alt" | "seq" | "text" }
> = {
  Title: { tag: "dc:title", shape: "alt" },
  Author: { tag: "dc:creator", shape: "seq" },
  Subject: { tag: "dc:description", shape: "alt" },
  Keywords: { tag: "pdf:Keywords", shape: "text" },
};

function property(field: CarriedDocInfoField, value: string): string {
  const { tag, shape } = XMP[field];
  const v = xml(value);
  if (shape === "alt")
    return `<${tag}><rdf:Alt><rdf:li xml:lang="x-default">${v}</rdf:li></rdf:Alt></${tag}>`;
  if (shape === "seq")
    return `<${tag}><rdf:Seq><rdf:li>${v}</rdf:li></rdf:Seq></${tag}>`;
  return `<${tag}>${v}</${tag}>`;
}

/** The packet with the given fields' old values removed and the new added. */
export function rewriteXmpPacket(packet: string, info: CarriedDocInfo): string {
  const fields = CARRIED_DOCINFO_FIELDS.filter((f) => info[f] !== undefined);
  let out = packet;
  for (const field of fields) {
    const tag = XMP[field].tag;
    out = out
      .replace(new RegExp(`<${tag}(?:\\s[^>]*)?/>`, "g"), "")
      .replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "g"), "")
      .replace(new RegExp(`\\s${tag}="[^"]*"`, "g"), "")
      .replace(new RegExp(`\\s${tag}='[^']*'`, "g"), "");
  }
  const description = `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">${fields
    .map((f) => property(f, info[f]!))
    .join("")}</rdf:Description>\n`;
  const at = out.lastIndexOf("</rdf:RDF>");
  if (at < 0) throw new Error("the XMP packet has no rdf:RDF");
  return out.slice(0, at) + description + out.slice(at);
}

/**
 * `pdf` with `info` written into Info and XMP. Throws when the file has no
 * XMP packet to write into (a PDF/A file always has one); the caller then
 * keeps Ghostscript's output as it was.
 */
export async function rewriteDocInfo(
  pdf: Uint8Array,
  info: CarriedDocInfo,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const ref = doc.catalog.get(PDFName.of("Metadata"));
  if (!(ref instanceof PDFRef)) throw new Error("no XMP metadata stream");
  const stream = doc.context.lookup(ref);
  if (!(stream instanceof PDFRawStream))
    throw new Error("the XMP metadata is not a stream");
  const raw = stream.dict.get(PDFName.of("Filter"))
    ? inflateSync(stream.contents)
    : stream.contents;
  const packet = new TextDecoder().decode(raw);
  const next = rewriteXmpPacket(packet, info);
  doc.context.assign(
    ref,
    doc.context.stream(new TextEncoder().encode(next), {
      Type: "Metadata",
      Subtype: "XML",
    }),
  );
  // pdf-lib writes each as a UTF-16BE text string (PDFHexString.fromText).
  if (info.Title !== undefined) doc.setTitle(info.Title);
  if (info.Author !== undefined) doc.setAuthor(info.Author);
  if (info.Subject !== undefined) doc.setSubject(info.Subject);
  if (info.Keywords !== undefined) doc.setKeywords([info.Keywords]);
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

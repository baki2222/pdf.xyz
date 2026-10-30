import type { PDFDict, PDFDocument } from "pdf-lib";
import { pdfLoadError, PdfEngineError } from "./engine";
import { outputName } from "./files";
import { loadPdfLib, type PdfLibModule } from "./pdf-lib";

/**
 * Edit PDF Metadata — read and rewrite a PDF's document information.
 *
 * TWO places hold it. The trailer's Info dictionary (Title, Author, Subject,
 * Keywords, Creator, Producer, CreationDate, ModDate) and, in most files a
 * modern app wrote, an XMP packet: an XML stream on the catalog's /Metadata.
 * Readers disagree about which wins — Acrobat and pdf.js's viewer prefer the
 * XMP title when there is one — so writing the Info dictionary alone leaves a
 * file that still shows its OLD title in exactly the readers people use.
 *
 * So, when the source carries a document XMP packet, a save REPLACES it with a
 * fresh packet holding the same values as the Info dictionary. Properties the
 * old packet held beyond those eight are not carried (the runner says so). A
 * file with no packet gets none. "Remove all metadata" deletes the Info
 * dictionary and the document XMP packet both.
 *
 * Loaded with `updateMetadata: false` — a plain `PDFDocument.load` rewrites
 * Producer, Creator and ModDate on the way in, which on THIS tool would put
 * pdf-lib's values over the ones the person typed. `metadata.test.ts` re-opens
 * every output with pdf-lib AND pdf.js and reads the values back.
 */

/** The eight Info-dictionary entries this tool shows and edits. */
export interface PdfMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  /** `null` when the file states none (or states one that cannot be read). */
  creationDate: Date | null;
  modificationDate: Date | null;
}

export type PdfTextField = Exclude<
  keyof PdfMetadata,
  "creationDate" | "modificationDate"
>;

/** The fields in the order the runner draws them, with their labels. */
export const METADATA_TEXT_FIELDS: readonly {
  id: PdfTextField;
  label: string;
}[] = [
  { id: "title", label: "Title" },
  { id: "author", label: "Author" },
  { id: "subject", label: "Subject" },
  { id: "keywords", label: "Keywords" },
  { id: "creator", label: "Creator" },
  { id: "producer", label: "Producer" },
];

export const METADATA_DATE_FIELDS: readonly {
  id: "creationDate" | "modificationDate";
  label: string;
}[] = [
  { id: "creationDate", label: "Created" },
  { id: "modificationDate", label: "Modified" },
];

export interface MetadataReading extends PdfMetadata {
  /** Whether the catalog carries a document XMP packet (/Metadata). */
  hasXmp: boolean;
}

const INFO_KEYS: Record<keyof PdfMetadata, string> = {
  title: "Title",
  author: "Author",
  subject: "Subject",
  keywords: "Keywords",
  creator: "Creator",
  producer: "Producer",
  creationDate: "CreationDate",
  modificationDate: "ModDate",
};

async function loadUntouched(bytes: Uint8Array): Promise<PDFDocument> {
  const { PDFDocument } = await loadPdfLib();
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    throw await pdfLoadError(err, bytes);
  }
}

/** The trailer's Info dictionary, or `undefined` when the file has none. */
function infoDict(lib: PdfLibModule, doc: PDFDocument): PDFDict | undefined {
  const ref = doc.context.trailerInfo.Info;
  if (!ref) return undefined;
  const found = doc.context.lookup(ref);
  return found instanceof lib.PDFDict ? found : undefined;
}

function hasXmpPacket(lib: PdfLibModule, doc: PDFDocument): boolean {
  const entry = doc.catalog.get(lib.PDFName.of("Metadata"));
  if (!entry) return false;
  return doc.context.lookup(entry) instanceof lib.PDFStream;
}

/** A date pdf-lib could not parse comes back as `Invalid Date`: say none. */
const validDate = (date: Date | undefined): Date | null =>
  date && Number.isFinite(date.getTime()) ? date : null;

function readFrom(lib: PdfLibModule, doc: PDFDocument): MetadataReading {
  let creationDate: Date | null = null;
  let modificationDate: Date | null = null;
  try {
    creationDate = validDate(doc.getCreationDate());
  } catch {
    creationDate = null;
  }
  try {
    modificationDate = validDate(doc.getModificationDate());
  } catch {
    modificationDate = null;
  }
  return {
    title: doc.getTitle() ?? "",
    author: doc.getAuthor() ?? "",
    subject: doc.getSubject() ?? "",
    keywords: doc.getKeywords() ?? "",
    creator: doc.getCreator() ?? "",
    producer: doc.getProducer() ?? "",
    creationDate,
    modificationDate,
    hasXmp: hasXmpPacket(lib, doc),
  };
}

/** Read the eight values (and whether an XMP packet exists) without changing anything. */
export async function readPdfMetadata(
  bytes: Uint8Array,
): Promise<MetadataReading> {
  const lib = await loadPdfLib();
  const doc = await loadUntouched(bytes);
  return readFrom(lib, doc);
}

export type MetadataChange =
  { kind: "edit"; values: PdfMetadata } | { kind: "remove-all" };

export interface MetadataResult {
  bytes: Uint8Array;
  /** What the saved file holds, read back from it — not what was asked for. */
  saved: MetadataReading;
  /** The source had an XMP packet and the save replaced it. */
  replacedXmp: boolean;
  /** The source had an XMP packet and the save removed it. */
  removedXmp: boolean;
}

/** Collapse control characters a single-line field cannot hold. */
function cleanText(value: string): string {
  return Array.from(value)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code < 0x20 || code === 0x7f ? " " : ch;
    })
    .join("")
    .trim();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A fresh XMP packet holding exactly `values`. Built from char codes where a
 * character is not printable ASCII (the packet's BOM marker), so no invisible
 * character lives in this source file.
 */
export function buildXmpPacket(values: PdfMetadata): string {
  const bom = String.fromCharCode(0xfeff);
  const lines: string[] = [];
  const alt = (tag: string, text: string) =>
    `<${tag}><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(text)}</rdf:li></rdf:Alt></${tag}>`;
  if (values.title) lines.push(alt("dc:title", values.title));
  if (values.author)
    lines.push(
      `<dc:creator><rdf:Seq><rdf:li>${escapeXml(values.author)}</rdf:li></rdf:Seq></dc:creator>`,
    );
  if (values.subject) lines.push(alt("dc:description", values.subject));
  if (values.keywords)
    lines.push(`<pdf:Keywords>${escapeXml(values.keywords)}</pdf:Keywords>`);
  if (values.producer)
    lines.push(`<pdf:Producer>${escapeXml(values.producer)}</pdf:Producer>`);
  if (values.creator)
    lines.push(
      `<xmp:CreatorTool>${escapeXml(values.creator)}</xmp:CreatorTool>`,
    );
  if (values.creationDate)
    lines.push(
      `<xmp:CreateDate>${values.creationDate.toISOString()}</xmp:CreateDate>`,
    );
  if (values.modificationDate)
    lines.push(
      `<xmp:ModifyDate>${values.modificationDate.toISOString()}</xmp:ModifyDate>`,
    );
  return [
    `<?xpacket begin="${bom}" id="W5M0MpCehiHzreSzNTczkc9d"?>`,
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">`,
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">`,
    `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">`,
    ...lines,
    `</rdf:Description>`,
    `</rdf:RDF>`,
    `</x:xmpmeta>`,
    `<?xpacket end="w"?>`,
  ].join("\n");
}

function applyEdit(
  lib: PdfLibModule,
  doc: PDFDocument,
  values: PdfMetadata,
): void {
  const { PDFHexString, PDFName, PDFString } = lib;
  let info = infoDict(lib, doc);
  if (!info) {
    info = doc.context.obj({});
    doc.context.trailerInfo.Info = doc.context.register(info);
  }
  for (const { id } of METADATA_TEXT_FIELDS) {
    const key = PDFName.of(INFO_KEYS[id]);
    const text = cleanText(values[id]);
    // Hex + UTF-16 when needed: `fromText` writes any script losslessly.
    if (text) info.set(key, PDFHexString.fromText(text));
    else info.delete(key);
  }
  for (const { id } of METADATA_DATE_FIELDS) {
    const key = PDFName.of(INFO_KEYS[id]);
    const date = validDate(values[id] ?? undefined);
    if (date) info.set(key, PDFString.fromDate(date));
    else info.delete(key);
  }
}

/** The values as the save will store them — trimmed, invalid dates dropped. */
function normalized(values: PdfMetadata): PdfMetadata {
  return {
    title: cleanText(values.title),
    author: cleanText(values.author),
    subject: cleanText(values.subject),
    keywords: cleanText(values.keywords),
    creator: cleanText(values.creator),
    producer: cleanText(values.producer),
    creationDate: validDate(values.creationDate ?? undefined),
    modificationDate: validDate(values.modificationDate ?? undefined),
  };
}

/** Write `change` into a copy of the PDF and read the copy back. */
export async function writePdfMetadata(
  bytes: Uint8Array,
  change: MetadataChange,
): Promise<MetadataResult> {
  const lib = await loadPdfLib();
  const { PDFName } = lib;
  const doc = await loadUntouched(bytes);
  const hadXmp = hasXmpPacket(lib, doc);
  const metadataKey = PDFName.of("Metadata");

  if (change.kind === "remove-all") {
    const ref = doc.context.trailerInfo.Info;
    if (ref instanceof lib.PDFRef) doc.context.delete(ref);
    doc.context.trailerInfo.Info = undefined;
    const xmp = doc.catalog.get(metadataKey);
    if (xmp instanceof lib.PDFRef) doc.context.delete(xmp);
    doc.catalog.delete(metadataKey);
  } else {
    const values = normalized(change.values);
    applyEdit(lib, doc, values);
    if (hadXmp) {
      const old = doc.catalog.get(metadataKey);
      if (old instanceof lib.PDFRef) doc.context.delete(old);
      const stream = doc.context.stream(
        new TextEncoder().encode(buildXmpPacket(values)),
        { Type: "Metadata", Subtype: "XML" },
      );
      doc.catalog.set(metadataKey, doc.context.register(stream));
    }
  }

  let out: Uint8Array;
  try {
    out = await doc.save();
  } catch {
    throw new PdfEngineError(
      "This PDF could not be saved with the new metadata.",
    );
  }
  const saved = readFrom(lib, await loadUntouched(out));
  return {
    bytes: out,
    saved,
    replacedXmp: hadXmp && change.kind === "edit",
    removedXmp: hadXmp && change.kind === "remove-all",
  };
}

/** "report.pdf" → "report-metadata.pdf". */
export function metadataOutputName(sourceName: string): string {
  return outputName(sourceName, "metadata");
}

/** A `Date` as the value of an `<input type="datetime-local">`, in local time. */
export function toLocalInputValue(date: Date | null): string {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** An `<input type="datetime-local">` value back to a `Date`; blank is none. */
export function fromLocalInputValue(value: string): Date | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

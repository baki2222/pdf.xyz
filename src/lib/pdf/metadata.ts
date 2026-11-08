import type { PDFDict, PDFDocument } from "pdf-lib";
import { withDecodeBudget } from "./decode-budget";
import { pdfLoadError, PdfEngineError } from "./engine";
import { outputName } from "./files";
import { loadPdfLib, type PdfLibModule } from "./pdf-lib";
import { pruneUnreachable } from "./prune-unreachable";

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
 * fresh packet holding the same values as the Info dictionary, plus the old
 * packet's PDF/A and PDF/UA identification ({@link readXmpIdentification}) —
 * without it a PDF/A file, our own PDF to PDF/A output among them, stops
 * declaring itself PDF/A on a title change — and, with it, the PDF/A
 * extension schemas that describe it ({@link readXmpExtensionSchemas}).
 * `metadata.test.ts` pins both; PDF/A validity itself (veraPDF) is not
 * checked by any test here. Other properties the old packet
 * held are not carried (the runner says so). A file with no packet gets none.
 *
 * A date is shown in a minute-precision field, so a date the person left
 * alone comes back without its seconds. A date within the same minute as the
 * source's is that untouched date: its Info entry is kept as written — its
 * seconds and its time-zone offset — and the XMP gets the full-precision
 * value. "Remove all metadata" deletes the Info
 * dictionary and the document XMP packet both, each page's own XMP packet and
 * the private application data (/PieceInfo) on the pages and the catalog,
 * then drops every object nothing refers to any more — an earlier Info
 * dictionary an incremental save left behind would otherwise be saved too.
 *
 * Loaded with `updateMetadata: false` — a plain `PDFDocument.load` rewrites
 * Producer, Creator and ModDate on the way in, which on THIS tool would put
 * pdf-lib's values over the ones the person typed. `metadata.test.ts` re-opens
 * every output with pdf-lib AND pdf.js and reads the values back.
 */

/**
 * The XMP identification schemas a save carries from the old packet to the
 * new one, with the properties each defines (ISO 19005 and ISO 14289).
 */
export const XMP_IDENTIFICATION = [
  {
    prefix: "pdfaid",
    namespace: "http://www.aiim.org/pdfa/ns/id/",
    properties: ["part", "amd", "conformance", "rev"],
  },
  {
    prefix: "pdfuaid",
    namespace: "http://www.aiim.org/pdfua/ns/id/",
    properties: ["part", "amd", "rev"],
  },
] as const;

/** One identification property as the old packet stated it. */
export interface XmpIdentificationValue {
  prefix: string;
  namespace: string;
  property: string;
  value: string;
}

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

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The PDF/A and PDF/UA identification an XMP packet declares, in either XMP
 * spelling (attribute `pdfaid:part='2'`, which Ghostscript writes, or element
 * `<pdfaid:part>2</pdfaid:part>`) and under whatever prefix the packet binds
 * the namespace to.
 */
export function readXmpIdentification(xmp: string): XmpIdentificationValue[] {
  const found: XmpIdentificationValue[] = [];
  for (const schema of XMP_IDENTIFICATION) {
    const binding = new RegExp(
      `xmlns:([A-Za-z_][\\w.-]*)\\s*=\\s*(["'])${escapeRegExp(schema.namespace)}\\2`,
    ).exec(xmp);
    if (!binding) continue;
    for (const property of schema.properties) {
      const qualified = escapeRegExp(`${binding[1]!}:${property}`);
      const attribute = new RegExp(
        `${qualified}\\s*=\\s*(["'])\\s*([^"'<>]*?)\\s*\\1`,
      );
      const element = new RegExp(
        `<${qualified}(?:\\s[^>]*)?>\\s*([^<]*?)\\s*</${qualified}>`,
      );
      const value = xmp.match(attribute)?.[2] ?? xmp.match(element)?.[1];
      if (value) {
        found.push({
          prefix: schema.prefix,
          namespace: schema.namespace,
          property,
          value,
        });
      }
    }
  }
  return found;
}

const PDFA_EXTENSION_NAMESPACE = "http://www.aiim.org/pdfa/ns/extension/";

/**
 * The old packet's PDF/A extension schemas (`pdfaExtension:schemas`), copied
 * verbatim into an `rdf:Description` of their own that binds every prefix
 * the copy uses — the old packet may have bound them on `rdf:RDF` or
 * `x:xmpmeta`, which the new packet does not reproduce. Without it a PDF/A-2
 * or -3 file that declares PDF/UA (pdfuaid is not predefined there) or any
 * custom property no longer describes it, and fails validation (veraPDF
 * 6.6.2.3.1). Null when the packet has none.
 */
export function readXmpExtensionSchemas(xmp: string): string | null {
  const binding = new RegExp(
    `xmlns:([A-Za-z_][\\w.-]*)\\s*=\\s*(["'])${escapeRegExp(PDFA_EXTENSION_NAMESPACE)}\\2`,
  ).exec(xmp);
  if (!binding) return null;
  const qualified = escapeRegExp(`${binding[1]!}:schemas`);
  const element = new RegExp(
    `<${qualified}(?:\\s[^>]*)?>[\\s\\S]*?</${qualified}\\s*>`,
  ).exec(xmp)?.[0];
  if (!element) return null;
  const bound = new Map<string, string>();
  for (const m of xmp.matchAll(
    /xmlns:([A-Za-z_][\w.-]*)\s*=\s*(["'])([^"']*)\2/g,
  )) {
    if (!bound.has(m[1]!)) bound.set(m[1]!, m[3]!);
  }
  const used = new Set(
    [
      ...element.matchAll(
        /<\/?([A-Za-z_][\w.-]*):|\s([A-Za-z_][\w.-]*):[\w.-]+\s*=/g,
      ),
    ].map((m) => (m[1] ?? m[2])!),
  );
  const declarations = [...used]
    // xml and xmlns are bound by XML itself, rdf by the new packet's rdf:RDF.
    .filter((prefix) => !["xml", "xmlns", "rdf"].includes(prefix))
    .flatMap((prefix) => {
      const uri = bound.get(prefix);
      return uri === undefined
        ? []
        : [` xmlns:${prefix}="${uri.replace(/"/g, "&quot;")}"`];
    })
    .join("");
  return `<rdf:Description rdf:about=""${declarations}>\n${element}\n</rdf:Description>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A fresh XMP packet holding exactly `values`, and the `identification` the
 * old packet declared with the `extension` schemas that describe it
 * ({@link readXmpExtensionSchemas}; carried only with an identification).
 * Built from char codes where a character is not printable ASCII (the
 * packet's BOM marker), so no invisible character lives in this source file.
 */
export function buildXmpPacket(
  values: PdfMetadata,
  identification: readonly XmpIdentificationValue[] = [],
  extension: string | null = null,
): string {
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
    ...XMP_IDENTIFICATION.flatMap((schema) => {
      const own = identification.filter((i) => i.prefix === schema.prefix);
      if (own.length === 0) return [];
      return [
        `<rdf:Description rdf:about="" xmlns:${schema.prefix}="${schema.namespace}">`,
        ...own.map(
          (i) =>
            `<${i.prefix}:${i.property}>${escapeXml(i.value)}</${i.prefix}:${i.property}>`,
        ),
        `</rdf:Description>`,
      ];
    }),
    ...(identification.length > 0 && extension ? [extension] : []),
    `</rdf:RDF>`,
    `</x:xmpmeta>`,
    `<?xpacket end="w"?>`,
  ].join("\n");
}

/**
 * Write `values` into the Info dictionary. A date equal to the `source`'s
 * (see {@link keepUntouchedDates}) is left as the source wrote it.
 */
function applyEdit(
  lib: PdfLibModule,
  doc: PDFDocument,
  values: PdfMetadata,
  source: PdfMetadata,
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
    if (date && date.getTime() === source[id]?.getTime()) continue;
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

const MINUTE = 60_000;

/**
 * A date in the same minute as the source's is the one the person did not
 * change (the editor's field cannot show seconds): use the source's own,
 * full-precision value.
 */
function keepUntouchedDates(
  values: PdfMetadata,
  source: PdfMetadata,
): PdfMetadata {
  const kept = { ...values };
  for (const { id } of METADATA_DATE_FIELDS) {
    const date = values[id];
    const was = source[id];
    if (
      date &&
      was &&
      Math.floor(date.getTime() / MINUTE) === Math.floor(was.getTime() / MINUTE)
    ) {
      kept[id] = was;
    }
  }
  return kept;
}

/**
 * The most an existing XMP packet may inflate to before it is treated as
 * absent (EDIT-11: a 1 MB file whose packet inflated to 1 GiB). A real packet
 * is kilobytes; 16 MiB still carries one bloated by years of editing history
 * (Photoshop's DocumentAncestors lists reach megabytes). Over it, the edit
 * goes on as if the file had no old packet: only its PDF/A identification and
 * extension schemas are not carried over.
 */
const MAX_XMP_PACKET_BYTES = 16 * 1024 * 1024;

function xmpText(lib: PdfLibModule, doc: PDFDocument): string | undefined {
  const stream = doc.catalog.lookup(lib.PDFName.of("Metadata"));
  if (!(stream instanceof lib.PDFRawStream)) return undefined;
  try {
    return new TextDecoder().decode(
      withDecodeBudget(MAX_XMP_PACKET_BYTES, () =>
        lib.decodePDFRawStream(stream).decode(),
      ),
    );
  } catch {
    return undefined;
  }
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
    const pieceInfo = PDFName.of("PieceInfo");
    doc.catalog.delete(pieceInfo);
    for (const page of doc.getPages()) {
      page.node.delete(metadataKey);
      page.node.delete(pieceInfo);
    }
    pruneUnreachable(lib, doc);
  } else {
    const source = readFrom(lib, doc);
    const values = keepUntouchedDates(normalized(change.values), source);
    const oldPacket = xmpText(lib, doc) ?? "";
    const identification = readXmpIdentification(oldPacket);
    const extension = readXmpExtensionSchemas(oldPacket);
    applyEdit(lib, doc, values, source);
    if (hadXmp) {
      const old = doc.catalog.get(metadataKey);
      if (old instanceof lib.PDFRef) doc.context.delete(old);
      const stream = doc.context.stream(
        new TextEncoder().encode(
          buildXmpPacket(values, identification, extension),
        ),
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

/**
 * Real OpenDocument and RTF files, built here, for the formats Word, Excel and
 * PowerPoint to PDF began taking on 2026-11-04 — one distinctive word in each,
 * so a proof can read that word back out of the PDF LibreOffice makes.
 *
 * Each OpenDocument file is what the spec asks for and what LibreOffice
 * writes: a ZIP whose FIRST entry is `mimetype`, STORED, holding the exact
 * type; then `META-INF/manifest.xml` and `content.xml` (and, for the deck,
 * `styles.xml` with the master page its slide names). The RTF is plain text.
 *
 * Used by the in-image proof (`pnpm worker:office-input-proof`) and the
 * production proof (`pnpm worker:prove-tools`), so the file the CI image
 * converts is the file production is asked to convert.
 */
import JSZip from "jszip";
import type { OfficeInputFixture } from "@/lib/workers/office-conversion/input-proof";

const OFFICE = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
const TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
const TABLE = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
const DRAW = "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0";
const SVG = "urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0";
const STYLE = "urn:oasis:names:tc:opendocument:xmlns:style:1.0";
const FO = "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0";
const PRESENTATION = "urn:oasis:names:tc:opendocument:xmlns:presentation:1.0";
const MANIFEST = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0";
const DECL = `<?xml version="1.0" encoding="UTF-8"?>`;

const ODF_TYPES = {
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
} as const;

/** An OpenDocument package: `mimetype` stored first, the parts after it. */
async function odfPackage(
  kind: keyof typeof ODF_TYPES,
  parts: Record<string, string>,
): Promise<Uint8Array> {
  const type = ODF_TYPES[kind];
  const zip = new JSZip();
  zip.file("mimetype", type, { compression: "STORE" });
  const entries = Object.keys(parts)
    .map(
      (path) =>
        `<manifest:file-entry manifest:full-path="${path}" manifest:media-type="text/xml"/>`,
    )
    .join("");
  zip.file(
    "META-INF/manifest.xml",
    `${DECL}<manifest:manifest xmlns:manifest="${MANIFEST}" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="${type}"/>${entries}</manifest:manifest>`,
  );
  for (const [path, xml] of Object.entries(parts)) zip.file(path, xml);
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
}

const documentContent = (body: string, extraNs = "") =>
  `${DECL}<office:document-content xmlns:office="${OFFICE}" xmlns:text="${TEXT}"${extraNs} office:version="1.2"><office:body>${body}</office:body></office:document-content>`;

export async function odtWith(word: string): Promise<Uint8Array> {
  return odfPackage("odt", {
    "content.xml": documentContent(
      `<office:text><text:p>OpenDocument text proof: ${word}</text:p></office:text>`,
    ),
  });
}

export async function odsWith(word: string): Promise<Uint8Array> {
  const cell = (text: string) =>
    `<table:table-cell office:value-type="string"><text:p>${text}</text:p></table:table-cell>`;
  return odfPackage("ods", {
    "content.xml": documentContent(
      `<office:spreadsheet><table:table table:name="Proof"><table:table-row>${cell("Region")}${cell(word)}</table:table-row><table:table-row>${cell("North")}${cell("1200")}</table:table-row></table:table></office:spreadsheet>`,
      ` xmlns:table="${TABLE}"`,
    ),
  });
}

export async function odpWith(word: string): Promise<Uint8Array> {
  return odfPackage("odp", {
    "styles.xml": `${DECL}<office:document-styles xmlns:office="${OFFICE}" xmlns:style="${STYLE}" xmlns:fo="${FO}" office:version="1.2"><office:automatic-styles><style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="28cm" fo:page-height="15.75cm" style:print-orientation="landscape"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="PM1"/></office:master-styles></office:document-styles>`,
    "content.xml": documentContent(
      `<office:presentation><draw:page draw:name="Slide1" draw:master-page-name="Default"><draw:frame svg:x="2cm" svg:y="2cm" svg:width="24cm" svg:height="4cm"><draw:text-box><text:p>OpenDocument slide proof: ${word}</text:p></draw:text-box></draw:frame></draw:page></office:presentation>`,
      ` xmlns:draw="${DRAW}" xmlns:svg="${SVG}" xmlns:presentation="${PRESENTATION}"`,
    ),
  });
}

export function rtfWith(word: string): Uint8Array {
  return new TextEncoder().encode(
    `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Times New Roman;}}\\f0\\fs24 Rich Text proof: ${word}\\par}`,
  );
}

/** One fixture per new format, in the order the tools list them. */
export const OFFICE_INPUT_FIXTURES: readonly OfficeInputFixture[] = [
  {
    kind: "odt",
    tool: "word-to-pdf",
    name: "letter.odt",
    type: ODF_TYPES.odt,
    word: "Quillwort",
    build: () => odtWith("Quillwort"),
  },
  {
    kind: "rtf",
    tool: "word-to-pdf",
    name: "memo.rtf",
    type: "application/rtf",
    word: "Marzipane",
    build: async () => rtfWith("Marzipane"),
  },
  {
    kind: "ods",
    tool: "excel-to-pdf",
    name: "budget.ods",
    type: ODF_TYPES.ods,
    word: "Zinnober",
    build: () => odsWith("Zinnober"),
  },
  {
    kind: "odp",
    tool: "powerpoint-to-pdf",
    name: "deck.odp",
    type: ODF_TYPES.odp,
    word: "Narwhalia",
    build: () => odpWith("Narwhalia"),
  },
];

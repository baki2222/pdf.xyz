/**
 * `pnpm worker:prove-tools` — submit ONE REAL JOB per worker-backed tool against a
 * live deployment and verify the artifact that comes back.
 *
 * Why this exists: every readiness surface in this codebase is presence-only. A
 * processor's `ready` is derived from a dependency being *wired*
 * (`deps.extract != null`), never from that dependency being able to run — so a
 * dependency that throws on every call still reports `ready: true`. On 2026-08-01
 * that hid five tools that were live and failing 100% of jobs. No unit test, status
 * endpoint, or log line could see it. A real job could.
 *
 * It is a deployment probe, not a unit test: it needs a running web app + worker,
 * so it is deliberately NOT part of `pnpm test`. Run it after every worker deploy.
 *
 *   BASE=https://pdf.xyz pnpm worker:prove-tools            # every tool
 *   BASE=https://pdf.xyz pnpm worker:prove-tools ocr-pdf    # just these
 *
 * Privacy: it prints status codes, byte counts, and generated filenames only —
 * never a signed URL, token, or password. Every fixture is generated here; no user
 * document is ever read. Inputs and artifacts land in the deployment's own storage
 * under its normal retention policy.
 *
 * Exit codes: 0 = every selected tool proven; 1 = at least one failed or a
 * worker-backed tool has no spec below (a new tool must arrive with a proof).
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import { deflateSync } from "node:zlib";
import { getAllToolSlugs, getToolBySlug } from "@/lib/tools";
import { capabilityForMode, usesWorkerBackend } from "@/lib/jobs/capabilities";

const BASE = process.env.BASE ?? "https://pdf.xyz";
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const JOB_TIMEOUT_MS = 240_000;

// A per-run password so a proof job never reuses a fixed secret. It only ever
// protects a generated fixture and is never printed.
const PROOF_PASSWORD = `pdfxyz-proof-${process.pid}-${process.hrtime.bigint()}`;

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === "%PDF-";
/** OOXML and ZIP artifacts alike start with the local-file-header magic `PK\x03\x04`. */
const isZipContainer = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;

// ───────────────────────────────── fixtures ──────────────────────────────────

/** A PDF with genuinely selectable text — the baseline input for most tools. */
async function textPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText("pdf.xyz deployment proof", { x: 60, y: 770, size: 20, font });
  page.drawText("This document carries real, selectable text so that", {
    x: 60, y: 735, size: 11, font,
  });
  page.drawText("text-extracting tools have something honest to extract.", {
    x: 60, y: 718, size: 11, font,
  });
  return Buffer.from(await doc.save());
}

/**
 * A PDF whose text is laid out as a column-aligned grid, which is what the table
 * engine detects. Columns sit at fixed x positions and rows at fixed y.
 */
async function tablePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]);
  page.drawText("Quarterly results", { x: 60, y: 780, size: 16, font: bold });
  const cols = [60, 200, 330, 450];
  const rows = [
    ["Region", "Q1", "Q2", "Q3"],
    ["North", "1200", "1350", "1410"],
    ["South", "980", "1020", "1105"],
    ["East", "1560", "1490", "1620"],
    ["West", "720", "860", "915"],
  ];
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      page.drawText(cell, {
        x: cols[c]!, y: 740 - r * 24, size: 11, font: r === 0 ? bold : font,
      });
    });
  });
  return Buffer.from(await doc.save());
}

/** A PDF carrying an embedded raster, so deep compression has real image work. */
async function imagePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const size = 64;
  // Deterministic noise: incompressible by structural repack alone, so a size
  // change proves the image pipeline ran rather than a metadata rewrite.
  const raw = Buffer.alloc(size * size * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919) % 251;
  const img = await doc.embedPng(encodePng(raw, size, size));
  page.drawImage(img, { x: 60, y: 400, width: 400, height: 400 });
  page.drawRectangle({ x: 60, y: 300, width: 400, height: 40, color: rgb(0.2, 0.3, 0.9) });
  return Buffer.from(await doc.save());
}

/** Minimal PNG encoder — avoids adding an image dependency for one fixture. */
function encodePng(rgbData: Buffer, width: number, height: number): Buffer {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    rgbData.copy(raw, y * stride + 1, y * width * 3, (y + 1) * width * 3);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let CRC_TABLE: Int32Array | null = null;
function crc32(buf: Buffer): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return c ^ 0xffffffff;
}

function htmlFile(): Buffer {
  return Buffer.from(
    `<!doctype html><html><head><meta charset="utf-8"><title>pdf.xyz proof</title>
<style>body{font-family:sans-serif;padding:40px}h1{color:#4c1d95}</style></head>
<body><h1>HTML to PDF</h1><p>Rendered by Chromium on the secure worker.</p>
<table border="1"><tr><th>Row</th><th>Value</th></tr><tr><td>1</td><td>alpha</td></tr></table>
</body></html>`,
    "utf8",
  );
}

function csvFile(): Buffer {
  return Buffer.from("Region,Q1,Q2\nNorth,1200,1350\nSouth,980,1020\n", "utf8");
}

const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const ODOC_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const rootRels = (target: string, type: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${type}" Target="${target}"/></Relationships>`;

/** A real DOCX. LibreOffice rejects a stub, so the required parts are all here. */
async function docxFile(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file("_rels/.rels", rootRels("word/document.xml", `${ODOC_NS}/officeDocument`));
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>Word to PDF — pdf.xyz deployment proof</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

/** A real XLSX with one inline-string worksheet. */
async function xlsxFile(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
  );
  zip.file("_rels/.rels", rootRels("xl/workbook.xml", `${ODOC_NS}/officeDocument`));
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${ODOC_NS}"><sheets><sheet name="Proof" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file("xl/_rels/workbook.xml.rels", rootRels("worksheets/sheet1.xml", `${ODOC_NS}/worksheet`));
  const cell = (ref: string, text: string) =>
    `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1">${cell("A1", "Region")}${cell("B1", "Q1")}</row>
<row r="2">${cell("A2", "North")}${cell("B2", "1200")}</row>
</sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

/** A real PPTX. PresentationML needs the whole master/layout/theme chain to open. */
async function pptxFile(): Promise<Buffer> {
  const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`,
  );
  zip.file("_rels/.rels", rootRels("ppt/presentation.xml", `${ODOC_NS}/officeDocument`));
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${ODOC_NS}">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
<p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
<Relationship Id="rId1" Type="${ODOC_NS}/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="${ODOC_NS}/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId3" Type="${ODOC_NS}/theme" Target="theme/theme1.xml"/></Relationships>`,
  );

  const spTree = (title: string) => `<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="685800" y="2130425"/><a:ext cx="7772400" cy="1470025"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="3200"/><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree>`;

  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${ODOC_NS}"><p:cSld>${spTree("PowerPoint to PDF — pdf.xyz proof")}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    rootRels("../slideLayouts/slideLayout1.xml", `${ODOC_NS}/slideLayout`),
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${ODOC_NS}" type="title"><p:cSld name="Title Slide">${spTree("")}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    rootRels("../slideMasters/slideMaster1.xml", `${ODOC_NS}/slideMaster`),
  );

  const clrMap = `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`;
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${ODOC_NS}"><p:cSld>${spTree("")}</p:cSld>${clrMap}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
<Relationship Id="rId1" Type="${ODOC_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="${ODOC_NS}/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );

  const clr = (tag: string, hex: string) => `<a:${tag}><a:srgbClr val="${hex}"/></a:${tag}>`;
  const fnt = (tag: string) =>
    `<a:${tag}><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:${tag}>`;
  const styleList = (tag: string, inner: string) =>
    `<a:${tag}>${inner.repeat(3)}</a:${tag}>`;
  zip.file(
    "ppt/theme/theme1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${A}" name="Proof"><a:themeElements>
<a:clrScheme name="Proof">${clr("dk1", "000000")}${clr("lt1", "FFFFFF")}${clr("dk2", "1F497D")}${clr("lt2", "EEECE1")}${clr("accent1", "4F81BD")}${clr("accent2", "C0504D")}${clr("accent3", "9BBB59")}${clr("accent4", "8064A2")}${clr("accent5", "4BACC6")}${clr("accent6", "F79646")}${clr("hlink", "0000FF")}${clr("folHlink", "800080")}</a:clrScheme>
<a:fontScheme name="Proof">${fnt("majorFont")}${fnt("minorFont")}</a:fontScheme>
<a:fmtScheme name="Proof">
${styleList("fillStyleLst", `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`)}
${styleList("lnStyleLst", `<a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>`)}
${styleList("effectStyleLst", `<a:effectStyle><a:effectLst/></a:effectStyle>`)}
${styleList("bgFillStyleLst", `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`)}
</a:fmtScheme></a:themeElements></a:theme>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

// ────────────────────────────────── specs ────────────────────────────────────

interface ProofSpec {
  tool: string;
  /** Distinguishes two specs for the same tool (e.g. xlsx vs csv input). */
  label?: string;
  make?: () => Promise<Buffer> | Buffer;
  /** Reuse a previous spec's artifact as this one's input (protect → unlock). */
  from?: string;
  name?: string;
  type?: string;
  /** URL-input tools carry no file; the source goes in `options.url`. */
  url?: string;
  options?: Record<string, unknown>;
  expect: (bytes: Buffer) => boolean;
  want: string;
  keepArtifactAs?: string;
}

const SPECS: ProofSpec[] = [
  { tool: "compress-pdf", make: imagePdf, name: "photo.pdf", type: PDF_MIME,
    options: { profile: "deep" }, expect: isPdf, want: "PDF" },
  { tool: "repair-pdf", make: textPdf, name: "broken.pdf", type: PDF_MIME,
    expect: isPdf, want: "PDF" },
  { tool: "optimize-web", make: textPdf, name: "web.pdf", type: PDF_MIME,
    expect: isPdf, want: "linearized PDF" },
  { tool: "ocr-pdf", make: imagePdf, name: "scan.pdf", type: PDF_MIME,
    expect: isPdf, want: "searchable PDF" },
  { tool: "protect-pdf", make: textPdf, name: "secret.pdf", type: PDF_MIME,
    options: { password: PROOF_PASSWORD, keyLength: 256 },
    expect: isPdf, want: "encrypted PDF", keepArtifactAs: "encrypted" },
  // Chained deliberately: unlocking the artifact protect-pdf just produced proves
  // both directions against the same document.
  { tool: "unlock-pdf", from: "encrypted", name: "secret-protected.pdf", type: PDF_MIME,
    options: { password: PROOF_PASSWORD }, expect: isPdf, want: "decrypted PDF" },
  { tool: "pdf-to-pdfa", make: textPdf, name: "archive.pdf", type: PDF_MIME,
    expect: isPdf, want: "PDF/A" },
  { tool: "html-to-pdf", make: htmlFile, name: "page.html", type: "text/html",
    expect: isPdf, want: "PDF" },
  { tool: "webpage-to-pdf", url: "https://example.com/", expect: isPdf, want: "PDF" },
  { tool: "word-to-pdf", make: docxFile, name: "letter.docx", type: DOCX_MIME,
    expect: isPdf, want: "PDF" },
  { tool: "excel-to-pdf", make: xlsxFile, name: "sheet.xlsx", type: XLSX_MIME,
    expect: isPdf, want: "PDF" },
  { tool: "excel-to-pdf", label: "excel-to-pdf (csv)", make: csvFile, name: "rows.csv",
    type: "text/csv", expect: isPdf, want: "PDF" },
  { tool: "powerpoint-to-pdf", make: pptxFile, name: "deck.pptx", type: PPTX_MIME,
    expect: isPdf, want: "PDF" },
  { tool: "pdf-to-word", make: textPdf, name: "doc.pdf", type: PDF_MIME,
    expect: isZipContainer, want: "DOCX" },
  { tool: "pdf-to-excel", make: tablePdf, name: "table.pdf", type: PDF_MIME,
    expect: isZipContainer, want: "XLSX" },
  { tool: "pdf-to-powerpoint", make: textPdf, name: "doc.pdf", type: PDF_MIME,
    expect: isZipContainer, want: "PPTX" },
  { tool: "extract-tables", make: tablePdf, name: "table.pdf", type: PDF_MIME,
    expect: isZipContainer, want: "ZIP of CSV+XLSX" },
  { tool: "request-signatures", make: textPdf, name: "agreement.pdf", type: PDF_MIME,
    options: {
      signers: [{ name: "Proof Signer", email: "proof@pdf.xyz" }],
      fields: [{ signer: 0, page: 1, type: "signature", x: 0.1, y: 0.1,
                 width: 0.3, height: 0.06, required: true }],
      routing: "sequential",
    },
    expect: isZipContainer, want: "signature-request ZIP" },

  // The AI tools. They run only when an operator has configured a provider; with
  // none they fail honestly as not-configured, which is correct behaviour rather
  // than a proof — so a run against an AI-less deployment reports them as failures
  // and that is the honest answer, not a bug in this harness.
  { tool: "summarize-pdf", make: textPdf, name: "report.pdf", type: PDF_MIME,
    options: { length: "brief", format: "paragraphs" },
    expect: isZipContainer, want: "summary ZIP" },
  { tool: "translate-pdf", make: textPdf, name: "letter.pdf", type: PDF_MIME,
    options: { targetLanguage: "es", sourceLanguage: "auto" },
    expect: isZipContainer, want: "translation ZIP" },
  { tool: "ai-extract", make: tablePdf, name: "table.pdf", type: PDF_MIME,
    options: {
      mode: "schema",
      schema: [
        { name: "region", type: "string", description: "The region name" },
        { name: "q1", type: "number", description: "The Q1 figure" },
      ],
    },
    expect: isZipContainer, want: "extraction ZIP" },
  { tool: "chat-with-pdf", make: textPdf, name: "doc.pdf", type: PDF_MIME,
    options: { question: "In one sentence, what is this document for?" },
    expect: isZipContainer, want: "answer ZIP" },
];

/** Worker-backed tools with no spec above — a new tool must arrive with a proof. */
function unspecifiedWorkerTools(): string[] {
  const specified = new Set(SPECS.map((s) => s.tool));
  return getAllToolSlugs().filter((slug) => {
    if (specified.has(slug)) return false;
    const tool = getToolBySlug(slug);
    return tool ? usesWorkerBackend(capabilityForMode(tool.processing)) : false;
  });
}

// ────────────────────────────────── runner ───────────────────────────────────

interface ProofResult {
  label: string;
  ok: boolean;
  stage?: string;
  detail?: string;
  seconds?: number;
}

/** Only the response fields this probe actually reads. */
interface UploadSlot {
  url: string;
  method: string;
  headers: Record<string, string>;
  fileId: string;
}
interface ApiResponse {
  slots?: UploadSlot[];
  jobId?: string;
  id?: string;
  status?: string;
  error?: { code: string; message: string };
  artifacts?: { artifactId: string; filename: string }[];
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "canceled", "expired"]);

const carried = new Map<string, Buffer>();

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, body: (await res.json().catch(() => ({}))) as ApiResponse };
}

async function runSpec(spec: ProofSpec): Promise<ProofResult> {
  const label = spec.label ?? spec.tool;
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 1000);
  let inputs: string[] = [];
  let inputNames: string[] | undefined;

  if (!spec.url) {
    const bytes = spec.from ? carried.get(spec.from) : Buffer.from(await spec.make!());
    if (!bytes) {
      return { label, ok: false, stage: "input", detail: `no carried "${spec.from}"` };
    }
    const up = await postJson("/api/uploads", {
      tool: spec.tool,
      files: [{ filename: spec.name, contentType: spec.type, bytes: bytes.length }],
    });
    if (!up.res.ok) {
      return { label, ok: false, seconds: seconds(), stage: "uploads",
               detail: `HTTP ${up.res.status} ${JSON.stringify(up.body).slice(0, 200)}` };
    }
    const slot = up.body.slots?.[0];
    if (!slot) {
      return { label, ok: false, seconds: seconds(), stage: "uploads",
               detail: "the upload session returned no slot" };
    }
    const put = await fetch(slot.url, {
      method: slot.method,
      headers: slot.headers,
      // A Buffer view, not the Buffer itself: `fetch` takes a BodyInit.
      body: new Uint8Array(bytes),
    });
    if (!put.ok) {
      return { label, ok: false, seconds: seconds(), stage: "storage PUT",
               detail: `HTTP ${put.status}` };
    }
    inputs = [slot.fileId];
    inputNames = [spec.name!];
  }

  const request: Record<string, unknown> = {
    tool: spec.tool,
    inputs,
    ...(inputNames ? { inputNames } : {}),
  };
  if (spec.url) request.options = { url: spec.url };
  else if (spec.options) request.options = spec.options;

  const created = await postJson("/api/jobs", request);
  if (!created.res.ok) {
    return { label, ok: false, seconds: seconds(), stage: "create job",
             detail: `HTTP ${created.res.status} ${JSON.stringify(created.body).slice(0, 240)}` };
  }

  const jobId = created.body.jobId ?? created.body.id;
  if (!jobId) {
    return { label, ok: false, seconds: seconds(), stage: "create job",
             detail: "the job was accepted but carried no id" };
  }
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let job = created.body;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const poll = await fetch(`${BASE}/api/jobs/${jobId}`);
    job = (await poll.json().catch(() => ({}))) as ApiResponse;
    if (job.status && TERMINAL_STATUSES.has(job.status)) break;
  }
  if (job.status !== "completed") {
    return { label, ok: false, seconds: seconds(), stage: `job ${job.status ?? "timeout"}`,
             detail: job.error ? `${job.error.code}: ${job.error.message}`.slice(0, 240) : "" };
  }

  const artifact = job.artifacts?.[0];
  if (!artifact) return { label, ok: false, seconds: seconds(), stage: "no artifact" };

  const download = await fetch(`${BASE}/api/artifacts/${artifact.artifactId}`, {
    redirect: "follow",
  });
  const buf = Buffer.from(await download.arrayBuffer());
  if (!download.ok) {
    return { label, ok: false, seconds: seconds(), stage: "artifact download",
             detail: `HTTP ${download.status}` };
  }
  if (!spec.expect(buf)) {
    return { label, ok: false, seconds: seconds(), stage: "artifact shape",
             detail: `wanted ${spec.want}, got ${buf.length}B starting ${JSON.stringify(buf.subarray(0, 8).toString("latin1"))}` };
  }
  if (spec.keepArtifactAs) carried.set(spec.keepArtifactAs, buf);
  return { label, ok: true, seconds: seconds(),
           detail: `${artifact.filename} — ${buf.length}B ${spec.want}` };
}

async function main(): Promise<number> {
  const missing = unspecifiedWorkerTools();
  const selected = SPECS.filter(
    (s) => ONLY.length === 0 || ONLY.includes(s.tool) || ONLY.includes(s.label ?? ""),
  );
  if (selected.length === 0) {
    console.log(`No spec matches ${ONLY.join(", ")}.`);
    return 1;
  }

  console.log(`Proving ${selected.length} tool run(s) against ${BASE}\n`);
  const results: ProofResult[] = [];
  for (const spec of selected) {
    let result: ProofResult;
    try {
      result = await runSpec(spec);
    } catch (error) {
      result = { label: spec.label ?? spec.tool, ok: false, stage: "threw",
                 detail: (error as Error).message };
    }
    results.push(result);
    console.log(
      `${result.ok ? "PASS" : "FAIL"}  ${result.label.padEnd(24)} ` +
        `${String(result.seconds ?? "-") + "s"}`.padStart(5) +
        `  ${result.ok ? result.detail : `[${result.stage}] ${result.detail ?? ""}`}`,
    );
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} proven end to end against ${BASE}`);

  // Only meaningful on a full run — a filtered run says nothing about coverage.
  if (ONLY.length === 0 && missing.length > 0) {
    console.log(
      `\nNO PROOF SPEC for ${missing.length} worker-backed tool(s): ${missing.join(", ")}` +
        `\nAdd one to SPECS in this file — an unproven tool is one nobody has checked works.`,
    );
  }
  return passed === results.length && !(ONLY.length === 0 && missing.length > 0) ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });

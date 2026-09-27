import JSZip from "jszip";
import type { ExtractedPdfText } from "@/lib/pdf/text";

export const PDF_TO_WORD_TOOL = "pdf-to-word";
export const PDF_TO_EXCEL_TOOL = "pdf-to-excel";
export const PDF_TO_POWERPOINT_TOOL = "pdf-to-powerpoint";
export const PDF_OFFICE_EXPORT_TOOLS = [
  PDF_TO_WORD_TOOL,
  PDF_TO_EXCEL_TOOL,
  PDF_TO_POWERPOINT_TOOL,
] as const;
export type PdfOfficeExportTool = (typeof PDF_OFFICE_EXPORT_TOOLS)[number];
/**
 * The engine name that ships inside every PDF→Office job result.
 *
 * RENAMED 2026-08-11 from `pdfjs-office-openxml`, which named an extractor this
 * worker does not use and cannot use — pdfjs is browser-only and throws under
 * Node before reading a byte, which is why `pdf-text/native` shells out to
 * `pdftotext` instead. Job records written before that date carry the old value.
 */
export const PDF_OFFICE_EXPORT_ENGINE = "pdftotext-office-openxml" as const;

export type PdfTextExtractor = (bytes: Uint8Array) => Promise<ExtractedPdfText>;
export interface PdfOfficeExportDeps {
  extract?: PdfTextExtractor;
  limits?: { maxInputBytes?: number; maxOutputBytes?: number };
}
export interface PdfOfficeExportMeta {
  engine: typeof PDF_OFFICE_EXPORT_ENGINE;
  tool: PdfOfficeExportTool;
  pageCount: number;
  inputBytes: number;
  outputBytes: number;
  characterCount: number;
}
export type PdfOfficeExportRun =
  | {
      ok: true;
      output: Uint8Array;
      filenameExt: "docx" | "xlsx" | "pptx";
      contentType: string;
      meta: PdfOfficeExportMeta;
    }
  | {
      ok: false;
      kind: "unsupported" | "no_text" | "too_large" | "failed";
      limitBytes?: number;
      message: string;
    };

/**
 * Characters XML 1.0 forbids outright (§2.2): C0 controls other than tab, LF
 * and CR; the non-characters U+FFFE/U+FFFF; and unpaired surrogates. pdftotext
 * passes through whatever a font's ToUnicode map claims, and ONE such character
 * makes the whole part unparseable — Word, Excel and PowerPoint then refuse the
 * file, not the character. They carry no readable text, so they are dropped.
 */
const XML_FORBIDDEN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function esc(s: string): string {
  return s
    .replace(XML_FORBIDDEN, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

async function docx(text: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  const body = lines(text)
    .map((l) => `<w:p><w:r><w:t>${esc(l)}</w:t></w:r></w:p>`)
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  );
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

function rows(text: string): string[][] {
  return lines(text).map((l) =>
    l
      .split(/\t| {2,}|,/)
      .map((c) => c.trim())
      .filter(Boolean),
  );
}
async function xlsx(text: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Extracted text" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  const sheetData = rows(text)
    .map(
      (r, ri) =>
        `<row r="${ri + 1}">${r.map((c, ci) => `<c r="${String.fromCharCode(65 + Math.min(ci, 25))}${ri + 1}" t="inlineStr"><is><t>${esc(c)}</t></is></c>`).join("")}</row>`,
    )
    .join("");
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`,
  );
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

// ── PresentationML ─────────────────────────────────────────────────────────
//
// Until 2026-09-27 pptx() wrote presentation.xml and the slides and nothing
// else, and PowerPoint for Windows refused every file as "corrupted and
// unreadable". A presentation is a CHAIN: presentation → slide master → theme,
// master → the layouts it lists, each slide → one of those layouts. What is
// below is the smallest package that walks it, and `pptx-package.ts` is the
// independent check that it does (it shares none of these constants on
// purpose, and must also pass a deck PowerPoint saved itself).

const XML_DECL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
const OFFICE_CT = "application/vnd.openxmlformats-officedocument";
const PML_CT = `${OFFICE_CT}.presentationml`;
const OFFICE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PML_NS = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${OFFICE_REL}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;
/** Master and layout ids share one space that starts at 2^31 (ECMA-376). */
const MASTER_ID = 2_147_483_648;
/** 16:9 widescreen, PowerPoint's default, in EMU. */
const SLIDE_CX = 12_192_000;
const SLIDE_CY = 6_858_000;
/** Half an inch around the page's text box. */
const TEXT_MARGIN = 457_200;

const GROUP_PROPS = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;
const EMPTY_SP_TREE = `<p:spTree>${GROUP_PROPS}</p:spTree>`;

/** A relationships part; ids are rId1… in the order given. */
function rels(entries: readonly (readonly [type: string, target: string])[]) {
  return `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries
    .map(
      ([type, target], i) =>
        `<Relationship Id="rId${i + 1}" Type="${OFFICE_REL}/${type}" Target="${target}"/>`,
    )
    .join("")}</Relationships>`;
}

/**
 * A complete theme: the colour, font and format schemes are all required, and
 * each format list needs at least three entries (ECMA-376 §20.1.4.1.14).
 */
const THEME_XML = (() => {
  const colour = (tag: string, hex: string) =>
    `<a:${tag}><a:srgbClr val="${hex}"/></a:${tag}>`;
  const font = (tag: string) =>
    `<a:${tag}><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:${tag}>`;
  const three = (tag: string, entry: string) =>
    `<a:${tag}>${entry.repeat(3)}</a:${tag}>`;
  const fill = `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`;
  return `${XML_DECL}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="pdf.xyz"><a:themeElements><a:clrScheme name="pdf.xyz">${colour("dk1", "000000")}${colour("lt1", "FFFFFF")}${colour("dk2", "44546A")}${colour("lt2", "E7E6E6")}${colour("accent1", "4472C4")}${colour("accent2", "ED7D31")}${colour("accent3", "A5A5A5")}${colour("accent4", "FFC000")}${colour("accent5", "5B9BD5")}${colour("accent6", "70AD47")}${colour("hlink", "0563C1")}${colour("folHlink", "954F72")}</a:clrScheme><a:fontScheme name="pdf.xyz">${font("majorFont")}${font("minorFont")}</a:fontScheme><a:fmtScheme name="pdf.xyz">${three("fillStyleLst", fill)}${three("lnStyleLst", `<a:ln w="6350">${fill}</a:ln>`)}${three("effectStyleLst", `<a:effectStyle><a:effectLst/></a:effectStyle>`)}${three("bgFillStyleLst", fill)}</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
})();

async function pptx(pages: ExtractedPdfText["pages"]): Promise<Uint8Array> {
  const zip = new JSZip();
  const slides = pages.map((page, i) => ({ n: i + 1, text: page.text }));
  zip.file(
    "[Content_Types].xml",
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[
      ["ppt/presentation.xml", `${PML_CT}.presentation.main+xml`],
      ["ppt/slideMasters/slideMaster1.xml", `${PML_CT}.slideMaster+xml`],
      ["ppt/slideLayouts/slideLayout1.xml", `${PML_CT}.slideLayout+xml`],
      ["ppt/theme/theme1.xml", `${OFFICE_CT}.theme+xml`],
      ...slides.map(({ n }) => [
        `ppt/slides/slide${n}.xml`,
        `${PML_CT}.slide+xml`,
      ]),
    ]
      .map(
        ([part, type]) =>
          `<Override PartName="/${part}" ContentType="${type}"/>`,
      )
      .join("")}</Types>`,
  );
  zip.file("_rels/.rels", rels([["officeDocument", "ppt/presentation.xml"]]));

  // presentation → master (rId1), theme (rId2), then one slide per page.
  zip.file(
    "ppt/presentation.xml",
    `${XML_DECL}<p:presentation ${PML_NS}><p:sldMasterIdLst><p:sldMasterId id="${MASTER_ID}" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides
      .map(({ n }) => `<p:sldId id="${255 + n}" r:id="rId${n + 2}"/>`)
      .join(
        "",
      )}</p:sldIdLst><p:sldSz cx="${SLIDE_CX}" cy="${SLIDE_CY}"/><p:notesSz cx="${SLIDE_CY}" cy="9144000"/></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    rels([
      ["slideMaster", "slideMasters/slideMaster1.xml"],
      ["theme", "theme/theme1.xml"],
      ...slides.map(({ n }): [string, string] => [
        "slide",
        `slides/slide${n}.xml`,
      ]),
    ]),
  );

  // One master, one blank layout, one theme: the chain PowerPoint walks before
  // it will show a slide. Neither the master nor the layout carries a shape,
  // so nothing appears on a slide except the page's own text box.
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `${XML_DECL}<p:sldMaster ${PML_NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${EMPTY_SP_TREE}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="${MASTER_ID + 1}" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    rels([
      ["slideLayout", "../slideLayouts/slideLayout1.xml"],
      ["theme", "../theme/theme1.xml"],
    ]),
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `${XML_DECL}<p:sldLayout ${PML_NS} type="blank" preserve="1"><p:cSld name="Blank">${EMPTY_SP_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    rels([["slideMaster", "../slideMasters/slideMaster1.xml"]]),
  );
  zip.file("ppt/theme/theme1.xml", THEME_XML);

  for (const { n, text } of slides) {
    // An a:txBody needs at least one a:p, so a page with no text still gets
    // an (empty) paragraph rather than an invalid, empty body. No run carries
    // a `lang`: the text can be in any language, and a wrong tag would have
    // PowerPoint spell-check Bengali as English.
    const paragraphs =
      lines(text)
        .map((l) => `<a:p><a:r><a:t>${esc(l)}</a:t></a:r></a:p>`)
        .join("") || `<a:p/>`;
    zip.file(
      `ppt/slides/slide${n}.xml`,
      `${XML_DECL}<p:sld ${PML_NS}><p:cSld><p:spTree>${GROUP_PROPS}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Page ${n} text"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${TEXT_MARGIN}" y="${TEXT_MARGIN}"/><a:ext cx="${SLIDE_CX - 2 * TEXT_MARGIN}" cy="${SLIDE_CY - 2 * TEXT_MARGIN}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    );
    zip.file(
      `ppt/slides/_rels/slide${n}.xml.rels`,
      rels([["slideLayout", "../slideLayouts/slideLayout1.xml"]]),
    );
  }
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

export async function runPdfOfficeExport(
  tool: PdfOfficeExportTool,
  input: Uint8Array,
  deps: PdfOfficeExportDeps,
): Promise<PdfOfficeExportRun> {
  if (!deps.extract)
    return {
      ok: false,
      kind: "unsupported",
      message:
        "PDF to Office export requires the PDF text extractor, which is not available in this environment.",
    };
  const maxInput = deps.limits?.maxInputBytes;
  if (maxInput !== undefined && input.byteLength > maxInput)
    return {
      ok: false,
      kind: "too_large",
      limitBytes: maxInput,
      message: "The PDF input exceeds the worker's size limit.",
    };
  try {
    const extracted = await deps.extract(input);
    if (!extracted.hasText || extracted.text.trim().length === 0)
      return {
        ok: false,
        kind: "no_text",
        message:
          "This PDF has no selectable text to export. Run OCR first, then try again.",
      };
    let output: Uint8Array;
    let filenameExt: "docx" | "xlsx" | "pptx";
    let contentType: string;
    if (tool === PDF_TO_WORD_TOOL) {
      output = await docx(extracted.text);
      filenameExt = "docx";
      contentType =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    } else if (tool === PDF_TO_EXCEL_TOOL) {
      output = await xlsx(extracted.text);
      filenameExt = "xlsx";
      contentType =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else {
      output = await pptx(extracted.pages);
      filenameExt = "pptx";
      contentType =
        "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    }
    const maxOutput = deps.limits?.maxOutputBytes;
    if (maxOutput !== undefined && output.byteLength > maxOutput)
      return {
        ok: false,
        kind: "failed",
        message: "The exported Office file exceeds the worker size limit.",
      };
    return {
      ok: true,
      output,
      filenameExt,
      contentType,
      meta: {
        engine: PDF_OFFICE_EXPORT_ENGINE,
        tool,
        pageCount: extracted.pageCount,
        inputBytes: input.byteLength,
        outputBytes: output.byteLength,
        characterCount: extracted.characterCount,
      },
    };
  } catch {
    return {
      ok: false,
      kind: "failed",
      message: "The PDF could not be exported to an Office file.",
    };
  }
}

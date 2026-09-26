/**
 * The PresentationML package PDF to PowerPoint writes: one slide per PDF page,
 * the page's lines in one text box.
 *
 * What shipped before 2026-09-27 was a `presentation.xml` listing slides and
 * nothing else — no slide master, layout or theme, no slide size, empty
 * `nvSpPr`/`nvGrpSpPr`, and a textless page's `txBody` with no paragraph.
 * PowerPoint refused every deck it produced as "corrupted and unreadable".
 * A deck needs the whole chain PowerPoint walks before it draws a slide:
 *
 *   presentation ─┬─ slideMaster ─┬─ slideLayout ←── every slide
 *                 │               └─ theme
 *                 └─ theme
 *
 * The master/layout/theme shapes follow the hand-built deck the
 * powerpoint-to-pdf proof converts (`src/tests/pptx-fixture.ts`), which
 * PowerPoint and LibreOffice both open; that deck stays an independent copy
 * because it is the positive control for the checker these decks are tested
 * with (`./validate-ooxml`).
 *
 * Every per-slide name — part, content-type override, relationship id, slide
 * id — keys on the slide's POSITION. The part used to be named after the page
 * number and everything pointing at it after the position.
 */
import JSZip from "jszip";
import { xmlEscape } from "../ooxml/sheet-cells";

const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const PML_CT = "application/vnd.openxmlformats-officedocument.presentationml";
const XML_DECL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
const NS = `xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"`;

/**
 * 16:9 at PowerPoint's default 13.333 × 7.5 in. Fixed, because the extractor
 * reports no page geometry; within `ST_SlideSizeCoordinate` (914400–51206400).
 */
export const SLIDE_WIDTH_EMU = 12_192_000;
export const SLIDE_HEIGHT_EMU = 6_858_000;
const EMU_PER_POINT = 12_700;
/** Half an inch of margin on every side. */
const MARGIN_EMU = 457_200;
const BOX_WIDTH_EMU = SLIDE_WIDTH_EMU - 2 * MARGIN_EMU;
const BOX_HEIGHT_EMU = SLIDE_HEIGHT_EMU - 2 * MARGIN_EMU;
/** Largest and smallest text size, in points. */
const MAX_FONT_PT = 24;
const MIN_FONT_PT = 6;
/** Single spacing in PowerPoint's default font runs ~1.2 × the size. */
const LINE_HEIGHT = 1.2;
/** A generous average glyph advance, as a fraction of the size. */
const GLYPH_WIDTH = 0.55;
/** `bodyPr`'s default insets: 0.1 in left and right, 0.05 in top and bottom. */
const INSET_X_EMU = 2 * 91_440;
const INSET_Y_EMU = 2 * 45_720;

export interface PptxSlide {
  /** Shown as the text box's name in PowerPoint's selection pane. */
  name: string;
  /** Paragraphs, one per line; empty for a page with no text. */
  lines: readonly string[];
}

/**
 * The largest size, in half-point steps, at which `lines` fit the text box —
 * wrapped lines counted — clamped to MIN_FONT_PT…MAX_FONT_PT. A full page of
 * `-layout` text at PowerPoint's default 18pt runs off the bottom of the slide.
 */
export function fittingFontSize(lines: readonly string[]): number {
  const width = (BOX_WIDTH_EMU - INSET_X_EMU) / EMU_PER_POINT;
  const height = (BOX_HEIGHT_EMU - INSET_Y_EMU) / EMU_PER_POINT;
  for (let half = MAX_FONT_PT * 2; half > MIN_FONT_PT * 2; half--) {
    const size = half / 2;
    const perLine = Math.max(1, Math.floor(width / (size * GLYPH_WIDTH)));
    const rows = lines.reduce(
      (n, line) => n + Math.max(1, Math.ceil(line.length / perLine)),
      0,
    );
    if (rows * size * LINE_HEIGHT <= height) return size;
  }
  return MIN_FONT_PT;
}

function slideXml(slide: PptxSlide): string {
  const sz = Math.round(fittingFontSize(slide.lines) * 100);
  // The schema needs at least one paragraph in every text body — a textless
  // page included, which used to get none.
  const paragraphs =
    slide.lines.length > 0
      ? slide.lines
          .map(
            (line) =>
              `<a:p><a:r><a:rPr sz="${sz}" dirty="0"/><a:t>${xmlEscape(line)}</a:t></a:r></a:p>`,
          )
          .join("")
      : `<a:p><a:endParaRPr sz="${sz}" dirty="0"/></a:p>`;
  return `${XML_DECL}<p:sld ${NS}><p:cSld><p:spTree>${groupProperties()}<p:sp><p:nvSpPr><p:cNvPr id="2" name="${xmlEscape(slide.name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${MARGIN_EMU}" y="${MARGIN_EMU}"/><a:ext cx="${BOX_WIDTH_EMU}" cy="${BOX_HEIGHT_EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

/** The shape tree's own required header: `nvGrpSpPr` then `grpSpPr`. */
function groupProperties(): string {
  return `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;
}

function relationships(
  rels: readonly { id: string; type: string; target: string }[],
): string {
  return `${XML_DECL}<Relationships xmlns="${PKG_REL}">${rels
    .map(
      (r) =>
        `<Relationship Id="${r.id}" Type="${R}/${r.type}" Target="${r.target}"/>`,
    )
    .join("")}</Relationships>`;
}

const CLR_MAP = `bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"`;

const MASTER_XML = `${XML_DECL}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${groupProperties()}</p:spTree></p:cSld><p:clrMap ${CLR_MAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;

const LAYOUT_XML = `${XML_DECL}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${groupProperties()}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

function themeXml(): string {
  const clr = (tag: string, hex: string) =>
    `<a:${tag}><a:srgbClr val="${hex}"/></a:${tag}>`;
  const font = (tag: string) =>
    `<a:${tag}><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:${tag}>`;
  const three = (tag: string, inner: string) =>
    `<a:${tag}>${inner.repeat(3)}</a:${tag}>`;
  const fill = `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`;
  return `${XML_DECL}<a:theme xmlns:a="${A}" name="pdf.xyz"><a:themeElements><a:clrScheme name="pdf.xyz">${clr("dk1", "000000")}${clr("lt1", "FFFFFF")}${clr("dk2", "1F2937")}${clr("lt2", "F3F4F6")}${clr("accent1", "4F81BD")}${clr("accent2", "C0504D")}${clr("accent3", "9BBB59")}${clr("accent4", "8064A2")}${clr("accent5", "4BACC6")}${clr("accent6", "F79646")}${clr("hlink", "0563C1")}${clr("folHlink", "954F72")}</a:clrScheme><a:fontScheme name="pdf.xyz">${font("majorFont")}${font("minorFont")}</a:fontScheme><a:fmtScheme name="pdf.xyz">${three("fillStyleLst", fill)}${three("lnStyleLst", `<a:ln w="9525">${fill}</a:ln>`)}${three("effectStyleLst", "<a:effectStyle><a:effectLst/></a:effectStyle>")}${three("bgFillStyleLst", fill)}</a:fmtScheme></a:themeElements></a:theme>`;
}

/** A PPTX PowerPoint opens: one slide per entry of `slides`, in order. */
export async function pptxPackage(
  slides: readonly PptxSlide[],
): Promise<Uint8Array> {
  const zip = new JSZip();
  const n = slides.length;
  const slideNumbers = slides.map((_, i) => i + 1);
  // Slides take rId1…rIdN; the master and theme the two ids after them.
  const masterRel = `rId${n + 1}`;
  const themeRel = `rId${n + 2}`;

  const override = (part: string, type: string) =>
    `<Override PartName="/${part}" ContentType="${type}"/>`;
  zip.file(
    "[Content_Types].xml",
    `${XML_DECL}<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${override("ppt/presentation.xml", `${PML_CT}.presentation.main+xml`)}${override("ppt/slideMasters/slideMaster1.xml", `${PML_CT}.slideMaster+xml`)}${override("ppt/slideLayouts/slideLayout1.xml", `${PML_CT}.slideLayout+xml`)}${override("ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml")}${slideNumbers
      .map((k) => override(`ppt/slides/slide${k}.xml`, `${PML_CT}.slide+xml`))
      .join("")}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    relationships([
      { id: "rId1", type: "officeDocument", target: "ppt/presentation.xml" },
    ]),
  );
  zip.file(
    "ppt/presentation.xml",
    `${XML_DECL}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="${masterRel}"/></p:sldMasterIdLst><p:sldIdLst>${slideNumbers
      .map((k) => `<p:sldId id="${255 + k}" r:id="rId${k}"/>`)
      .join(
        "",
      )}</p:sldIdLst><p:sldSz cx="${SLIDE_WIDTH_EMU}" cy="${SLIDE_HEIGHT_EMU}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    relationships([
      ...slideNumbers.map((k) => ({
        id: `rId${k}`,
        type: "slide",
        target: `slides/slide${k}.xml`,
      })),
      {
        id: masterRel,
        type: "slideMaster",
        target: "slideMasters/slideMaster1.xml",
      },
      { id: themeRel, type: "theme", target: "theme/theme1.xml" },
    ]),
  );
  zip.file("ppt/slideMasters/slideMaster1.xml", MASTER_XML);
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    relationships([
      {
        id: "rId1",
        type: "slideLayout",
        target: "../slideLayouts/slideLayout1.xml",
      },
      { id: "rId2", type: "theme", target: "../theme/theme1.xml" },
    ]),
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", LAYOUT_XML);
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    relationships([
      {
        id: "rId1",
        type: "slideMaster",
        target: "../slideMasters/slideMaster1.xml",
      },
    ]),
  );
  zip.file("ppt/theme/theme1.xml", themeXml());
  slides.forEach((slide, i) => {
    const k = i + 1;
    zip.file(`ppt/slides/slide${k}.xml`, slideXml(slide));
    zip.file(
      `ppt/slides/_rels/slide${k}.xml.rels`,
      relationships([
        {
          id: "rId1",
          type: "slideLayout",
          target: "../slideLayouts/slideLayout1.xml",
        },
      ]),
    );
  });
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

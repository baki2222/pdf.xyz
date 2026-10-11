/**
 * The PresentationML package PDF to PowerPoint writes: one slide per PDF page,
 * each holding that page's pictures and text boxes, in the page's paint order.
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
 * From 2026-09-27 to 2026-10-10 each slide held ONE text box of the page's
 * `pdftotext -layout` lines on a fixed 16:9 slide, and no pictures (vendored
 * as `src/tests/pptx-text-only-2026-10-10.ts`, the fidelity instrument's
 * negative control). Since 2026-10-10 a slide is a list of shapes: pictures
 * (`p:pic`, each its own media part, deduplicated by key) and positioned text
 * boxes (`p:sp`, one per line, with the line's font, size and colour). The
 * slide size is the deck's, chosen by the caller (`./deck-from-scan`).
 *
 * The master/layout/theme shapes follow the hand-built deck the
 * powerpoint-to-pdf proof converts (`src/tests/pptx-fixture.ts`), which
 * PowerPoint and LibreOffice both open; that deck stays an independent copy
 * because it is the positive control for the checker these decks are tested
 * with (`./validate-ooxml`). A second checker, `./pptx-inspect`, reads every
 * deck this writes before the engine delivers it — pictures included: the
 * blip's relationship, its type and the media part's content type.
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

/** `ST_SlideSizeCoordinate`: PowerPoint refuses a slide size outside this. */
export const SLIDE_SIZE_MIN_EMU = 914_400;
export const SLIDE_SIZE_MAX_EMU = 51_206_400;
export const EMU_PER_POINT = 12_700;

/** The media types a picture may carry, by file extension. */
export const MEDIA_CONTENT_TYPES = {
  png: "image/png",
  jpeg: "image/jpeg",
} as const;
export type MediaExt = keyof typeof MEDIA_CONTENT_TYPES;

/** Position and size in EMU; rotation clockwise in 60,000ths of a degree. */
export interface Xfrm {
  x: number;
  y: number;
  cx: number;
  cy: number;
  rot?: number;
  flipH?: boolean;
  flipV?: boolean;
}

export interface PptxMedia {
  /** Identical keys share one media part. */
  key: string;
  bytes: Uint8Array;
  ext: MediaExt;
}

export interface PptxPicture {
  kind: "picture";
  name: string;
  /** Alternative text, read by screen readers. */
  descr?: string;
  media: PptxMedia;
  xfrm: Xfrm;
  /** srcRect, in 1/1000ths of a percent cut from each side. */
  crop?: { l: number; t: number; r: number; b: number };
}

export interface PptxRun {
  text: string;
  /** Typeface for latin, east-Asian and complex scripts alike. */
  typeface: string;
  /** DrawingML pitchFamily: 18 serif, 34 sans, 49 monospace. */
  pitchFamily: number;
  /** Hundredths of a point, 100–400000. */
  sz: number;
  bold: boolean;
  italic: boolean;
  /** "RRGGBB"; null leaves the theme's text colour. */
  color: string | null;
  /** 0–100000. */
  alpha?: number;
  /** Spacing added after each character, in hundredths of a point. */
  spc?: number;
  /** Text kept and selectable, drawn with no fill (an OCR layer). */
  invisible?: boolean;
}

export interface PptxTextBox {
  kind: "text";
  name: string;
  xfrm: Xfrm;
  /** One paragraph per line; the box is sized to its text, not wrapped. */
  paragraphs: PptxRun[][];
}

export type PptxShape = PptxPicture | PptxTextBox;

export interface PptxSlide {
  /** Shown in PowerPoint's selection pane as the slide's first shape names. */
  name: string;
  /** Bottom first: the order the page painted them. */
  shapes: readonly PptxShape[];
}

export interface PptxDeck {
  /** Slide size in EMU, within `ST_SlideSizeCoordinate`. */
  width: number;
  height: number;
  slides: readonly PptxSlide[];
}

const int = (v: number) => Math.round(v);

function xfrmXml(x: Xfrm): string {
  const attrs = [
    x.rot ? ` rot="${int(x.rot)}"` : "",
    x.flipH ? ` flipH="1"` : "",
    x.flipV ? ` flipV="1"` : "",
  ].join("");
  return `<a:xfrm${attrs}><a:off x="${int(x.x)}" y="${int(x.y)}"/><a:ext cx="${Math.max(1, int(x.cx))}" cy="${Math.max(1, int(x.cy))}"/></a:xfrm>`;
}

function runXml(run: PptxRun): string {
  const fill = run.invisible
    ? "<a:noFill/>"
    : run.color
      ? `<a:solidFill><a:srgbClr val="${run.color}">${
          run.alpha !== undefined && run.alpha < 100_000
            ? `<a:alpha val="${int(run.alpha)}"/>`
            : ""
        }</a:srgbClr></a:solidFill>`
      : "";
  const face = xmlEscape(run.typeface);
  const font = `<a:latin typeface="${face}" pitchFamily="${run.pitchFamily}" charset="0"/><a:ea typeface="${face}"/><a:cs typeface="${face}"/>`;
  const spc = run.spc ? ` spc="${int(run.spc)}"` : "";
  return `<a:r><a:rPr lang="en-US" sz="${int(run.sz)}" b="${run.bold ? 1 : 0}" i="${run.italic ? 1 : 0}"${spc} dirty="0">${fill}${font}</a:rPr><a:t>${xmlEscape(run.text)}</a:t></a:r>`;
}

function textBoxXml(box: PptxTextBox, id: number): string {
  // The schema needs at least one paragraph in every text body.
  const paragraphs =
    box.paragraphs.length > 0
      ? box.paragraphs
          .map(
            (runs) =>
              `<a:p>${runs.map(runXml).join("")}<a:endParaRPr lang="en-US" sz="${int(runs[0]?.sz ?? 1800)}" dirty="0"/></a:p>`,
          )
          .join("")
      : `<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlEscape(box.name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrmXml(box.xfrm)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"><a:spAutoFit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function pictureXml(pic: PptxPicture, id: number, rel: string): string {
  const crop = pic.crop
    ? `<a:srcRect l="${int(pic.crop.l)}" t="${int(pic.crop.t)}" r="${int(pic.crop.r)}" b="${int(pic.crop.b)}"/>`
    : "";
  const descr = pic.descr ? ` descr="${xmlEscape(pic.descr)}"` : "";
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${xmlEscape(pic.name)}"${descr}/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rel}"/>${crop}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrmXml(pic.xfrm)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
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

/** A PPTX PowerPoint opens: one slide per entry of `deck.slides`, in order. */
export async function pptxPackage(deck: PptxDeck): Promise<Uint8Array> {
  const zip = new JSZip();
  const slides = deck.slides;
  const n = slides.length;
  const slideNumbers = slides.map((_, i) => i + 1);
  // Slides take rId1…rIdN; the master and theme the two ids after them.
  const masterRel = `rId${n + 1}`;
  const themeRel = `rId${n + 2}`;

  // Media parts, one per distinct key, named by first use.
  const mediaName = new Map<string, string>();
  const usedExts = new Set<MediaExt>();
  for (const slide of slides)
    for (const shape of slide.shapes) {
      if (shape.kind !== "picture" || mediaName.has(shape.media.key)) continue;
      const name = `image${mediaName.size + 1}.${shape.media.ext}`;
      mediaName.set(shape.media.key, name);
      usedExts.add(shape.media.ext);
      // Already compressed (JPEG, PNG): stored, not deflated a second time.
      zip.file(`ppt/media/${name}`, shape.media.bytes, {
        compression: "STORE",
      });
    }

  const override = (part: string, type: string) =>
    `<Override PartName="/${part}" ContentType="${type}"/>`;
  zip.file(
    "[Content_Types].xml",
    `${XML_DECL}<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[
      ...usedExts,
    ]
      .sort()
      .map(
        (ext) =>
          `<Default Extension="${ext}" ContentType="${MEDIA_CONTENT_TYPES[ext]}"/>`,
      )
      .join(
        "",
      )}${override("ppt/presentation.xml", `${PML_CT}.presentation.main+xml`)}${override("ppt/slideMasters/slideMaster1.xml", `${PML_CT}.slideMaster+xml`)}${override("ppt/slideLayouts/slideLayout1.xml", `${PML_CT}.slideLayout+xml`)}${override("ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml")}${slideNumbers
      .map((k) => override(`ppt/slides/slide${k}.xml`, `${PML_CT}.slide+xml`))
      .join("")}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    relationships([
      { id: "rId1", type: "officeDocument", target: "ppt/presentation.xml" },
    ]),
  );
  const clamp = (v: number) =>
    Math.min(SLIDE_SIZE_MAX_EMU, Math.max(SLIDE_SIZE_MIN_EMU, int(v)));
  zip.file(
    "ppt/presentation.xml",
    `${XML_DECL}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="${masterRel}"/></p:sldMasterIdLst><p:sldIdLst>${slideNumbers
      .map((k) => `<p:sldId id="${255 + k}" r:id="rId${k}"/>`)
      .join(
        "",
      )}</p:sldIdLst><p:sldSz cx="${clamp(deck.width)}" cy="${clamp(deck.height)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
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
    // rId1 is the layout; each distinct picture on the slide takes the next.
    const rels = [
      {
        id: "rId1",
        type: "slideLayout",
        target: "../slideLayouts/slideLayout1.xml",
      },
    ];
    const relFor = new Map<string, string>();
    let id = 1;
    const shapes = slide.shapes
      .map((shape) => {
        id += 1;
        if (shape.kind === "text") return textBoxXml(shape, id);
        let rel = relFor.get(shape.media.key);
        if (!rel) {
          rel = `rId${rels.length + 1}`;
          relFor.set(shape.media.key, rel);
          rels.push({
            id: rel,
            type: "image",
            target: `../media/${mediaName.get(shape.media.key)!}`,
          });
        }
        return pictureXml(shape, id, rel);
      })
      .join("");
    zip.file(
      `ppt/slides/slide${k}.xml`,
      `${XML_DECL}<p:sld ${NS}><p:cSld name="${xmlEscape(slide.name)}"><p:spTree>${groupProperties()}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    );
    zip.file(`ppt/slides/_rels/slide${k}.xml.rels`, relationships(rels));
  });
  return new Uint8Array(
    await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
  );
}

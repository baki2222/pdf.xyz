/**
 * Write a {@link DocxDocument} as a .docx: the body's paragraphs and
 * pictures in order, a page break between PDF pages that put anything in
 * the document, each picture's file once however often it is shown, and a
 * section whose page is the one `./docx-layout` chose (`docxPageOf`).
 *
 * ── WHAT A PICTURE IS IN THE FILE ───────────────────────────────────────────
 *
 * A paragraph of its own holding one INLINE picture (`wp:inline`), at its
 * extent (`wp:extent`, EMU), showing its media part (`a:blip`), with the part
 * of the media the page cuts away cut here too (`a:srcRect`) and a turn or a
 * flip on its shape (`a:xfrm`). Inline, not anchored: an inline picture flows
 * with the text it was placed among, which is the order this export
 * promises; an anchored one sits at a position on a Word page, and Word's
 * pages are not the PDF's. A plain JPEG the page reader copied byte for byte
 * goes in as that JPEG; anything else is the PNG it wrote.
 *
 * ── WHAT A WORD IS IN THE FILE (since 2026-11-15) ───────────────────────────
 *
 * Each paragraph is written as runs (`w:r`), one per stretch of words in one
 * formatting (`./docx-run-style`, coalesced by `./docx-layout`), each run's
 * `w:rPr` in the schema's order: `w:b` and `w:bCs` when bold, `w:i` and
 * `w:iCs` when italic, `w:color`, then `w:sz` and `w:szCs`. The
 * complex-script twins are ALWAYS written beside the plain ones, so Bengali
 * and Arabic text gets the weight and the size too (Word reads the `Cs`
 * property for those scripts). A word with no style has no `w:rPr` at all:
 * Word's default. A table row's cells are separated by a tab in a run of its
 * own. No typeface (`w:rFonts`), no paragraph properties (`w:pPr`), and no
 * styles part: Word supplies its built-in defaults for a package without one.
 */
import JSZip from "jszip";
import { xmlEscape } from "../ooxml/sheet-cells";
import type {
  DocxDocument,
  DocxPictureBlock,
  DocxStyledRun,
  DocxTextBlock,
} from "./docx-layout";
import type { DocxRunStyle } from "./docx-run-style";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const XML_DECL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;

export const WORD_PAGE_BREAK = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
const EMU_PER_POINT = 12_700;
const TWIPS_PER_POINT = 20;

/** `w:rPr` for a style, children in `CT_RPr` order; "" for Word's default. */
function runProperties(style: DocxRunStyle | null): string {
  if (!style) return "";
  const props =
    (style.bold ? "<w:b/><w:bCs/>" : "") +
    (style.italic ? "<w:i/><w:iCs/>" : "") +
    (style.color ? `<w:color w:val="${style.color}"/>` : "") +
    (style.halfPoints !== undefined
      ? `<w:sz w:val="${style.halfPoints}"/><w:szCs w:val="${style.halfPoints}"/>`
      : "");
  return props ? `<w:rPr>${props}</w:rPr>` : "";
}

/** One run. The shared escape also drops what XML 1.0 cannot carry. */
const runXml = (run: DocxStyledRun) =>
  `<w:r>${runProperties(run.style)}<w:t xml:space="preserve">${xmlEscape(run.text)}</w:t></w:r>`;

/** One paragraph: a prose cell, or a table row whose cells are tab-separated. */
function textParagraph(block: DocxTextBlock): string {
  // Without poppler's words (a page built by hand) a cell is one run, in
  // the paragraph's own bold or italics (`paragraphStyle`), if any.
  const whole: DocxRunStyle | null =
    block.bold || block.italic
      ? {
          ...(block.bold ? { bold: true as const } : {}),
          ...(block.italic ? { italic: true as const } : {}),
        }
      : null;
  const cells = block.cells.map(
    (cell, c) => block.runs?.[c] ?? [{ text: cell, style: whole }],
  );
  return `<w:p>${cells
    .map((runs) => runs.map(runXml).join(""))
    .join("<w:r><w:tab/></w:r>")}</w:p>`;
}

const emu = (pt: number) => Math.max(1, Math.round(pt * EMU_PER_POINT));
/** A crop fraction in `a:srcRect`'s units: thousandths of a percent. */
const pct = (f: number) => Math.round(Math.min(1, Math.max(0, f)) * 100_000);

function pictureParagraph(
  pic: DocxPictureBlock,
  id: number,
  rel: string,
): string {
  const cx = emu(pic.width);
  const cy = emu(pic.height);
  const crop = pic.crop
    ? `<a:srcRect l="${pct(pic.crop.left)}" t="${pct(pic.crop.top)}" r="${pct(pic.crop.right)}" b="${pct(pic.crop.bottom)}"/>`
    : "";
  const xfrm = [
    pic.rotation ? ` rot="${Math.round(pic.rotation * 60_000)}"` : "",
    pic.flipH ? ` flipH="1"` : "",
    pic.flipV ? ` flipV="1"` : "",
  ].join("");
  const name = `Picture ${id}`;
  return (
    `<w:p><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${id}" name="${name}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic>` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rel}"/>${crop}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm${xfrm}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline>` +
    `</w:drawing></w:r></w:p>`
  );
}

/**
 * The most bytes one picture adds to the file BESIDES its media: its
 * paragraph and drawing (stored, not compressed), its relationship, its
 * media part's zip entries, and the page break a page with only that
 * picture brings. Measured 2026-10-17 on this writer at 1,122 bytes a
 * picture, cropped, each on a page of its own, 600 of them; a turn or a
 * flip adds tens of bytes, and four-digit ids a few more. PDF to Word's page
 * reader charges it per picture against the size budget, so the budget
 * bounds the FILE: `docx-pictures.test.ts` measures the real writer against
 * it, from both sides.
 */
export const DOCX_PICTURE_OVERHEAD_BYTES = 1_536;

/** What the writer put in the file, for the engine's check before delivery. */
export interface DocxPlan {
  pictures: number;
  mediaParts: number;
  pageBreaks: number;
}

/** The .docx for `doc`, and what it holds. */
export async function docxPackage(
  doc: DocxDocument,
): Promise<{ bytes: Uint8Array; plan: DocxPlan }> {
  const media = new Map<
    string,
    { part: string; rel: string; bytes: Uint8Array }
  >();
  let pictures = 0;
  const pageXml = doc.pages
    .filter((blocks) => blocks.length > 0)
    .map((blocks) =>
      blocks
        .map((block) => {
          if (block.kind === "text") return textParagraph(block);
          let part = media.get(block.media.key);
          if (!part) {
            const n = media.size + 1;
            part = {
              part: `media/image${n}.${block.media.ext}`,
              rel: `rIdImage${n}`,
              bytes: block.media.bytes,
            };
            media.set(block.media.key, part);
          }
          pictures += 1;
          return pictureParagraph(block, pictures, part.rel);
        })
        .join(""),
    );
  const twips = (pt: number) => Math.round(pt * TWIPS_PER_POINT);
  const { page } = doc;
  const margin = twips(page.margin);
  const sect =
    `<w:sectPr><w:pgSz w:w="${twips(page.width)}" w:h="${twips(page.height)}"` +
    `${page.width > page.height ? ` w:orient="landscape"` : ""}/>` +
    `<w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="${Math.round(margin / 2)}" w:footer="${Math.round(margin / 2)}" w:gutter="0"/>` +
    `</w:sectPr>`;
  const exts = [
    ...new Set([...media.values()].map((m) => m.part.split(".").pop()!)),
  ];
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `${XML_DECL}<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${exts
      .map(
        (ext) =>
          `<Default Extension="${ext}" ContentType="image/${ext === "jpeg" ? "jpeg" : "png"}"/>`,
      )
      .join(
        "",
      )}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `${XML_DECL}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `${XML_DECL}<Relationships xmlns="${PKG_REL}">${[...media.values()]
      .map(
        (m) =>
          `<Relationship Id="${m.rel}" Type="${R}/image" Target="${m.part}"/>`,
      )
      .join("")}</Relationships>`,
  );
  for (const m of media.values()) zip.file(`word/${m.part}`, m.bytes);
  zip.file(
    "word/document.xml",
    `${XML_DECL}<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}"><w:body>${pageXml.join(WORD_PAGE_BREAK)}${sect}</w:body></w:document>`,
  );
  return {
    bytes: new Uint8Array(await zip.generateAsync({ type: "uint8array" })),
    plan: {
      pictures,
      mediaParts: media.size,
      pageBreaks: Math.max(0, pageXml.length - 1),
    },
  };
}

/**
 * A .docx built BY HAND from a fixture's own record of what it draws — for
 * the Word picture instrument's positive control, and the mutations its
 * controls are made of.
 *
 * It shares nothing with the engine's writer: its XML is written here, its
 * pictures are the fixture's own pixels (the PNG encoder and the JPEG bytes
 * the fixture drew with), placed in the order the fixture's `sequence` says,
 * at the size the page shows them, scaled down only as far as the page's
 * text area needs. So an instrument that passes it was not taught to pass
 * by the code it judges, and every mutation below starts from a file the
 * instrument is known to pass.
 */
import JSZip from "jszip";
import { encodePngImage } from "@/lib/workers/pdf-office-export/png-encode";
import { xmlEscape } from "@/lib/workers/ooxml/sheet-cells";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";

export interface HandPicture {
  /** The picture file: PNG or JPEG bytes. */
  bytes: Uint8Array;
  ext: "png" | "jpeg";
  /** Where the page shows it, points. */
  width: number;
  height: number;
}

export interface HandDocx {
  /** The page, points; margins are an inch. */
  page: { width: number; height: number };
  /** Per page: text paragraphs, or a picture by its index in `pictures`. */
  pages: (string | { picture: number })[][];
  pictures: HandPicture[];
}

/** PNG bytes for an RGB or grey sample array. */
export const handPng = (
  width: number,
  height: number,
  layout: "rgb8" | "gray8",
  samples: Uint8Array,
) => encodePngImage(width, height, layout, samples);

/** Build the .docx `spec` describes. */
export async function handBuiltDocx(spec: HandDocx): Promise<Uint8Array> {
  const margin = 72;
  const textW = spec.page.width - 2 * margin;
  const textH = spec.page.height - 2 * margin;
  const emu = (pt: number) => Math.round(pt * 12_700);
  let id = 0;
  const drawing = (n: number) => {
    const p = spec.pictures[n]!;
    const s = Math.min(1, textW / p.width, textH / p.height);
    const cx = emu(p.width * s);
    const cy = emu(p.height * s);
    id += 1;
    return `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Hand ${id}"/><a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Hand ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg${n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  };
  const body = spec.pages
    .map((page) =>
      page
        .map((block) =>
          typeof block === "string"
            ? `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(block)}</w:t></w:r></w:p>`
            : drawing(block.picture),
        )
        .join(""),
    )
    .join(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);
  const twips = (pt: number) => Math.round(pt * 20);
  const sect = `<w:sectPr><w:pgSz w:w="${twips(spec.page.width)}" w:h="${twips(spec.page.height)}"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${spec.pictures
      .map(
        (p, n) =>
          `<Relationship Id="rIdImg${n}" Type="${R}/image" Target="media/hand${n}.${p.ext}"/>`,
      )
      .join("")}</Relationships>`,
  );
  spec.pictures.forEach((p, n) =>
    zip.file(`word/media/hand${n}.${p.ext}`, p.bytes),
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}"><w:body>${body}${sect}</w:body></w:document>`,
  );
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

/* ------------------------------------------------------------------ *
 *  Mutations: each a defect the instrument must see
 * ------------------------------------------------------------------ */

async function editDocument(
  docx: Uint8Array,
  edit: (xml: string, zip: JSZip) => string | Promise<string>,
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(docx);
  const xml = await zip.file("word/document.xml")!.async("string");
  const next = await edit(xml, zip);
  if (next === xml) throw new Error("the mutation changed nothing");
  zip.file("word/document.xml", next);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

/** Every top-level body paragraph, in order, as XML (and the section). */
function bodyParagraphs(xml: string): {
  head: string;
  ps: string[];
  tail: string;
} {
  const open = xml.indexOf("<w:body>") + "<w:body>".length;
  const close = xml.lastIndexOf("<w:sectPr");
  const ps = xml.slice(open, close).match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) ?? [];
  return { head: xml.slice(0, open), ps, tail: xml.slice(close) };
}
const isPicture = (p: string) => p.includes("<w:drawing>");

/** The first two pictures' media swapped: right place, wrong pixels. */
export function swapFirstTwoPictures(docx: Uint8Array): Promise<Uint8Array> {
  return editDocument(docx, (xml) => {
    const embeds = [...xml.matchAll(/r:embed="([^"]+)"/g)].map((m) => m[1]!);
    if (new Set(embeds).size < 2)
      throw new Error("fewer than two pictures to swap");
    const [a, b] = [embeds[0]!, embeds.find((e) => e !== embeds[0])!];
    return xml
      .replaceAll(`r:embed="${a}"`, "r:embed=@@SWAP@@")
      .replaceAll(`r:embed="${b}"`, `r:embed="${a}"`)
      .replaceAll("r:embed=@@SWAP@@", `r:embed="${b}"`);
  });
}

/** The `n`-th picture's paragraph removed. */
export function dropPicture(docx: Uint8Array, n = 0): Promise<Uint8Array> {
  return editDocument(docx, (xml) => {
    const { head, ps, tail } = bodyParagraphs(xml);
    const at = ps.map((p, i) => (isPicture(p) ? i : -1)).filter((i) => i >= 0)[
      n
    ];
    if (at === undefined) throw new Error(`no picture ${n} to drop`);
    ps.splice(at, 1);
    return head + ps.join("") + tail;
  });
}

/** The first picture's paragraph moved after the next text paragraph. */
export function movePictureDown(docx: Uint8Array): Promise<Uint8Array> {
  return editDocument(docx, (xml) => {
    const { head, ps, tail } = bodyParagraphs(xml);
    const at = ps.findIndex(isPicture);
    const next = ps.findIndex(
      (p, i) => i > at && !isPicture(p) && /<w:t\b/.test(p),
    );
    if (at < 0 || next < 0) throw new Error("no picture with text after it");
    const [picture] = ps.splice(at, 1);
    ps.splice(next, 0, picture!);
    return head + ps.join("") + tail;
  });
}

/** The first picture's extent made 10% wider. */
export function stretchFirstPicture(docx: Uint8Array): Promise<Uint8Array> {
  return editDocument(docx, (xml) => {
    let done = 0;
    return xml
      .replace(/<wp:extent cx="(\d+)"/, (_, cx: string) => {
        done += 1;
        return `<wp:extent cx="${Math.round(Number(cx) * 1.1)}"`;
      })
      .replace(/(<a:ext cx=")(\d+)"/, (m, pre: string, cx: string) =>
        done ? `${pre}${Math.round(Number(cx) * 1.1)}"` : m,
      );
  });
}

/**
 * The `n`-th picture shows `bytes` instead (same place, same extent): the
 * right picture's place holding the wrong pixels. Its media part is
 * rewritten in place, so every picture showing that part changes.
 */
export async function replacePictureMedia(
  docx: Uint8Array,
  n: number,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(docx);
  const xml = await zip.file("word/document.xml")!.async("string");
  const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
  const embed = [...xml.matchAll(/r:embed="([^"]+)"/g)][n]?.[1];
  const target = embed
    ? new RegExp(`Id="${embed}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
    : undefined;
  if (!target) throw new Error(`no picture ${n} to replace`);
  zip.file(`word/${target}`, bytes);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

/** The first picture's paragraph moved above the text paragraph before it. */
export function movePictureUp(docx: Uint8Array): Promise<Uint8Array> {
  return editDocument(docx, (xml) => {
    const { head, ps, tail } = bodyParagraphs(xml);
    const at = ps.findIndex(isPicture);
    let before = -1;
    for (let i = at - 1; i >= 0; i--)
      if (!isPicture(ps[i]!) && /<w:t\b/.test(ps[i]!)) {
        before = i;
        break;
      }
    if (at < 0 || before < 0) throw new Error("no picture with text before it");
    const [picture] = ps.splice(at, 1);
    ps.splice(before, 0, picture!);
    return head + ps.join("") + tail;
  });
}

/**
 * Read a .pptx back the way a presentation app lays it out: the slide size,
 * and on each slide every picture and text box with its position, in the
 * order they are stacked — for tests that ask WHERE things landed.
 *
 * It shares nothing with the writer (`pdf-office-export/pptx-package.ts`):
 * it follows the package's own relationships from `_rels/.rels`, parses with
 * a real XML parser, and decodes the media part's pixel size from its own
 * header (PNG IHDR, JPEG SOF), so a writer that wrote the wrong picture, or
 * the right picture under the wrong relationship, is read as it is.
 */
import JSZip from "jszip";
import { parseXml } from "./xml-well-formed";

const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const EMU_PER_PT = 12_700;

export interface DeckBox {
  /** Points, from the slide's top-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Clockwise degrees. */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export interface DeckPicture extends DeckBox {
  kind: "picture";
  /** Position in the slide's shape tree: 0 is the bottom. */
  z: number;
  /** The media part the blip's relationship resolves to. */
  part: string;
  contentType: string | undefined;
  bytes: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
  /** PNG colour type 4 or 6 (grey + alpha, RGBA). */
  alpha: boolean;
  /** srcRect, as fractions cut from each side. */
  crop: { left: number; top: number; right: number; bottom: number } | null;
}

export interface DeckRun {
  text: string;
  /** Points. */
  size: number | null;
  bold: boolean;
  italic: boolean;
  color: string | null;
  invisible: boolean;
  typeface: string | null;
}

export interface DeckText extends DeckBox {
  kind: "text";
  z: number;
  runs: DeckRun[];
  text: string;
}

export interface DeckSlide {
  pictures: DeckPicture[];
  texts: DeckText[];
}

export interface Deck {
  /** Points. */
  width: number;
  height: number;
  slides: DeckSlide[];
}

function dirOf(part: string): string {
  const i = part.lastIndexOf("/");
  return i < 0 ? "" : part.slice(0, i);
}
function resolve(fromDir: string, target: string): string {
  const out = target.startsWith("/") ? [] : fromDir.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}
function relsOf(part: string): string {
  const dir = dirOf(part);
  const base = part.slice(dir ? dir.length + 1 : 0);
  return `${dir ? `${dir}/` : ""}_rels/${base}.rels`;
}

async function rels(
  zip: JSZip,
  part: string,
): Promise<Map<string, { type: string; target: string }>> {
  const file = zip.file(relsOf(part));
  const map = new Map<string, { type: string; target: string }>();
  if (!file) return map;
  const doc = parseXml(await file.async("string"));
  for (const r of Array.from(doc.getElementsByTagName("Relationship")))
    map.set(r.getAttribute("Id") ?? "", {
      type: (r.getAttribute("Type") ?? "").split("/").pop() ?? "",
      target: resolve(dirOf(part), r.getAttribute("Target") ?? ""),
    });
  return map;
}

/** Pixel size and alpha from the image's own header. */
export function imageHeader(
  bytes: Uint8Array,
): {
  width: number;
  height: number;
  alpha: boolean;
  format: "png" | "jpeg";
} | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const colorType = bytes[25]!;
    return {
      width: v.getUint32(16),
      height: v.getUint32(20),
      alpha: colorType === 4 || colorType === 6,
      format: "png",
    };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let p = 2;
    while (p + 9 < bytes.length && bytes[p] === 0xff) {
      const marker = bytes[p + 1]!;
      const len = (bytes[p + 2]! << 8) | bytes[p + 3]!;
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      )
        return {
          height: (bytes[p + 5]! << 8) | bytes[p + 6]!,
          width: (bytes[p + 7]! << 8) | bytes[p + 8]!,
          alpha: false,
          format: "jpeg",
        };
      p += 2 + len;
    }
  }
  return null;
}

const child = (el: Element, ns: string, local: string) =>
  Array.from(el.children).find(
    (c) => c.namespaceURI === ns && c.localName === local,
  );
const num = (el: Element | undefined, name: string, fallback = 0) => {
  const v = el?.getAttribute(name);
  return v === null || v === undefined ? fallback : Number(v);
};

function boxOf(spPr: Element | undefined): DeckBox {
  const xfrm = spPr ? child(spPr, A, "xfrm") : undefined;
  const off = xfrm ? child(xfrm, A, "off") : undefined;
  const ext = xfrm ? child(xfrm, A, "ext") : undefined;
  return {
    x: num(off, "x") / EMU_PER_PT,
    y: num(off, "y") / EMU_PER_PT,
    width: num(ext, "cx") / EMU_PER_PT,
    height: num(ext, "cy") / EMU_PER_PT,
    rotation: num(xfrm, "rot") / 60_000,
    flipH: xfrm?.getAttribute("flipH") === "1",
    flipV: xfrm?.getAttribute("flipV") === "1",
  };
}

/** Read every slide, in presentation order. */
export async function readDeck(bytes: Uint8Array): Promise<Deck> {
  const zip = await JSZip.loadAsync(bytes);
  const types = parseXml(
    await zip.file("[Content_Types].xml")!.async("string"),
  );
  const defaults = new Map(
    Array.from(types.getElementsByTagName("Default")).map((d) => [
      (d.getAttribute("Extension") ?? "").toLowerCase(),
      d.getAttribute("ContentType") ?? "",
    ]),
  );
  const overrides = new Map(
    Array.from(types.getElementsByTagName("Override")).map((o) => [
      (o.getAttribute("PartName") ?? "").replace(/^\//, ""),
      o.getAttribute("ContentType") ?? "",
    ]),
  );
  const contentType = (part: string) =>
    overrides.get(part) ??
    defaults.get(/\.([^./]+)$/.exec(part)?.[1]?.toLowerCase() ?? "");

  const root = await rels(zip, "");
  const presPart = [...root.values()].find(
    (r) => r.type === "officeDocument",
  )!.target;
  const pres = parseXml(await zip.file(presPart)!.async("string"));
  const sldSz = pres.getElementsByTagNameNS(P, "sldSz")[0];
  const presRels = await rels(zip, presPart);
  const slides: DeckSlide[] = [];
  for (const sldId of Array.from(pres.getElementsByTagNameNS(P, "sldId"))) {
    const slidePart = presRels.get(sldId.getAttributeNS(R, "id") ?? "")!.target;
    const doc = parseXml(await zip.file(slidePart)!.async("string"));
    const slideRels = await rels(zip, slidePart);
    const tree = doc.getElementsByTagNameNS(P, "spTree")[0]!;
    const slide: DeckSlide = { pictures: [], texts: [] };
    let z = 0;
    for (const shape of Array.from(tree.children)) {
      if (shape.namespaceURI !== P) continue;
      if (shape.localName === "pic") {
        const blipFill = child(shape, P, "blipFill")!;
        const blip = child(blipFill, A, "blip")!;
        const rel = slideRels.get(blip.getAttributeNS(R, "embed") ?? "");
        const part = rel?.target ?? "";
        const mediaBytes =
          (await zip.file(part)?.async("uint8array")) ?? new Uint8Array();
        const header = imageHeader(mediaBytes);
        const src = child(blipFill, A, "srcRect");
        slide.pictures.push({
          kind: "picture",
          z: z++,
          ...boxOf(child(shape, P, "spPr")),
          part,
          contentType: contentType(part),
          bytes: mediaBytes,
          pixelWidth: header?.width ?? 0,
          pixelHeight: header?.height ?? 0,
          alpha: header?.alpha ?? false,
          crop: src
            ? {
                left: num(src, "l") / 100_000,
                top: num(src, "t") / 100_000,
                right: num(src, "r") / 100_000,
                bottom: num(src, "b") / 100_000,
              }
            : null,
        });
      } else if (shape.localName === "sp") {
        const body = child(shape, P, "txBody");
        const runs: DeckRun[] = [];
        for (const r of body
          ? Array.from(body.getElementsByTagNameNS(A, "r"))
          : []) {
          const rPr = child(r, A, "rPr");
          const fill = rPr ? child(rPr, A, "solidFill") : undefined;
          const clr = fill ? child(fill, A, "srgbClr") : undefined;
          const latin = rPr ? child(rPr, A, "latin") : undefined;
          runs.push({
            text: child(r, A, "t")?.textContent ?? "",
            size: rPr?.getAttribute("sz")
              ? Number(rPr.getAttribute("sz")) / 100
              : null,
            bold: rPr?.getAttribute("b") === "1",
            italic: rPr?.getAttribute("i") === "1",
            color: clr?.getAttribute("val") ?? null,
            invisible: !!(rPr && child(rPr, A, "noFill")),
            typeface: latin?.getAttribute("typeface") ?? null,
          });
        }
        slide.texts.push({
          kind: "text",
          z: z++,
          ...boxOf(child(shape, P, "spPr")),
          runs,
          text: runs.map((r) => r.text).join(""),
        });
      } else z++;
    }
    slides.push(slide);
  }
  return {
    width: num(sldSz, "cx") / EMU_PER_PT,
    height: num(sldSz, "cy") / EMU_PER_PT,
    slides,
  };
}

/** A page box mapped onto a slide: fitted inside, centred, aspect kept. */
export function onSlide(
  page: { width: number; height: number },
  deck: { width: number; height: number },
  r: { x: number; y: number; width: number; height: number },
) {
  const s = Math.min(deck.width / page.width, deck.height / page.height);
  const ox = (deck.width - page.width * s) / 2;
  const oy = (deck.height - page.height * s) / 2;
  return {
    x: ox + r.x * s,
    y: oy + r.y * s,
    width: r.width * s,
    height: r.height * s,
    scale: s,
  };
}

/** True when `outer` contains `inner`, give or take `slack` points. */
export function contains(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
  slack = 2,
): boolean {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.width <= outer.x + outer.width + slack &&
    inner.y + inner.height <= outer.y + outer.height + slack
  );
}

/**
 * Read a .docx's BODY the way Word lays it out — paragraphs in order, the
 * pictures among them with their extents, crops and media, the page breaks
 * between them, and the section's page — for the Word picture instrument
 * (`./docx-fidelity`), the engine's own check before delivery, the
 * deployment proof and the heartbeat probe.
 *
 * It reads the XML and the package's relationships, never the writer's
 * data: a wrong writer cannot be agreed with by its own inverse. It is not a
 * schema validator. It reads the shapes Word writes and this export writes —
 * `w:p` with runs, `w:drawing` holding `wp:inline` or `wp:anchor` — and not
 * text boxes, tables or fields; their text is read as if it were in the
 * paragraph that holds them.
 */
import JSZip from "jszip";

/** Twips (a twentieth of a point) and EMU (12,700 a point). */
export const EMU_PER_POINT = 12_700;
export const TWIPS_PER_POINT = 20;

/* ------------------------------------------------------------------ *
 *  The .docx, as Word reads its body
 * ------------------------------------------------------------------ */

export interface DocxBodyPicture {
  /** Order among the body's pictures. */
  index: number;
  /** Index of the paragraph that holds it, among the body's paragraphs. */
  paragraph: number;
  /** Page breaks before it in the body. */
  segment: number;
  /** `wp:anchor` (positioned) rather than `wp:inline`. */
  anchored: boolean;
  /** Its extent, points. */
  width: number;
  height: number;
  /** Fractions of the image cut from each side (`a:srcRect`), or none. */
  crop: { left: number; top: number; right: number; bottom: number } | null;
  /** Clockwise, degrees; 0 when upright. */
  rotation: number;
  /** The media part it shows, and its bytes (null when it does not resolve). */
  part: string | null;
  bytes: Uint8Array | null;
}

export interface DocxBody {
  /** Every body paragraph's text, and the page segment it starts in. */
  paragraphs: { text: string; segment: number }[];
  pictures: DocxBodyPicture[];
  /** The section's page and text area, points; `declared` false = Word's defaults. */
  page: {
    width: number;
    height: number;
    textWidth: number;
    textHeight: number;
    declared: boolean;
  };
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
const decodeXml = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos);/g, (_, n: string) => XML_ENTITIES[n]!);

const attr = (xml: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(xml);
  return m ? m[1]! : null;
};
const num = (xml: string, name: string): number | null => {
  const v = attr(xml, name);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The relationship targets of `word/document.xml`, by id, as part names. */
function relationshipTargets(rels: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rel of rels.match(/<Relationship\b[^>]*>/g) ?? []) {
    const id = attr(rel, "Id");
    const target = attr(rel, "Target");
    if (!id || !target || attr(rel, "TargetMode") === "External") continue;
    out.set(
      id,
      target.startsWith("/")
        ? target.slice(1)
        : `word/${target.replace(/^\.\//, "")}`,
    );
  }
  return out;
}

/**
 * Read a .docx's body: its paragraphs' text, its pictures in order with
 * their extents, crops and media, and the section's page. Throws when the
 * file has no `word/document.xml`.
 */
export async function readDocxBody(bytes: Uint8Array): Promise<DocxBody> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (xml === undefined) throw new Error("the DOCX has no word/document.xml");
  const relsXml =
    (await zip.file("word/_rels/document.xml.rels")?.async("string")) ?? "";
  const targets = relationshipTargets(relsXml);

  const paragraphs: DocxBody["paragraphs"] = [];
  const pictures: DocxBodyPicture[] = [];
  let segment = 0;
  const TOKEN =
    /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\b[^>]*w:type="page"[^>]*\/>|<w:drawing>([\s\S]*?)<\/w:drawing>/g;
  for (const p of xml.matchAll(
    /<w:p\b[^>]*>([\s\S]*?)<\/w:p>|<w:p\b[^>]*\/>/g,
  )) {
    const body = p[1] ?? "";
    const index = paragraphs.length;
    const startSegment = segment;
    let text = "";
    for (const t of body.matchAll(TOKEN)) {
      if (t[0].startsWith("<w:tab")) text += "\t";
      else if (t[0].startsWith("<w:br")) segment += 1;
      else if (t[0].startsWith("<w:drawing")) {
        const d = t[2] ?? "";
        const extent = /<wp:extent\b[^>]*\/>/.exec(d)?.[0] ?? "";
        const cx = num(extent, "cx") ?? 0;
        const cy = num(extent, "cy") ?? 0;
        const embed = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(d)?.[1] ?? null;
        const src = /<a:srcRect\b[^>]*\/>/.exec(d)?.[0] ?? null;
        const xfrm = /<a:xfrm\b[^>]*>/.exec(d)?.[0] ?? "";
        const part = embed ? (targets.get(embed) ?? null) : null;
        const media = part
          ? await zip.file(part)?.async("uint8array")
          : undefined;
        const frac = (s: string, n: string) => (num(s, n) ?? 0) / 100_000;
        const crop = src
          ? {
              left: frac(src, "l"),
              top: frac(src, "t"),
              right: frac(src, "r"),
              bottom: frac(src, "b"),
            }
          : null;
        const rot = ((((num(xfrm, "rot") ?? 0) / 60_000) % 360) + 360) % 360;
        pictures.push({
          index: pictures.length,
          paragraph: index,
          segment,
          anchored: /<wp:anchor\b/.test(d),
          width: cx / EMU_PER_POINT,
          height: cy / EMU_PER_POINT,
          crop:
            crop && crop.left + crop.top + crop.right + crop.bottom > 0
              ? crop
              : null,
          rotation: Math.min(rot, 360 - rot) < 0.5 ? 0 : rot,
          part,
          bytes: media ?? null,
        });
      } else text += decodeXml(t[1] ?? "");
    }
    paragraphs.push({ text, segment: startSegment });
  }

  const sect = /<w:sectPr\b[^>]*>([\s\S]*?)<\/w:sectPr>\s*<\/w:body>/.exec(
    xml,
  )?.[1];
  const pgSz = sect ? (/<w:pgSz\b[^>]*\/>/.exec(sect)?.[0] ?? "") : "";
  const pgMar = sect ? (/<w:pgMar\b[^>]*\/>/.exec(sect)?.[0] ?? "") : "";
  const tw = (s: string, n: string, fallback: number) =>
    (num(s, n) ?? fallback) / TWIPS_PER_POINT;
  // Word's own defaults when the section names none: US Letter, 1" margins.
  const declared = pgSz !== "" && pgMar !== "";
  const width = tw(pgSz, "w:w", 12_240);
  const height = tw(pgSz, "w:h", 15_840);
  const left = tw(pgMar, "w:left", 1_440);
  const right = tw(pgMar, "w:right", 1_440);
  const top = tw(pgMar, "w:top", 1_440);
  const bottom = tw(pgMar, "w:bottom", 1_440);
  return {
    paragraphs,
    pictures,
    page: {
      width,
      height,
      textWidth: width - left - right,
      textHeight: height - top - bottom,
      declared,
    },
  };
}

/**
 * What the production proof (`scripts/worker-prove-tools.ts`) sends PDF to
 * PowerPoint, and how it judges the deck the DEPLOYED worker returns.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * The owner found the missing pictures in a production download. The proof
 * that ran against production until 2026-10-10 sent a text-only PDF and asked
 * whether the deck opens and carries the text — true of the deck with no
 * pictures, so it was green on exactly the defect. Its input now carries a
 * picture at a known place, and its verdict fails a deck whose slide does not
 * carry that picture, as a picture, there. The round trip beside it (the deck
 * back through the worker's own PowerPoint to PDF) is judged by the fidelity
 * instrument against the same source, instead of by its page count.
 *
 * `deployment-proof.test.ts` holds the verdict to its controls: it passes the
 * engine's deck, and fails the text-only deck, a deck whose picture moved, and
 * the package PowerPoint refused.
 */
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { decodePng } from "@/lib/png-probe";
import { encodePngImage } from "./png-encode";
import { pptxProofVerdict } from "./validate-ooxml";

/** The proof's words, read back off a slide. */
export const PPTX_PROOF_TEXT = "pdf.xyz deployment proof";

/** Its picture: pixel size, and where the page shows it (points, top-left). */
export const PPTX_PROOF_PICTURE = {
  pixelWidth: 64,
  pixelHeight: 40,
  x: 60,
  y: 120,
  width: 256,
  height: 160,
} as const;

/** Its three regions' colours: a band across the top, two halves below. */
const PROOF_COLOURS = {
  band: [40, 55, 90],
  left: [230, 120, 40],
  right: [60, 150, 200],
} as const;

const PAGE = { width: 595, height: 842 } as const;

/** One A4 page: the proof's line of text and its picture. Deterministic. */
export async function pptxProofPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, [PPTX_PROOF_TEXT]);
  const page = doc.addPage([PAGE.width, PAGE.height]);
  page.drawText(PPTX_PROOF_TEXT, { x: 60, y: 770, size: 20, font });
  const { pixelWidth: w, pixelHeight: h } = PPTX_PROOF_PICTURE;
  const pixels = new Uint8Array(w * h * 3);
  for (let p = 0; p < w * h; p++) {
    const x = p % w;
    const y = Math.floor(p / w);
    pixels.set(
      y < h / 4
        ? PROOF_COLOURS.band
        : x < w / 2
          ? PROOF_COLOURS.left
          : PROOF_COLOURS.right,
      p * 3,
    );
  }
  const picture = await embedRasterImage(
    doc,
    encodePngImage(w, h, "rgb8", pixels),
    "png",
  );
  const box = PPTX_PROOF_PICTURE;
  await drawRasterImage(page, picture, {
    x: box.x,
    y: PAGE.height - box.y - box.height,
    width: box.width,
    height: box.height,
  });
  return doc.save();
}

/** Within this many points of where the page shows it. */
const POINTS = 1;
const EMU_PER_POINT = 12_700;

/**
 * Is `png` the proof's picture: its pixel size, and its three regions'
 * colours (opaque, within 12 levels a channel) at each region's centre?
 */
function showsProofPicture(png: Uint8Array): boolean {
  try {
    const { width, height, data } = decodePng(png);
    const box = PPTX_PROOF_PICTURE;
    if (width !== box.pixelWidth || height !== box.pixelHeight) return false;
    const at = (x: number, y: number, want: readonly number[]) => {
      const i = (y * width + x) * 4;
      return (
        data[i + 3] === 255 &&
        want.every((c, k) => Math.abs(data[i + k]! - c) <= 12)
      );
    };
    const below = Math.floor((height * 5) / 8);
    return (
      at(Math.floor(width / 2), Math.floor(height / 8), PROOF_COLOURS.band) &&
      at(Math.floor(width / 4), below, PROOF_COLOURS.left) &&
      at(Math.floor((width * 3) / 4), below, PROOF_COLOURS.right)
    );
  } catch {
    return false;
  }
}

/**
 * The deployed deck, judged: the package readers (`pptxProofVerdict`: opens,
 * walks, carries the text) AND the picture — a `p:pic` on slide 1 at the
 * proof picture's box, whose image is the proof's picture: its pixel size
 * and, decoded, its three colours. The slide is the page's size, so page
 * points are slide points. Until 2026-10-11 only the size was read, and a
 * deployed engine writing every picture blank passed.
 */
export async function pptxDeploymentVerdict(
  bytes: Uint8Array,
): Promise<{ ok: boolean; detail: string }> {
  const structure = await pptxProofVerdict(bytes, PPTX_PROOF_TEXT);
  if (!structure.ok) return structure;
  const zip = await JSZip.loadAsync(bytes);
  const presentation = await zip.file("ppt/presentation.xml")?.async("string");
  const size = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(presentation ?? "");
  const want = [PAGE.width, PAGE.height].map((v) => v * EMU_PER_POINT);
  if (
    !size ||
    Math.abs(Number(size[1]) - want[0]!) > EMU_PER_POINT ||
    Math.abs(Number(size[2]) - want[1]!) > EMU_PER_POINT
  )
    return {
      ok: false,
      detail: `the slide is ${size ? `${Number(size[1]) / EMU_PER_POINT} × ${Number(size[2]) / EMU_PER_POINT} pt` : "of no size"}, not the page's ${PAGE.width} × ${PAGE.height}`,
    };
  const slide =
    (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
  const rels =
    (await zip.file("ppt/slides/_rels/slide1.xml.rels")?.async("string")) ?? "";
  const pictures = slide.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? [];
  const found: string[] = [];
  for (const pic of pictures) {
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(pic);
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(pic);
    const embed = /<a:blip r:embed="([^"]+)"/.exec(pic)?.[1];
    if (!off || !ext || !embed) continue;
    const at = [off[1], off[2], ext[1], ext[2]].map(
      (v) => Number(v) / EMU_PER_POINT,
    );
    found.push(at.map((v) => v.toFixed(1)).join(","));
    const box = PPTX_PROOF_PICTURE;
    const target = [box.x, box.y, box.width, box.height];
    if (at.some((v, i) => Math.abs(v - target[i]!) > POINTS)) continue;
    const rel = (rels.match(/<Relationship [^>]*>/g) ?? []).find((r) =>
      r.includes(`Id="${embed}"`),
    );
    const media = rel?.split('Target="../media/')[1]?.split('"')[0];
    const image = media
      ? await zip.file(`ppt/media/${media}`)?.async("uint8array")
      : undefined;
    if (!image || image[0] !== 0x89 || image[1] !== 0x50) continue;
    if (showsProofPicture(image))
      return {
        ok: true,
        detail: `${structure.detail}; the page's picture is on slide 1 where the page shows it, at ${box.pixelWidth} × ${box.pixelHeight} px, its colours decoded`,
      };
  }
  return {
    ok: false,
    detail: `slide 1 carries no picture at the page's ${PPTX_PROOF_PICTURE.width} × ${PPTX_PROOF_PICTURE.height} pt box showing its pixels (pictures at x,y,w,h: ${found.join(" | ") || "none"})`,
  };
}

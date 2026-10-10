/**
 * Does THIS worker image write a .pptx with the chain PowerPoint needs?
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * When this was written (2026-09-27) the web tier auto-deployed from `main`
 * and the worker image was built by hand. `publish.yml` now deploys both tiers
 * on every push to main, but merging is still not shipping: a publish can
 * fail (#167's did, on 2026-10-09) and leave production's worker behind main.
 * The fix that gave PDF to PowerPoint its slide master, layout and theme
 * changes nothing a user downloads until an image carrying it is running, and
 * nothing on the web tier could tell whether one is. The catalogue
 * promised "an editable PowerPoint slide" per page until 2026-10-09 (it now
 * says "its own slide in a .pptx file": nobody has edited one), so the
 * question is the 2026-08-21 one again (`translate/capability.ts`): does the
 * running image do what the copy says?
 *
 * ── WHAT IT RUNS ─────────────────────────────────────────────────────────────
 *
 * The real `runPdfOfficeExport`, the function the processor calls, then
 * `inspectPptxPackage` over the bytes it returned. It reads the engine's
 * OUTPUT, not the generator's source, so an engine that stopped writing a part
 * fails here however its code is arranged. Since 2026-10-09 the engine also
 * runs that inspector itself and refuses to deliver a deck that fails it, so
 * `false` here means the same thing whether the probe or the engine saw the
 * problem first.
 *
 * Until 2026-10-10 the input was a 4-byte stand-in and a synthetic three-page
 * extraction, which was all the engine read. Since then PDF to PowerPoint
 * reads the PAGES (`./page-scan`), and answers `unsupported` without that
 * reader, so the probe would have reported `false` on a healthy image. It now
 * generates a real three-page PDF (text, a blank page, text and a picture) and
 * runs it through the real page reader; only pdftotext, which the engine runs
 * to classify a refusal, is stood in for. An image without the page reader
 * publishes `false`.
 *
 * ── WHAT A PASS DOES AND DOES NOT MEAN ──────────────────────────────────────
 *
 * A pass means this image's engine writes the structural chain, one slide per
 * page, and every relationship in it resolves. It does NOT mean PowerPoint
 * opens the file; there is no PowerPoint on a Linux worker. That property was
 * measured on Windows with `scripts/prove-pptx-opens.ts`: on 2026-09-27 for
 * the writer of that day, and again on 2026-10-09 for the one that replaced it
 * (`./pptx-package`, behind the engine's delivery inspection). PowerPoint 16.0
 * build 20430 opened a real 3-page job as 3 slides with 1 master and read
 * every page's text back, reopened a deck it saved itself, and refused the
 * pre-fix package (0x80070570). The extractor on that host was Xpdf 4.00's
 * `pdftotext`, not the worker's poppler; the writer is the same either way.
 * The writer of 2026-10-10, with pictures, has been through the same COM open
 * (see the content docblock), not through a double-click.
 *
 * This probe says whether the running image's engine writes decks that pass
 * the inspection the measured one passed. It cannot tell two such writers
 * apart, and the name, `pptxPresentationChain`, promises no more than that.
 * Whether the deck carries the page's PICTURES is `provesPptxPictures`, a
 * separate key with a separate promise.
 *
 * An image built before this module publishes no such key, the reader parses
 * the absence as `false`, and the old image does not have to cooperate.
 */

import { PDFDocument } from "pdf-lib";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { runPdfOfficeExport } from "./engine";
import { scanPdfPages, type PdfPageScanner } from "./page-scan";
import { inspectPptxPackage } from "./pptx-inspect";
import { encodePngImage } from "./png-encode";

const PROOF_LINES = [["Capability probe", "First page"], [], ["Third page"]];

/** The probe's picture: 40 × 30 pixels, two flat colours. */
const PROOF_PICTURE = { width: 40, height: 30 } as const;

/** The probe's PDF, generated here: no file ships with the image for it. */
export async function capabilityProbePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, PROOF_LINES.flat());
  const { width, height } = PROOF_PICTURE;
  const pixels = new Uint8Array(width * height * 3);
  for (let p = 0; p < width * height; p++) {
    const left = p % width < width / 2;
    pixels.set(left ? [200, 40, 40] : [40, 80, 200], p * 3);
  }
  const picture = await embedRasterImage(
    doc,
    encodePngImage(width, height, "rgb8", pixels),
    "png",
  );
  for (const [index, lines] of PROOF_LINES.entries()) {
    const page = doc.addPage([612, 792]);
    lines.forEach((text, k) =>
      page.drawText(text, { x: 72, y: 700 - k * 28, size: 16, font }),
    );
    if (index === 0)
      await drawRasterImage(page, picture, {
        x: 72,
        y: 500,
        width: 160,
        height: 120,
      });
  }
  return doc.save();
}

/** What pdftotext would report for the probe PDF; the engine only opens with it. */
function probeExtraction() {
  const pages = PROOF_LINES.map((lines, index) => {
    const text = lines.join("\n");
    return { pageNumber: index + 1, text, characterCount: text.length };
  });
  const text = pages.map((page) => page.text).join("\n\n");
  return {
    pageCount: pages.length,
    pages,
    text,
    characterCount: text.length,
    hasText: true,
  };
}

/**
 * Does this image's PDF to PowerPoint engine write a package whose master →
 * layout → theme chain is present and resolves, one slide per page?
 *
 * `run` and `scanPages` are injectable so the negative controls can hand it
 * the package the engine wrote before the fix, or a reader that loses a page;
 * the daemon always uses the real ones.
 */
export async function provesPptxPresentationChain(
  run: typeof runPdfOfficeExport = runPdfOfficeExport,
  scanPages: PdfPageScanner = scanPdfPages,
): Promise<boolean> {
  try {
    const result = await run("pdf-to-powerpoint", await capabilityProbePdf(), {
      extract: async () => probeExtraction(),
      scanPages,
    });
    if (!result.ok) return false;
    const { problems, counts } = await inspectPptxPackage(result.output);
    return (
      problems.length === 0 &&
      counts.slides === PROOF_LINES.length &&
      counts.masters >= 1 &&
      counts.layouts >= 1 &&
      counts.themes >= 1
    );
  } catch {
    // A throw is an answer: this image cannot do it.
    return false;
  }
}

/** The probe picture's placement on its slide, in EMU (12,700 a point). */
const PROOF_PICTURE_EMU = {
  // Drawn at x 72 pt, from y 500 pt (bottom edge) up 120 pt, on a 792 pt
  // page: its top is 792 - 500 - 120 = 172 pt from the top. The first page
  // sets the slide size, so the page sits on its slide at scale 1.
  x: 72 * 12_700,
  y: 172 * 12_700,
  cx: 160 * 12_700,
  cy: 120 * 12_700,
} as const;

/**
 * Does THIS worker image put a page's picture on its slide AS a picture,
 * where the page paints it?
 *
 * The question the owner's report of 2026-10-10 asked of production — the
 * deck had no pictures — asked of the running image rather than of `main`.
 * The probe PDF's first page paints one 40 × 30 picture at a known box; the
 * deck must carry, on slide 1, a `p:pic` at that box (to a twentieth of a
 * point) whose blip resolves to a PNG of those pixel dimensions, in a package
 * the delivery inspector passes. A text-only deck, a picture flattened into a
 * page-sized background, or one moved or rescaled, all answer `false`.
 *
 * It does not say every PDF's pictures come through: the round trip
 * (`./fidelity`, `pnpm worker:pptx-fidelity-proof`) is the measure of how
 * closely a deck looks like its pages, on more than one picture.
 */
export async function provesPptxPictures(
  run: typeof runPdfOfficeExport = runPdfOfficeExport,
  scanPages: PdfPageScanner = scanPdfPages,
): Promise<boolean> {
  try {
    const result = await run("pdf-to-powerpoint", await capabilityProbePdf(), {
      extract: async () => probeExtraction(),
      scanPages,
    });
    if (!result.ok) return false;
    const { problems, counts } = await inspectPptxPackage(result.output);
    if (problems.length > 0 || counts.pictures < 1) return false;
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(result.output);
    const slide = await zip.file("ppt/slides/slide1.xml")?.async("string");
    const rels = await zip
      .file("ppt/slides/_rels/slide1.xml.rels")
      ?.async("string");
    if (!slide || !rels) return false;
    const tolerance = 635; // a twentieth of a point
    for (const pic of slide.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? []) {
      const off = /<a:off x="(\d+)" y="(\d+)"\/>/.exec(pic);
      const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(pic);
      const embed = /<a:blip r:embed="([^"]+)"/.exec(pic)?.[1];
      if (!off || !ext || !embed) continue;
      const box = [off[1], off[2], ext[1], ext[2]].map(Number);
      const want = [
        PROOF_PICTURE_EMU.x,
        PROOF_PICTURE_EMU.y,
        PROOF_PICTURE_EMU.cx,
        PROOF_PICTURE_EMU.cy,
      ];
      if (box.some((v, i) => Math.abs(v - want[i]!) > tolerance)) continue;
      const rel = (rels.match(/<Relationship [^>]*>/g) ?? []).find((r) =>
        r.includes(`Id="${embed}"`),
      );
      const target = rel?.split('Target="../media/')[1]?.split('"')[0];
      const media = target
        ? await zip.file(`ppt/media/${target}`)?.async("uint8array")
        : undefined;
      if (!media || media[0] !== 0x89 || media[1] !== 0x50) continue;
      const view = new DataView(
        media.buffer,
        media.byteOffset,
        media.byteLength,
      );
      if (
        view.getUint32(16) === PROOF_PICTURE.width &&
        view.getUint32(20) === PROOF_PICTURE.height
      )
        return true;
    }
    return false;
  } catch {
    return false;
  }
}

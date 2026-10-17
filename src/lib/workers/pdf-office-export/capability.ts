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
 *
 * Since 2026-10-17 the same question is asked of PDF to Word: does the
 * running image's .docx carry a page's picture, as a picture, between the
 * lines around it (`provesDocxPictures`, at the end of this file; the key
 * `docxPictures`)?
 */

import { PDFDocument } from "pdf-lib";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import { decodePng } from "@/lib/png-probe";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { readDocxBody } from "./docx-read";
import { runPdfOfficeExport, type PdfFlowExtractor } from "./engine";
import { scanPdfPages, type PdfPageScanner } from "./page-scan";
import { inspectPptxPackage } from "./pptx-inspect";
import { encodePngImage } from "./png-encode";

const PROOF_LINES = [["Capability probe", "First page"], [], ["Third page"]];

/** The probe's picture: 40 × 30 pixels, two flat colours, left and right. */
const PROOF_PICTURE = {
  width: 40,
  height: 30,
  left: [200, 40, 40],
  right: [40, 80, 200],
} as const;

/** The probe's PDF, generated here: no file ships with the image for it. */
export async function capabilityProbePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, PROOF_LINES.flat());
  const { width, height } = PROOF_PICTURE;
  const pixels = new Uint8Array(width * height * 3);
  for (let p = 0; p < width * height; p++) {
    const left = p % width < width / 2;
    pixels.set(left ? PROOF_PICTURE.left : PROOF_PICTURE.right, p * 3);
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

/**
 * Is `png` the probe's picture: its size, and each half's colour (opaque,
 * within 12 levels a channel) at the half's centre?
 */
function showsProofPicture(png: Uint8Array): boolean {
  try {
    const { width, height, data } = decodePng(png);
    if (width !== PROOF_PICTURE.width || height !== PROOF_PICTURE.height)
      return false;
    const at = (x: number, y: number, want: readonly number[]) => {
      const i = (y * width + x) * 4;
      return (
        data[i + 3] === 255 &&
        want.every((c, k) => Math.abs(data[i + k]! - c) <= 12)
      );
    };
    const y = Math.floor(height / 2);
    return (
      at(Math.floor(width / 4), y, PROOF_PICTURE.left) &&
      at(Math.floor((width * 3) / 4), y, PROOF_PICTURE.right)
    );
  } catch {
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
 * point) whose blip resolves to a PNG of those pixel dimensions AND those
 * pixels — decoded (`@/lib/png-probe`, a reader that shares nothing with the
 * writer) and sampled in each half, opaque and within a few levels of the
 * probe's two colours — in a package the delivery inspector passes. A
 * text-only deck, a picture flattened into a page-sized background, one moved
 * or rescaled, or one of the right size with the wrong pixels (blank,
 * transparent, black), all answer `false`. Until 2026-10-11 the pixels were
 * not read: a deck whose every picture was transparent black passed.
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
      if (showsProofPicture(media)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 *  Word: does THIS image's PDF to Word keep the picture, in its place?
 * ------------------------------------------------------------------ */

/** The Word probe's words: a line above the picture, one below, a page 2. */
export const DOCX_PROBE_TEXT = {
  above: "Word capability probe",
  below: "The line under the picture",
  second: "The second page",
} as const;
/** Where the Word probe's picture is shown: points, top-left origin. */
const DOCX_PROBE_BOX = { x: 72, y: 150, width: 160, height: 120 } as const;

/**
 * The Word probe's PDF, generated here: on a US Letter page, a line, the
 * probe's picture under it, a line under that; and a second page with a
 * line. Letter's text area is 468 points wide, so the picture needs no
 * fitting and must keep its 160 × 120 points.
 */
export async function docxProbePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const words = Object.values(DOCX_PROBE_TEXT);
  const font = await embedDrawingFont(doc, words);
  const { width, height } = PROOF_PICTURE;
  const pixels = new Uint8Array(width * height * 3);
  for (let p = 0; p < width * height; p++) {
    const left = p % width < width / 2;
    pixels.set(left ? PROOF_PICTURE.left : PROOF_PICTURE.right, p * 3);
  }
  const picture = await embedRasterImage(
    doc,
    encodePngImage(width, height, "rgb8", pixels),
    "png",
  );
  const first = doc.addPage([612, 792]);
  first.drawText(DOCX_PROBE_TEXT.above, {
    x: 72,
    y: 792 - 120,
    size: 16,
    font,
  });
  const box = DOCX_PROBE_BOX;
  await drawRasterImage(first, picture, {
    x: box.x,
    y: 792 - box.y - box.height,
    width: box.width,
    height: box.height,
  });
  first.drawText(DOCX_PROBE_TEXT.below, {
    x: 72,
    y: 792 - 300,
    size: 16,
    font,
  });
  const second = doc.addPage([612, 792]);
  second.drawText(DOCX_PROBE_TEXT.second, {
    x: 72,
    y: 792 - 120,
    size: 16,
    font,
  });
  return doc.save();
}

/**
 * Does THIS worker image's PDF to Word put a page's picture in the .docx AS
 * that picture, between the line above it and the line below it, at the
 * size the page shows it?
 *
 * The question production answered "no" to on 2026-10-17 — the owner's
 * tutorial came back with none of its 37 pictures — asked of the running
 * image rather than of `main`. The probe PDF ({@link docxProbePdf}) goes
 * through the real engine with the image's OWN text extractor (`extractFlow`,
 * poppler's `-bbox-layout` on the worker: the order of a picture among the
 * paragraphs depends on poppler's frame and pdf.js's agreeing, so a stand-in
 * would prove the wrong thing) and the real page reader. The .docx is read
 * back by `./docx-read`, which shares nothing with the writer: page 1's body
 * must hold the line above, then exactly one picture, then the line below;
 * the picture's extent must be 160 × 120 points (to a twentieth); its media
 * must decode (`@/lib/png-probe`) to the probe's 40 × 30 pixels with its two
 * colours; and the second page's line must follow a page break. A text-only
 * document, a picture moved below its caption, rescaled, or swapped for
 * other pixels, all answer `false`, and so does an image without the
 * extractor or the page reader.
 *
 * An image built before this key publishes nothing, and the reader parses the
 * absence as `false`.
 */
export async function provesDocxPictures(
  extractFlow: PdfFlowExtractor | undefined,
  run: typeof runPdfOfficeExport = runPdfOfficeExport,
  scanPages: PdfPageScanner = scanPdfPages,
): Promise<boolean> {
  try {
    if (!extractFlow) return false;
    const result = await run("pdf-to-word", await docxProbePdf(), {
      extractFlow,
      scanPages,
    });
    if (!result.ok) return false;
    const body = await readDocxBody(result.output);
    const at = (text: string) =>
      body.paragraphs.findIndex((p) => p.text.includes(text));
    const above = at(DOCX_PROBE_TEXT.above);
    const below = at(DOCX_PROBE_TEXT.below);
    const second = at(DOCX_PROBE_TEXT.second);
    if (above < 0 || below < 0 || second < 0) return false;
    const onPage = body.pictures.filter((p) => p.segment === 0);
    if (onPage.length !== 1 || body.pictures.length !== 1) return false;
    const [pic] = onPage;
    const tolerance = 0.05;
    return (
      body.paragraphs[above]!.segment === 0 &&
      body.paragraphs[below]!.segment === 0 &&
      body.paragraphs[second]!.segment === 1 &&
      above < pic!.paragraph &&
      pic!.paragraph < below &&
      Math.abs(pic!.width - DOCX_PROBE_BOX.width) <= tolerance &&
      Math.abs(pic!.height - DOCX_PROBE_BOX.height) <= tolerance &&
      pic!.bytes !== null &&
      showsProofPicture(pic!.bytes)
    );
  } catch {
    return false;
  }
}

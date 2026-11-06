/**
 * The page-orientation half of `worker:options-proof` (audit #21, 2026-11-06).
 *
 * Ghostscript's pdfwrite defaults to `-dAutoRotatePages=/PageByPage`: it guesses
 * each page's orientation from the direction of its text and rewrites /Rotate to
 * match. The deep compression step now passes `-dAutoRotatePages=/None`, and its
 * unit test proves the argv carries the flag — the question asked, not what the
 * engine does with it. This fixture and verdict are the engine's answer, read back
 * from the file, on the worker image where Ghostscript is installed.
 *
 * The fixture is built so that the default heuristic WOULD change it:
 *   1. portrait, `/Rotate 90`, horizontal text — the text reads upright in the
 *      unrotated page, so a text-direction guess sets /Rotate 0;
 *   2. landscape MediaBox, no /Rotate, mostly VERTICAL text — the guess turns it;
 *   3. portrait, no /Rotate, horizontal text — the page nothing should touch.
 * Every page draws one noisy photo above the deep step's downsampling threshold,
 * so the engine's file is smaller than the input and the no-worse rule cannot
 * hand the original back (which would pass the verdict without testing anything).
 */
import {
  concatTransformationMatrix,
  degrees,
  drawObject,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  StandardFonts,
  type PDFName,
} from "pdf-lib";

/** What a reader sees of a page's orientation: its /Rotate and MediaBox shape. */
export interface PageOrientation {
  /** /Rotate, normalised to 0, 90, 180 or 270. */
  rotate: number;
  /** MediaBox wider than tall. */
  landscape: boolean;
}

/** The photo: px square over one inch, so its resolution is px DPI. */
const PHOTO_PX = 400;

export async function rotationProofPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const samples = new Uint8Array(PHOTO_PX * PHOTO_PX * 3);
  let seed = 0x1b873593;
  for (let i = 0; i < samples.length; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    samples[i] = seed >>> 24;
  }
  const photo = doc.context.register(
    doc.context.flateStream(samples, {
      Type: "XObject",
      Subtype: "Image",
      Width: PHOTO_PX,
      Height: PHOTO_PX,
      BitsPerComponent: 8,
      ColorSpace: "DeviceRGB",
    }),
  );
  const pages: { size: [number, number]; rotate: number; vertical: boolean }[] =
    [
      { size: [612, 792], rotate: 90, vertical: false },
      { size: [792, 612], rotate: 0, vertical: true },
      { size: [612, 792], rotate: 0, vertical: false },
    ];
  for (const spec of pages) {
    const page = doc.addPage(spec.size);
    if (spec.rotate !== 0) page.setRotation(degrees(spec.rotate));
    const name: PDFName = page.node.newXObject("Im", photo);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(72, 0, 0, 72, 36, 36),
      drawObject(name),
      popGraphicsState(),
    );
    for (let line = 0; line < 20; line++) {
      const text = `Orientation proof line ${line + 1}: this page must keep its rotation.`;
      if (spec.vertical) {
        page.drawText(text, {
          x: 140 + line * 30,
          y: 60,
          size: 11,
          font,
          rotate: degrees(90),
        });
      } else {
        page.drawText(text, {
          x: 130,
          y: spec.size[1] - 60 - line * 18,
          size: 11,
          font,
        });
      }
    }
  }
  return doc.save({ useObjectStreams: false });
}

/** Each page's /Rotate and MediaBox shape, read back with pdf-lib. */
export async function pageOrientations(
  bytes: Uint8Array,
): Promise<PageOrientation[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().map((page) => {
    const box = page.getMediaBox();
    return {
      rotate: (((page.getRotation().angle % 360) + 360) % 360) as number,
      landscape: box.width > box.height,
    };
  });
}

const describe = (o: readonly PageOrientation[]) =>
  o.map((p) => `${p.rotate}${p.landscape ? "L" : "P"}`).join(" ");

/** Every output page has the input page's /Rotate and MediaBox shape. */
export function orientationVerdict(
  input: readonly PageOrientation[],
  output: readonly PageOrientation[],
): { ok: boolean; detail: string } {
  const same =
    input.length === output.length &&
    input.every(
      (page, i) =>
        page.rotate === output[i]!.rotate &&
        page.landscape === output[i]!.landscape,
    );
  return {
    ok: same,
    detail: `input ${describe(input)}, output ${describe(output)}`,
  };
}

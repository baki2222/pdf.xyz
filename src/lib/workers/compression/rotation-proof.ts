/**
 * The page-orientation checks of `worker:options-proof` (audit #21, 2026-11-06)
 * and `worker:pdfa-proof` (the same day): one fixture and one verdict, run
 * through compress-pdf's deep step and through the PDF/A conversion.
 *
 * Ghostscript's pdfwrite guesses each page's orientation from the direction of
 * its text and rewrites /Rotate to match, unless told `-dAutoRotatePages=/None`.
 * Its default is `/PageByPage` (each page on its own; the PDF/A argv has no
 * preset); compress-pdf's `/ebook` preset sets `/All` (ONE decision, from the
 * whole document, applied to every page). Both argvs now pass the flag, and
 * their unit tests prove the argv carries it — the question asked, not what the
 * engine does with it. This fixture and verdict are the engine's answer, read
 * back from the file, on the worker image where Ghostscript is installed.
 *
 * The fixture is built so that BOTH defaults change it:
 *   1. portrait, `/Rotate 90`, horizontal text — sideways as displayed;
 *   2. and 3. landscape MediaBox, no /Rotate, mostly VERTICAL text — sideways;
 *   4. portrait, no /Rotate, horizontal text — upright.
 * Measured on the production image's gs 10.00.0 with the flag taken out:
 * `/PageByPage` (PDF/A) turned pages 1–3 portrait, and `/All` (the deep step)
 * turned all four, the upright page 4 included. Three sideways pages are what
 * `/All` needed. Until the first in-image run this fixture had pages 1, 2 and 4
 * only: `/All` turned none of them, and the deep step's check passed with its
 * flag deleted. So neither claim is left to this comment: each proof runs its
 * engine once WITHOUT the flag and requires a page turned, on whatever
 * Ghostscript the image ships.
 *
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
  type PDFName,
} from "pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";

/** What a reader sees of a page's orientation: its /Rotate and MediaBox shape. */
export interface PageOrientation {
  /** /Rotate, normalised to 0, 90, 180 or 270. */
  rotate: number;
  /** MediaBox wider than tall. */
  landscape: boolean;
}

/** The photo: px square over one inch, so its resolution is px DPI. */
const PHOTO_PX = 400;

const lineText = (line: number) =>
  `Orientation proof line ${line + 1}: this page must keep its rotation.`;
const LINES = 20;

export async function rotationProofPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // Through the font chooser, like every text-drawing module in `src/`
  // (`text-drawing-call-sites.test.ts`). The lines are WinAnsi, so it hands
  // back Helvetica: the font this fixture drew with before.
  const font = await embedDrawingFont(
    doc,
    Array.from({ length: LINES }, (_, line) => lineText(line)),
  );
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
    for (let line = 0; line < LINES; line++) {
      const text = lineText(line);
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

/**
 * Wider than tall AS DISPLAYED: the MediaBox turned by /Rotate. This, not
 * /Rotate, is the orientation a reader sees.
 */
export function displaysLandscape(page: PageOrientation): boolean {
  return page.landscape !== (page.rotate % 180 === 90);
}

/** Each page as stored: /Rotate, then the MediaBox shape (`90P`, `0L`). */
const stored = (o: readonly PageOrientation[]) =>
  o.map((p) => `${p.rotate}${p.landscape ? "L" : "P"}`).join(" ");
/** Each page as displayed (`LLP`). */
const shown = (o: readonly PageOrientation[]) =>
  o.map((p) => (displaysLandscape(p) ? "L" : "P")).join("");

/**
 * Every output page DISPLAYS in its input page's orientation.
 *
 * WAS: every output page had its input page's /Rotate and MediaBox shape,
 * compared as stored. That is the mechanism, and Ghostscript changes it on a page
 * it does not re-orient. With `-dAutoRotatePages=/None`, gs 10.00.0 in the
 * production image writes the /Rotate 90 portrait as an unrotated landscape
 * page with the turn moved into its content (PDF/A runner and deep step alike).
 * Rendered at 24 dpi, input and output are the same 264x204 page, mean |diff|
 * 0.21 out of 255, where the same page turned 180° differs by 34. The stored
 * comparison failed it anyway: the options proof, run by hand in that image with
 * the fix in place, printed `FAIL rotation kept: input 90P 0L 0P, output 0L 0L 0P`.
 * A guard that is red on the fixed engine gets deleted, not believed.
 *
 * Blind to a 180° turn, which keeps the displayed shape (tested as such in
 * `rotation-proof.test.ts`). The fixture gives the heuristic nothing to turn
 * 180°. What it does to this fixture is turn the two sideways pages upright,
 * and that changes the shape.
 */
export function orientationVerdict(
  input: readonly PageOrientation[],
  output: readonly PageOrientation[],
): { ok: boolean; detail: string } {
  const same =
    input.length === output.length &&
    input.every(
      (page, i) => displaysLandscape(page) === displaysLandscape(output[i]!),
    );
  return {
    ok: same,
    detail: `input ${stored(input)} (shows ${shown(input)}), output ${stored(output)} (shows ${shown(output)})`,
  };
}

/**
 * The fixture really holds the three shapes the verdict is about: a /Rotate 90
 * portrait (the page gs rewrites without turning), an unrotated landscape, and
 * a plain portrait (the page `/All` turns and `/PageByPage` leaves). Whether
 * the default heuristic turns the fixture at all is not decided here: only the
 * engine can say, so each proof's control run asks it.
 */
export function fixtureVerdict(wanted: readonly PageOrientation[]): {
  ok: boolean;
  detail: string;
} {
  return {
    ok:
      wanted.some((p) => p.rotate === 90 && !p.landscape) &&
      wanted.some((p) => p.rotate === 0 && p.landscape) &&
      wanted.some((p) => p.rotate === 0 && !p.landscape),
    detail: stored(wanted),
  };
}

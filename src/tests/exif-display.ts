/**
 * What a browser SHOWS for a JPEG with a given EXIF Orientation — built from
 * pixel-grid operations, independently of the matrix table the product uses —
 * and the check that a drawn image matches it.
 *
 * The oracle is the TIFF/EXIF definition in its usual operational form:
 *   1 as stored          2 flip horizontal     3 rotate 180°
 *   4 flip vertical      5 transpose           6 rotate 90° clockwise
 *   7 transverse         8 rotate 90° counter-clockwise
 * with 5 = rotate CW then flip horizontal, 7 = rotate CW then flip vertical.
 * Nothing here reads `orientationMatrix`; a table typo there cannot be
 * repeated here, because here there is no table.
 */
import type { ExifOrientation } from "@/lib/pdf/jpeg-orientation";
import { apply, boxOf, type DrawnImage } from "./drawn-images";

type Grid = number[][];

const rotateCW = (g: Grid): Grid =>
  g[0]!.map((_, c) => g.map((row) => row[c]!).reverse());
const flipH = (g: Grid): Grid => g.map((row) => [...row].reverse());
const flipV = (g: Grid): Grid => [...g].reverse();

const SHOW: Record<ExifOrientation, (g: Grid) => Grid> = {
  1: (g) => g,
  2: flipH,
  3: (g) => rotateCW(rotateCW(g)),
  4: flipV,
  5: (g) => flipH(rotateCW(g)),
  6: rotateCW,
  7: (g) => flipV(rotateCW(g)),
  8: (g) => rotateCW(rotateCW(rotateCW(g))),
};

/** The displayed grid of labels (label = row * width + col of the STORED pixel). */
export function displayedGrid(
  width: number,
  height: number,
  orientation: ExifOrientation,
): Grid {
  const stored: Grid = Array.from({ length: height }, (_, r) =>
    Array.from({ length: width }, (_, c) => r * width + c),
  );
  return SHOW[orientation](stored);
}

/**
 * Every stored pixel whose centre, carried through the drawn image's CTM, does
 * NOT land in the cell of the drawn box where the browser shows it. Empty
 * means the page shows what the browser showed.
 *
 * The drawn box's aspect must match the displayed grid's first: a sideways
 * image squeezed into an upright box can still put a few pixels in the right
 * cells, and that is not "upright".
 */
export function placementMismatches(
  drawn: DrawnImage,
  orientation: ExifOrientation,
): string[] {
  const shown = displayedGrid(drawn.width, drawn.height, orientation);
  const cols = shown[0]!.length;
  const rows = shown.length;
  const box = boxOf(drawn.ctm);
  const boxW = box.x1 - box.x0;
  const boxH = box.y1 - box.y0;
  const problems: string[] = [];
  const aspect = boxW / boxH;
  const want = cols / rows;
  if (Math.abs(aspect - want) > 1e-6 * want) {
    problems.push(
      `box is ${boxW.toFixed(2)}×${boxH.toFixed(2)} (aspect ${aspect.toFixed(4)}), the browser shows ${cols}×${rows} (aspect ${want.toFixed(4)})`,
    );
    return problems;
  }
  const where = new Map<number, [number, number]>();
  shown.forEach((row, r) =>
    row.forEach((label, c) => where.set(label, [r, c])),
  );
  for (let r = 0; r < drawn.height; r++) {
    for (let c = 0; c < drawn.width; c++) {
      const u = (c + 0.5) / drawn.width;
      const v = 1 - (r + 0.5) / drawn.height;
      const [x, y] = apply(drawn.ctm, u, v);
      const col = Math.floor(((x - box.x0) / boxW) * cols);
      const row = Math.floor(((box.y1 - y) / boxH) * rows);
      const [er, ec] = where.get(r * drawn.width + c)!;
      if (row !== er || col !== ec) {
        problems.push(
          `stored pixel (row ${r}, col ${c}) lands in cell (row ${row}, col ${col}); the browser shows it at (row ${er}, col ${ec})`,
        );
      }
    }
  }
  return problems;
}

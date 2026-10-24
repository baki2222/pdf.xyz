/**
 * Read page 1 of a PDF the way a READER receives it.
 *
 * Every position here goes through pdfjs — the engine behind our own previews
 * and Firefox's viewer — and its viewport transform, which is where `/Rotate`
 * and the CropBox are applied. A tool's own placement arithmetic is never read
 * back to itself: a hand-derived formula checked against the same formula is
 * how the MediaBox-placement defects in Edit PDF and Sign PDF shipped.
 *
 * Coordinates are in the viewer's frame: points from the bottom-left corner of
 * the page as displayed, y up — the frame our tools take positions in.
 *
 * Shared by `edit-placement.test.ts` and `signature-placement.test.ts`, so a
 * fix to the reader reaches every placement proof at once.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";
import { awaitPdfjsDocument } from "@/lib/pdf/pdfjs";

/** [x0, y0, x1, y1] in the viewer's frame. */
export type Box = [number, number, number, number];

export interface ViewerText {
  str: string;
  /** Baseline-left, viewer frame. */
  x: number;
  y: number;
  /** Advance width as pdfjs reports it. */
  width: number;
  /** Font size: the scale of the text matrix, in points. */
  size: number;
  /** Glyph x-axis along viewer +x and glyph y-axis up the viewer's page. */
  upright: boolean;
}

export interface ViewerImage {
  box: Box;
  /**
   * The image's own bottom edge runs along viewer +x and its left edge up
   * viewer +y — it is displayed the way it was drawn, not turned or mirrored.
   */
  upright: boolean;
  /**
   * pdfjs produced pixels for it. pdfjs emits the paint op for an image it
   * cannot decode and then resolves the image to `null` — a viewer shows
   * nothing there. Measured: a JPEG2000 image opened without a reachable
   * `wasmUrl` keeps its paint op and resolves to null.
   */
  decoded: boolean;
}

export interface ViewerRead {
  width: number;
  height: number;
  texts: ViewerText[];
  /** Path bounding boxes in the viewer's frame (bottom-left origin, y up). */
  paths: Box[];
  /** Images a viewer actually shows: painted AND decoded. */
  images: Box[];
  /** Every painted image, decoded or not, with its orientation. */
  imageFrames: ViewerImage[];
}

type Matrix = [number, number, number, number, number, number];

const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

function bboxOf(points: [number, number][]): Box {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const EPS = 1e-6;

/** A pdfjs image object that carries pixels (raw samples or a bitmap). */
const hasPixels = (img: unknown): boolean => {
  if (img === null || typeof img !== "object") return false;
  const { data, bitmap } = img as {
    data?: ArrayLike<number>;
    bitmap?: unknown;
  };
  return (data !== undefined && data.length > 0) || bitmap !== undefined;
};

/**
 * Where THIS process finds pdfjs's decoders and character maps.
 *
 * `PDFJS_DOCUMENT_DEFAULTS` is spread first, so this reader inherits every
 * option the engines set — the reader that proves placement must open a
 * document the way the engines do, and `wasm-assets.test.ts` refuses any
 * `getDocument` that does not. But its `wasmUrl` and `cMapUrl` are
 * same-origin HTTP paths served by the Next app; in the Node test process
 * pdfjs hands `${url}${file}` to `fs.readFile`, where they resolve to nothing
 * and a JPEG2000 or JBIG2 image silently drops out of {@link ViewerRead.images}.
 *
 * So both are re-pointed at the installed package — the files
 * `scripts/copy-pdfjs-wasm.ts` copies into `public/`. They are plain
 * forward-slash FILESYSTEM paths, not `file://` URLs: `fs.readFile` treats a
 * URL passed as a string as a relative path and fails (ENOENT, measured), and
 * pdfjs requires the trailing slash. The positive control is the JPEG2000
 * case in `pdf-viewer-read.test.ts`.
 */
const nodeAssetOptions = (): { wasmUrl: string; cMapUrl: string } => {
  const require = createRequire(join(process.cwd(), "package.json"));
  const dir = dirname(require.resolve("pdfjs-dist/package.json"))
    .split("\\")
    .join("/");
  return { wasmUrl: `${dir}/wasm/`, cMapUrl: `${dir}/cmaps/` };
};

/** A page (1-based, default 1) as pdfjs presents it: viewer-frame text, path and image positions. */
export async function readAsViewer(
  bytes: Uint8Array,
  pageNumber = 1,
): Promise<ViewerRead> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    ...PDFJS_DOCUMENT_DEFAULTS,
    ...nodeAssetOptions(),
    data: bytes.slice(),
    useWorkerFetch: false,
    disableFontFace: true,
  });
  try {
    const doc = await awaitPdfjsDocument(task);
    const page = await doc.getPage(pageNumber);
    const vp = page.getViewport({ scale: 1 });
    const view = vp.transform as Matrix;
    // pdfjs's viewport is y-down from the top-left; flip to the bottom-left
    // frame the tools' coordinates are expressed in.
    const toViewer = (m: Matrix, x: number, y: number): [number, number] => {
      const [vx, vy] = apply(mul(view, m), x, y);
      return [vx, vp.height - vy];
    };

    const content = await page.getTextContent();
    const texts: ViewerText[] = [];
    for (const item of content.items) {
      if (!("str" in item) || item.str.trim() === "") continue;
      const tm = item.transform as Matrix;
      const m = mul(view, tm);
      texts.push({
        str: item.str,
        x: m[4],
        y: vp.height - m[5],
        width: item.width,
        size: Math.hypot(tm[0], tm[1]),
        // Upright in the viewport: glyph x-axis along +x, y-axis up the screen.
        upright:
          m[0] > 0 && Math.abs(m[1]) < EPS && Math.abs(m[2]) < EPS && m[3] < 0,
      });
    }

    const { OPS } = pdfjs;
    const list = await page.getOperatorList();
    const paths: Box[] = [];
    const imageFrames: ViewerImage[] = [];
    const decodes: Promise<boolean>[] = [];
    // An XObject's pixels arrive by object id (page-local, or `g_…` when pdfjs
    // shares them document-wide); an inline image carries them in the op.
    const decodedById = (id: string): Promise<boolean> =>
      new Promise((resolve) => {
        const store = id.startsWith("g_") ? page.commonObjs : page.objs;
        store.get(id, (img: unknown) => resolve(hasPixels(img)));
      });
    let ctm: Matrix = [1, 0, 0, 1, 0, 0];
    const stack: Matrix[] = [];
    list.fnArray.forEach((fn, i) => {
      const args = list.argsArray[i] as unknown[];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) ctm = mul(ctm, args as unknown as Matrix);
      else if (fn === OPS.constructPath) {
        // args: [paint op, [path data], minMax]. Path data is a flat list of
        // drawing ops: 0 moveTo(x,y) 1 lineTo(x,y) 2 curveTo(6) 3 quad(4) 4 close.
        const data = Array.from((args[1] as ArrayLike<number>[])[0] ?? []);
        const pts: [number, number][] = [];
        for (let k = 0; k < data.length;) {
          const op = data[k++]!;
          const n = op === 2 ? 6 : op === 3 ? 4 : op === 4 ? 0 : 2;
          for (let j = 0; j < n; j += 2) {
            pts.push(toViewer(ctm, data[k + j]!, data[k + j + 1]!));
          }
          k += n;
        }
        if (pts.length > 0) paths.push(bboxOf(pts));
      } else if (
        fn === OPS.paintImageXObject ||
        fn === OPS.paintInlineImageXObject
      ) {
        // An image XObject fills the unit square of the current matrix; its
        // bottom-left sample row sits at (0,0)–(1,0).
        const o = toViewer(ctm, 0, 0);
        const ex = toViewer(ctm, 1, 0);
        const ey = toViewer(ctm, 0, 1);
        imageFrames.push({
          box: bboxOf([o, ex, ey, toViewer(ctm, 1, 1)]),
          upright:
            ex[0] > o[0] &&
            Math.abs(ex[1] - o[1]) < EPS &&
            ey[1] > o[1] &&
            Math.abs(ey[0] - o[0]) < EPS,
          decoded: false,
        });
        decodes.push(
          typeof args[0] === "string"
            ? decodedById(args[0])
            : Promise.resolve(hasPixels(args[0])),
        );
      }
    });
    (await Promise.all(decodes)).forEach((ok, k) => {
      imageFrames[k]!.decoded = ok;
    });
    return {
      width: vp.width,
      height: vp.height,
      texts,
      paths,
      images: imageFrames.filter((f) => f.decoded).map((f) => f.box),
      imageFrames,
    };
  } finally {
    await task.destroy();
  }
}

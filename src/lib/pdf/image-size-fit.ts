/**
 * JPG / PNG to PDF under a "Max file size" (2026-10-31): the ladder of
 * `image-size-limit.ts` with the real builder — the image PDF engine
 * (`buildImagePdf`) fed images re-encoded in the browser
 * (`image-reencode.ts`). Loaded by the runner only when a limit is set, so a
 * run with No limit never fetches it and makes exactly the PDF it always did.
 *
 * Per image, per rung, the SMALLER of the file as added and its re-encode is
 * used: the original is full size and never re-saved, so where it is not
 * bigger it is better on both counts. A re-encode of a small, flat PNG can be
 * bigger than the PNG; nothing here assumes it is not. A TIFF is weighed page
 * by page against what the page costs kept lossless (2026-11-04), so a
 * black-and-white scan page — whose 1-bit samples are almost always smaller
 * than any JPEG of it — stays lossless on every rung.
 */
import {
  buildImagePdf,
  imagesToPdf,
  perImagePdfNames,
  sniffImageFormat,
  sniffRasterFormat,
  sniffTiff,
  loadTiff,
  IMAGE_MIME,
  type ImagePdfInput,
  type ImagePdfKind,
  type PreparedEntry,
  type PreparedImage,
} from "./image-to-pdf";
import type { ImagePageOptions } from "./image-page-layout";
import {
  LIMIT_TIME_BUDGET_MS,
  MAX_LIMIT_ATTEMPTS,
  REENCODE_LADDER,
  fitUnderLimit,
  type LimitReport,
  type ReencodeRung,
} from "./image-size-limit";
import type { ReencodedImage } from "./image-reencode";

/** One PDF made under a limit, and what it took. */
export interface FittedPdf {
  name: string;
  bytes: Uint8Array;
  report: LimitReport;
  /** Some image in the returned PDF was saved again. */
  reencoded: boolean;
  /** Some image in it had transparency composited onto white. */
  flattened: boolean;
  images: number;
}

export type Reencoder = (
  name: string,
  bytes: Uint8Array,
  mime: string,
  rung: ReencodeRung,
) => Promise<ReencodedImage>;

/** The re-encoder for a decoded TIFF page (`reencodePixels`). */
export type PixelReencoder = (
  name: string,
  rgba: Uint8ClampedArray,
  pixels: { width: number; height: number },
  layout: { layoutWidth: number; layoutHeight: number },
  rung: ReencodeRung,
) => Promise<ReencodedImage>;

export interface FitImageDeps {
  reencode?: Reencoder;
  reencodePixels?: PixelReencoder;
  now?: () => number;
  budgetMs?: number;
  pause?: () => Promise<void>;
  ladder?: readonly ReencodeRung[];
}

/**
 * One rung for every page of a TIFF: the page's JPEG re-encode where it is
 * SMALLER than the page kept lossless, `undefined` (lossless) where it is not
 * — the same rule a JPEG or PNG file gets against its own bytes. A TIFF has no
 * per-page file to weigh, so the lossless cost is the page's own compressed
 * samples, measured (`losslessTiffBytes`) and kept across rungs in `lossless`.
 * The page is laid out at its size on paper either way.
 */
async function tiffPagesUnderRung(
  file: ImagePdfInput,
  step: ReencodeRung,
  deps: FitImageDeps,
  lossless: Map<string, number>,
): Promise<{ pages: (PreparedImage | undefined)[]; flattened: boolean }> {
  const tiff = await loadTiff();
  const reencode =
    deps.reencodePixels ?? (await import("./image-reencode")).reencodePixels;
  const pages: (PreparedImage | undefined)[] = [];
  let flattened = false;
  for (const page of tiff.readTiffPages(file.name, file.bytes)) {
    const raster = await tiff.decodeTiffPage(file.name, file.bytes, page);
    const key = `${page.number}:${file.name}`;
    const keep = lossless.get(key) ?? (await tiff.losslessTiffBytes(raster));
    lossless.set(key, keep);
    const layout = { layoutWidth: page.widthPt, layoutHeight: page.heightPt };
    const jpeg = await reencode(
      file.name,
      tiff.tiffRasterRgba(raster),
      { width: raster.width, height: raster.height },
      layout,
      step,
    );
    if (jpeg.bytes.byteLength < keep) {
      pages.push({ bytes: jpeg.bytes, format: "jpg", ...layout });
      flattened ||= jpeg.flattened;
    } else pages.push(undefined);
  }
  return { pages, flattened };
}

/** A macrotask turn, so the tab paints between attempts. */
const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function fitOne(
  kind: ImagePdfKind,
  files: ImagePdfInput[],
  options: ImagePageOptions,
  limitBytes: number,
  name: string,
  deps: FitImageDeps,
): Promise<FittedPdf> {
  const ladder = deps.ladder ?? REENCODE_LADDER;
  const reencode =
    deps.reencode ?? (await import("./image-reencode")).reencodeImage;
  const used = new Map<number, { reencoded: boolean; flattened: boolean }>();
  // What each TIFF page costs kept lossless, by file and page: weighed once.
  const lossless = new Map<string, number>();
  const build = async (rung: number): Promise<Uint8Array> => {
    if (rung === 0) {
      used.set(0, { reencoded: false, flattened: false });
      return imagesToPdf(kind, files, options);
    }
    const step = ladder[rung - 1]!;
    let reencoded = false;
    let flattened = false;
    const prepared: PreparedEntry[] = [];
    for (const file of files) {
      if (sniffTiff(file.bytes)) {
        // A TIFF is many pages: each is weighed on its own, against what it
        // costs kept lossless, so a fax page stays 1-bit while a photo page
        // beside it shrinks.
        const tiff = await tiffPagesUnderRung(file, step, deps, lossless);
        reencoded ||= tiff.pages.some(Boolean);
        flattened ||= tiff.flattened;
        prepared.push(tiff.pages);
        continue;
      }
      const format = sniffImageFormat(file.bytes);
      const mime = format ? IMAGE_MIME[format] : file.type;
      const out = await reencode(file.name, file.bytes, mime, step);
      // A JPEG or PNG goes in as it is unless the re-encode is smaller; a
      // WebP, GIF or BMP is re-encoded on every path, so it always takes it.
      if (
        sniffRasterFormat(file.bytes) &&
        out.bytes.byteLength >= file.bytes.byteLength
      ) {
        prepared.push(undefined);
        continue;
      }
      reencoded = true;
      flattened ||= out.flattened;
      prepared.push({
        bytes: out.bytes,
        format: "jpg",
        layoutWidth: out.layoutWidth,
        layoutHeight: out.layoutHeight,
      });
    }
    used.set(rung, { reencoded, flattened });
    return buildImagePdf(kind, files, options, prepared);
  };
  const { output, report } = await fitUnderLimit(
    limitBytes,
    Math.min(MAX_LIMIT_ATTEMPTS, ladder.length + 1),
    build,
    {
      now: deps.now ?? (() => Date.now()),
      budgetMs: deps.budgetMs ?? LIMIT_TIME_BUDGET_MS,
      pause: deps.pause ?? nextTurn,
    },
  );
  const chosen = used.get(report.chosenRung)!;
  return { name, bytes: output, report, ...chosen, images: files.length };
}

/** One PDF of every image, at or under `limitBytes` when it can be. */
export async function imagesToPdfUnderLimit(
  kind: ImagePdfKind,
  files: ImagePdfInput[],
  options: ImagePageOptions,
  limitBytes: number,
  name: string,
  deps: FitImageDeps = {},
): Promise<FittedPdf> {
  return fitOne(kind, files, options, limitBytes, name, deps);
}

/** One PDF per image, the limit applied to EACH, named as `imagesToPdfs` names them. */
export async function imagesToPdfsUnderLimit(
  kind: ImagePdfKind,
  files: ImagePdfInput[],
  options: ImagePageOptions,
  limitBytes: number,
  deps: FitImageDeps = {},
): Promise<FittedPdf[]> {
  const names = perImagePdfNames(files);
  const out: FittedPdf[] = [];
  for (const [i, file] of files.entries())
    out.push(await fitOne(kind, [file], options, limitBytes, names[i]!, deps));
  return out;
}

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
 * bigger than the PNG; nothing here assumes it is not.
 */
import {
  buildImagePdf,
  imagesToPdf,
  perImagePdfNames,
  sniffImageFormat,
  sniffRasterFormat,
  IMAGE_MIME,
  type ImagePdfInput,
  type ImagePdfKind,
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

export interface FitImageDeps {
  reencode?: Reencoder;
  now?: () => number;
  budgetMs?: number;
  pause?: () => Promise<void>;
  ladder?: readonly ReencodeRung[];
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
  const build = async (rung: number): Promise<Uint8Array> => {
    if (rung === 0) {
      used.set(0, { reencoded: false, flattened: false });
      return imagesToPdf(kind, files, options);
    }
    const step = ladder[rung - 1]!;
    let reencoded = false;
    let flattened = false;
    const prepared: (PreparedImage | undefined)[] = [];
    for (const file of files) {
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

/**
 * The deployment proof's verdict for Compress PDF's Image quality (audit
 * compress-pdf#4, 2026-11-08), read from the JPEG inside the file a person
 * downloads.
 *
 * The option changes ONE property: the quantisation tables Ghostscript
 * writes into each image it encodes as JPEG (`QFactor`, scaled from the
 * standard tables, `imageQualityDistillerParams`). A size comparison is a
 * weak witness of that: a worker that ignores the option still makes a
 * smaller file than the input, and the no-worse swap hands back the
 * ORIGINAL whenever the result is not smaller. So this reads the tables
 * themselves: each JPEG's luminance table divided by the standard one
 * (ITU-T T.81 Annex K) gives the scale it was encoded at, and that scale
 * must sit nearest the level asked for, among the levels the product
 * offers ({@link IMAGE_QUALITY_LEVELS}, never a typed number). A worker
 * image older than the option encodes at /ebook's own 0.76 ("Medium") and
 * carries no `imageQuality` on the job record, and fails on both.
 *
 * Health: a file with no image, or whose only image is not a JPEG (kept
 * lossless, or the untouched original), has no table to read and FAILS:
 * "every JPEG is at the lowest level" is vacuously true of it.
 *
 * Pure JavaScript (pdf-lib only), like `./mono-proof.ts`, so the unit tests
 * and `scripts/worker-prove-tools.ts` ask the same question of the same
 * function.
 */
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  type PDFContext,
  type PDFObject,
} from "pdf-lib";
import type { JobResults } from "@/lib/jobs/results";
import {
  DEFAULT_IMAGE_QUALITY,
  IMAGE_QUALITY_LEVELS,
  type ImageQuality,
} from "@/lib/pdf/compress-image-quality";
import { noisePhotoPdf } from "./colour-image-pdf";
import { looksLikePdf } from "./engine";

/**
 * The proof's photo: the SMOOTH picture (gradients with grain), because
 * Ghostscript's AutoFilter may keep pure noise lossless, where no JPEG level
 * applies (`../options-proof.ts` measured that). 400 px over 3 in is about
 * 133 DPI, a few hundred KB of Flate samples: never a JPEG on the way in,
 * so any JPEG in the download was written by the worker.
 */
export function imageQualityProofPdf(): Promise<Uint8Array> {
  return noisePhotoPdf({ px: 400, inches: 3, kind: "smooth" });
}

/** The standard luminance table (T.81 Annex K.1), in natural order. */
const STD_LUMINANCE = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16,
  24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109,
  103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
] as const;

/** A DQT table is stored in zig-zag order: position k holds natural index ZIGZAG[k]. */
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40,
  48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29,
  22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54,
  47, 55, 62, 63,
] as const;

/**
 * The scale a JPEG's luminance table (table 0) was made at, relative to the
 * standard table: the median of entry / standard over the entries libjpeg
 * did not clamp (1 and 255 are clamps). `null` when the bytes are not a
 * JPEG or carry no table 0.
 */
export function jpegLuminanceScale(jpeg: Uint8Array): number | null {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= jpeg.length) {
    if (jpeg[i] !== 0xff) return null;
    const marker = jpeg[i + 1]!;
    // Fill bytes, and markers with no length (RSTn, TEM).
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    // Start of scan or end of image: no table came before it.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = (jpeg[i + 2]! << 8) | jpeg[i + 3]!;
    if (length < 2 || i + 2 + length > jpeg.length) return null;
    if (marker === 0xdb) {
      let p = i + 4;
      const end = i + 2 + length;
      while (p < end) {
        const precision = jpeg[p]! >> 4;
        const id = jpeg[p]! & 0x0f;
        const width = precision === 0 ? 1 : 2;
        if (p + 1 + 64 * width > end) return null;
        if (id === 0) {
          const ratios: number[] = [];
          for (let k = 0; k < 64; k++) {
            const at = p + 1 + k * width;
            const q =
              width === 1 ? jpeg[at]! : (jpeg[at]! << 8) | jpeg[at + 1]!;
            if (q > 1 && q < 255) ratios.push(q / STD_LUMINANCE[ZIGZAG[k]!]!);
          }
          if (ratios.length === 0) return null;
          ratios.sort((a, b) => a - b);
          return ratios[Math.floor(ratios.length / 2)]!;
        }
        p += 1 + 64 * width;
      }
    }
    i += 2 + length;
  }
  return null;
}

/** The offered level whose QFactor is nearest `scale`, on a log scale. */
export function nearestImageQuality(scale: number): ImageQuality {
  let best: ImageQuality = IMAGE_QUALITY_LEVELS[0].id;
  let bestDistance = Infinity;
  for (const level of IMAGE_QUALITY_LEVELS) {
    const distance = Math.abs(Math.log(scale) - Math.log(level.qFactor));
    if (distance < bestDistance) {
      best = level.id;
      bestDistance = distance;
    }
  }
  return best;
}

export interface ProofImage {
  /** The image's filters, outermost first (`[]` for none). */
  filters: string[];
  /** For a JPEG (DCTDecode alone): its luminance scale, or null if unreadable. */
  scale: number | null;
}

function deref(context: PDFContext, obj: PDFObject | undefined) {
  return obj instanceof PDFRef ? context.lookup(obj) : obj;
}

/** Every image XObject in the file, with its filters and JPEG scale. Throws on a non-PDF. */
export async function proofImages(bytes: Uint8Array): Promise<ProofImage[]> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const { context } = doc;
  const out: ProofImage[] = [];
  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const raw = deref(context, obj.dict.get(PDFName.of("Filter")));
    const filters =
      raw instanceof PDFName
        ? [raw.decodeText()]
        : raw instanceof PDFArray
          ? raw
              .asArray()
              .map((f) => deref(context, f))
              .flatMap((f) => (f instanceof PDFName ? [f.decodeText()] : []))
          : [];
    const jpeg = filters.length === 1 && filters[0] === "DCTDecode";
    out.push({
      filters,
      scale: jpeg ? jpegLuminanceScale(obj.contents) : null,
    });
  }
  return out;
}

/**
 * The verdict. `inputBytes` is the size of the file that was uploaded: a
 * download at or over it is the no-worse swap's original, or a run that
 * did nothing, and fails whatever its tables say.
 */
export async function imageQualityProofVerdict(
  bytes: Uint8Array,
  results: JobResults | undefined,
  want: { asked: ImageQuality; inputBytes: number },
): Promise<{ ok: boolean; detail: string }> {
  const fail = (detail: string) => ({ ok: false, detail });
  if (want.asked === DEFAULT_IMAGE_QUALITY)
    return fail(
      `"${want.asked}" is the preset's own level; a proof of it cannot tell a worker that applies the option from one that ignores it`,
    );
  if (!looksLikePdf(bytes)) return fail("the download is not a PDF");
  let images: ProofImage[];
  try {
    images = await proofImages(bytes);
  } catch (error) {
    return fail(`the download could not be read: ${(error as Error).message}`);
  }
  if (images.length === 0)
    return fail("the download has no image, so no JPEG level can be read");
  const jpegs = images.filter((i) => i.scale !== null);
  if (jpegs.length === 0)
    return fail(
      `no image in the download is a readable JPEG (filters: ${images.map((i) => i.filters.join("+") || "none").join(", ")}): it was kept lossless or is the original, so no JPEG level was applied`,
    );
  const measured = jpegs.map((i) => ({
    scale: i.scale!,
    level: nearestImageQuality(i.scale!),
  }));
  const seen = measured
    .map((m) => `${m.scale.toFixed(2)} (${m.level})`)
    .join(", ");
  const record = results?.compression?.imageQuality;
  const sizes = `${bytes.byteLength} B from ${want.inputBytes} B`;
  if (bytes.byteLength >= want.inputBytes)
    return fail(
      `${sizes}: not smaller than the input, so this is the no-worse swap's original or a run that changed nothing; JPEG scale ${seen}`,
    );
  if (record !== want.asked)
    return fail(
      `the job record's compression.imageQuality is ${record === undefined ? "absent" : `"${record}"`}, not "${want.asked}": this worker did not apply the option; JPEG scale ${seen}, ${sizes}`,
    );
  const off = measured.filter((m) => m.level !== want.asked);
  if (off.length > 0)
    return fail(
      `JPEG scale ${seen}: nearest an offered level other than "${want.asked}" (QFactor ${IMAGE_QUALITY_LEVELS.find((l) => l.id === want.asked)!.qFactor}), ${sizes}`,
    );
  return {
    ok: true,
    detail: `every JPEG at "${want.asked}" (scale ${seen}), the record says "${record}", ${sizes}`,
  };
}

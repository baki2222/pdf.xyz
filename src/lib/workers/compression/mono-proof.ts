/**
 * The black-and-white floor of deep compression, read from the file a person
 * downloads.
 *
 * Deep compression sends `-dMonoImageResolution=max(target, DEEP_MONO_MIN_DPI)`
 * (audit compress-pdf#3, 2026-11-07): a scan made in black-and-white mode is
 * never taken below 300 DPI, because at 72-150 DPI its text stops being
 * legible. An argv test proves only that we ASKED. Ghostscript decides
 * whether to downsample (its threshold), and a flag spelled for another
 * version or a profile that overrides it would hand back a 72 DPI scan while
 * every unit test stayed green. This reads the image back.
 *
 * Pure JavaScript (pdf-lib only), like `image-colour.ts`, so the unit tests
 * and the deployment harness (`scripts/worker-prove-tools.ts`) ask the same
 * question of the same function.
 */
import {
  PDFBool,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  type PDFContext,
  type PDFObject,
} from "pdf-lib";

/** US Letter, in points. The fixture's image fills the whole page. */
const PAGE = { width: 612, height: 792 } as const;

/** The fixture's resolution: twice the floor, past Ghostscript's 1.5x threshold. */
export const MONO_PROOF_SOURCE_DPI = 600;

/**
 * A one-page "scan made in black-and-white mode": one 1-bit DeviceGray image
 * drawn across the whole page at `dpi`, patterned like lines of text so
 * downsampling has something to lose. At the default 600 DPI it is twice the
 * floor, past Ghostscript's default downsample threshold (1.5×), so an engine
 * that honours the floor must hand back about 300 DPI, and one that ignores it
 * hands back the target (72 in the proof).
 */
export async function monoScanPdf(
  dpi = MONO_PROOF_SOURCE_DPI,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.width, PAGE.height]);
  const width = Math.round((PAGE.width / 72) * dpi);
  const height = Math.round((PAGE.height / 72) * dpi);
  const rowBytes = Math.ceil(width / 8);
  // 1 = white for DeviceGray at 1 bit with the default /Decode [0 1].
  const bits = new Uint8Array(rowBytes * height).fill(0xff);
  // The pattern scales with the resolution, so every fixture shows the same
  // page: a "line of text" every fourth band, "letters" with a gap every third.
  // Inside a letter, three samples in four are black, chosen by a fixed
  // xorshift sequence: scanner grain. Clean stripes deflate to a few KB, and
  // the engine then keeps the ORIGINAL because its resampled copy is not
  // smaller (the no-worse swap). The first version of this proof passed that
  // way at 600 DPI, untouched, proving nothing (2026-11-08).
  const unit = Math.max(1, Math.round(dpi / 50));
  let seed = 0x9e3779b9;
  for (let y = 0; y < height; y++) {
    if (Math.floor(y / unit) % 4 !== 1) continue;
    const row = y * rowBytes;
    for (let x = 0; x < width; x++) {
      if (Math.floor(x / unit) % 3 === 2) continue;
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      if ((seed & 3) === 0) continue;
      bits[row + (x >> 3)]! &= ~(0x80 >> (x & 7));
    }
  }
  const image = doc.context.flateStream(bits, {
    Type: "XObject",
    Subtype: "Image",
    Width: width,
    Height: height,
    ColorSpace: "DeviceGray",
    BitsPerComponent: 1,
  });
  page.node.setXObject(PDFName.of("Im0"), doc.context.register(image));
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(PAGE.width, 0, 0, PAGE.height, 0, 0),
    drawObject("Im0"),
    popGraphicsState(),
  );
  return doc.save({ useObjectStreams: false });
}

export interface MonoProofImage {
  /** Samples across. */
  width: number;
  /** Bits per component, or null when the image is a stencil mask. */
  bits: number | null;
  /** True for `/ImageMask true` (one colour painted through a 1-bit mask). */
  mask: boolean;
  /** Samples across divided by the page's width in inches. */
  dpi: number;
}

function deref(context: PDFContext, obj: PDFObject | undefined) {
  return obj instanceof PDFRef ? context.lookup(obj) : obj;
}

/**
 * Every image XObject in the file with its horizontal resolution, measured
 * against the first page's width. That is the resolution of an image drawn
 * across the whole page, which is how {@link monoScanPdf} draws it; for other
 * files the number means nothing. Throws when the bytes are not a readable PDF.
 */
export async function monoProofImages(
  bytes: Uint8Array,
): Promise<MonoProofImage[]> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const inches = doc.getPage(0).getWidth() / 72;
  const { context } = doc;
  const out: MonoProofImage[] = [];
  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream || obj instanceof PDFStream)) continue;
    const dict = obj.dict;
    if (dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const w = deref(context, dict.get(PDFName.of("Width")));
    const bpc = deref(context, dict.get(PDFName.of("BitsPerComponent")));
    const mask = deref(context, dict.get(PDFName.of("ImageMask")));
    const width = w instanceof PDFNumber ? w.asNumber() : 0;
    out.push({
      width,
      bits: bpc instanceof PDFNumber ? bpc.asNumber() : null,
      mask: mask instanceof PDFBool && mask.asBoolean(),
      dpi: Math.round(width / inches),
    });
  }
  return out;
}

/**
 * The floor, as a verdict: the file has at least one image, every image is
 * still black-and-white (1 bit, or a stencil mask), and none is below
 * `floorDpi`. A file with no images fails: "every image keeps its resolution"
 * is vacuously true of it. An image that left the 1-bit path fails too: the
 * floor applies only to black-and-white images, so a scan converted to gray
 * would be downsampled under the GRAY setting and prove nothing about this
 * one.
 */
export async function monoFloorVerdict(
  bytes: Uint8Array,
  floorDpi: number,
  /**
   * The fixture's own resolution. When given, a file whose images are ALL
   * still at it fails: the engine handed back the original (or never
   * resampled), so the floor was never exercised and the pass would be
   * vacuous.
   */
  sourceDpi?: number,
): Promise<{ ok: boolean; detail: string }> {
  let images: MonoProofImage[];
  try {
    images = await monoProofImages(bytes);
  } catch {
    return { ok: false, detail: "the output could not be read as a PDF" };
  }
  if (images.length === 0)
    return {
      ok: false,
      detail: "the output carries no images, so the floor proves nothing",
    };
  const notMono = images.filter((i) => !i.mask && i.bits !== 1);
  if (notMono.length > 0)
    return {
      ok: false,
      detail: `${notMono.length} of ${images.length} images are no longer black-and-white (bits per component: ${notMono
        .map((i) => (i.bits === null ? "unknown" : String(i.bits)))
        .join(", ")})`,
    };
  // One sample of rounding: 300 DPI across 8.5 in is 2,550 samples, and an
  // engine that rounds the width down by one still kept the resolution.
  if (
    sourceDpi !== undefined &&
    images.every((i) => Math.abs(i.dpi - sourceDpi) <= 1)
  )
    return {
      ok: false,
      detail: `every image is still at the source's ${sourceDpi} DPI: nothing was resampled, so the floor was never exercised`,
    };
  const low = images.filter((i) => i.dpi < floorDpi - 1);
  if (low.length > 0)
    return {
      ok: false,
      detail: `${low.length} of ${images.length} black-and-white images fell below ${floorDpi} DPI (${low
        .map((i) => `${i.dpi} DPI`)
        .join(", ")})`,
    };
  return {
    ok: true,
    detail: `${images.length} black-and-white image${images.length === 1 ? "" : "s"} at ${images
      .map((i) => `${i.dpi} DPI`)
      .join(", ")}, none below ${floorDpi}`,
  };
}

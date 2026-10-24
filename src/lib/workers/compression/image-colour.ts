/**
 * How many colour components each image in a PDF carries — the property a
 * Grayscale run promises, read from the file the user downloads.
 *
 * Why it exists: Ghostscript is TOLD to convert colour to gray
 * (`-sColorConversionStrategy=Gray`), and an argv test can only prove we asked.
 * A Ghostscript that ignored the flag, a flag spelled for another version, or a
 * pass-through on the no-worse swap would each hand back a colour file under a
 * "grayscale" label, and nothing about the bytes' size or page count could see
 * it. This reads every image XObject's colour space and counts its components:
 * 1 for gray, 3 for RGB, 4 for CMYK.
 *
 * Pure JavaScript (pdf-lib only), so the engine, the in-image proof and the
 * deployment harness all ask the same question of the same function.
 */
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFContext,
  type PDFObject,
} from "pdf-lib";

const DEVICE_COMPONENTS: Record<string, number> = {
  DeviceGray: 1,
  CalGray: 1,
  G: 1,
  DeviceRGB: 3,
  CalRGB: 3,
  RGB: 3,
  Lab: 3,
  DeviceCMYK: 4,
  CMYK: 4,
};

function deref(context: PDFContext, obj: PDFObject | undefined) {
  return obj instanceof PDFRef ? context.lookup(obj) : obj;
}

/**
 * Components of one colour space, or `null` when it cannot be established
 * (an unknown family, a missing /N). `null` is never read as gray.
 */
function components(
  context: PDFContext,
  raw: PDFObject | undefined,
  depth = 0,
): number | null {
  if (depth > 8) return null;
  const cs = deref(context, raw);
  if (cs instanceof PDFName) return DEVICE_COMPONENTS[cs.decodeText()] ?? null;
  if (!(cs instanceof PDFArray) || cs.size() === 0) return null;
  const family = deref(context, cs.get(0));
  if (!(family instanceof PDFName)) return null;
  switch (family.decodeText()) {
    case "ICCBased": {
      const stream = deref(context, cs.get(1));
      const dict =
        stream instanceof PDFStream
          ? stream.dict
          : stream instanceof PDFDict
            ? stream
            : null;
      const n = dict ? deref(context, dict.get(PDFName.of("N"))) : undefined;
      return n instanceof PDFNumber ? n.asNumber() : null;
    }
    // A palette's samples are indices; what a reader paints is its base.
    case "Indexed":
    case "I":
      return components(context, cs.get(1), depth + 1);
    case "Separation":
      return 1;
    case "DeviceN": {
      const names = deref(context, cs.get(1));
      return names instanceof PDFArray ? names.size() : null;
    }
    // [/CalGray <<…>>], [/CalRGB <<…>>], [/Lab <<…>>] and the rest.
    default:
      return DEVICE_COMPONENTS[family.decodeText()] ?? null;
  }
}

/**
 * One entry per image XObject in the file, in object order: its colour
 * component count, or `null` when its colour space could not be read. A
 * stencil mask (`/ImageMask true`) paints one colour through a 1-bit mask and
 * counts as 1. Throws when the bytes are not a readable PDF.
 */
export async function imageColourComponents(
  bytes: Uint8Array,
): Promise<(number | null)[]> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const { context } = doc;
  const out: (number | null)[] = [];
  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream || obj instanceof PDFStream)) continue;
    const dict = obj.dict;
    if (dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const mask = deref(context, dict.get(PDFName.of("ImageMask")));
    if (mask instanceof PDFBool && mask.asBoolean()) {
      out.push(1);
      continue;
    }
    out.push(components(context, dict.get(PDFName.of("ColorSpace"))));
  }
  return out;
}

/**
 * The Grayscale promise, as a verdict: the file has at least one image, and
 * every image is one component. A file with no images at all fails — "every
 * image is gray" is vacuously true of it, and a proof whose fixture lost its
 * picture must not pass for the wrong reason.
 */
export async function grayscaleVerdict(
  bytes: Uint8Array,
): Promise<{ ok: boolean; detail: string }> {
  let counts: (number | null)[];
  try {
    counts = await imageColourComponents(bytes);
  } catch {
    return { ok: false, detail: "the output could not be read as a PDF" };
  }
  if (counts.length === 0)
    return {
      ok: false,
      detail: "the output carries no images, so grayscale proves nothing",
    };
  const notGray = counts.filter((n) => n !== 1);
  if (notGray.length > 0)
    return {
      ok: false,
      detail: `${notGray.length} of ${counts.length} images are not one-component gray (components: ${notGray
        .map((n) => (n === null ? "unknown" : String(n)))
        .join(", ")})`,
    };
  return {
    ok: true,
    detail: `${counts.length} image${counts.length === 1 ? "" : "s"}, every one 1-component gray`,
  };
}

/**
 * True when the file still carries an image the reader can SEE is in colour
 * (more than one component). Unknown colour spaces are not counted — the
 * engine's gate refuses what it knows is wrong; the proofs, which fail on
 * unknown too, use {@link grayscaleVerdict}.
 */
export async function hasColourImage(bytes: Uint8Array): Promise<boolean> {
  const counts = await imageColourComponents(bytes);
  return counts.some((n) => n !== null && n > 1);
}

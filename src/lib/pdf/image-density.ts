/**
 * The resolution a JPEG or PNG says it was made at, for "Fit to image"
 * (audits jpg-to-pdf#4 and png-to-pdf#4, 2026-11-08).
 *
 * Until then JPEG and PNG were laid out at one pixel per point whatever they
 * said, while a TIFF was laid out at its size on paper (`tiff.ts`): the same
 * 300 dpi A4 scan came out A4 as a TIFF and 34 × 49 in as a PNG. Now a
 * plausible stored resolution sizes the Fit to image page the same way.
 *
 * Read from, in this order, the first that is plausible:
 *   JPEG  the JFIF APP0 (units 1 = per inch, 2 = per cm, X/Y density), then
 *         the Exif APP1's XResolution / YResolution (ResolutionUnit 2 = inch,
 *         3 = cm; inch when absent, as TIFF says);
 *   PNG   the pHYs chunk (unit 1 = per metre; 0 is an aspect ratio only).
 *
 * NOT plausible, so the image stays at one pixel per point
 * ({@link isPlausibleDpi}):
 *   - 72 and 96 dpi: what cameras, phones and screenshot tools write when they
 *     do not know (72 is one pixel per point already; 96 would shrink a
 *     Windows screenshot to three quarters for no reason);
 *   - under {@link MIN_PLAUSIBLE_DPI} or over {@link MAX_PLAUSIBLE_DPI}: a
 *     poster-sized or stamp-sized page from a typo in a header;
 *   - different X and Y (non-square pixels): rare, and in practice a
 *     writer's mistake rather than a request to stretch the picture.
 *
 * A LEAF: only `image-to-pdf.ts` and the tool copy import it.
 */

export const MIN_PLAUSIBLE_DPI = 50;
export const MAX_PLAUSIBLE_DPI = 2400;
/** The values software writes when it does not know the resolution. */
export const PLACEHOLDER_DPIS: readonly number[] = [72, 96];

const CM_PER_INCH = 2.54;
const M_PER_INCH = 0.0254;

/** Whether `dpi` (one axis) is a resolution worth laying a page out by. */
export function isPlausibleDpi(dpi: number): boolean {
  const rounded = Math.round(dpi);
  return (
    Number.isFinite(dpi) &&
    dpi >= MIN_PLAUSIBLE_DPI &&
    dpi <= MAX_PLAUSIBLE_DPI &&
    !PLACEHOLDER_DPIS.includes(rounded)
  );
}

/** One square resolution from an X and a Y, or undefined. */
function square(x: number, y: number): number | undefined {
  if (!isPlausibleDpi(x) || !isPlausibleDpi(y)) return undefined;
  return Math.abs(x - y) <= x * 0.01 ? x : undefined;
}

const u16 = (b: Uint8Array, at: number, le = false) =>
  le ? b[at]! | (b[at + 1]! << 8) : (b[at]! << 8) | b[at + 1]!;
const u32 = (b: Uint8Array, at: number, le = false) =>
  le
    ? (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>>
      0
    : ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>>
      0;
const ascii = (b: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...b.subarray(at, at + n));

/** A JFIF APP0 payload's density in dpi, if it gives one in real units. */
function jfifDpi(p: Uint8Array): number | undefined {
  if (p.length < 12 || ascii(p, 0, 5) !== "JFIF\0") return undefined;
  const units = p[7];
  const scale = units === 1 ? 1 : units === 2 ? CM_PER_INCH : 0;
  if (!scale) return undefined;
  return square(u16(p, 8) * scale, u16(p, 10) * scale);
}

/** An Exif APP1 payload's IFD0 X/YResolution in dpi. */
function exifDpi(p: Uint8Array): number | undefined {
  if (p.length < 14 || ascii(p, 0, 6) !== "Exif\0\0") return undefined;
  const t = p.subarray(6);
  const le = t[0] === 0x49;
  if (!le && t[0] !== 0x4d) return undefined;
  const ifd = u32(t, 4, le);
  if (ifd + 2 > t.length) return undefined;
  const count = u16(t, ifd, le);
  let x: number | undefined;
  let y: number | undefined;
  let unit = 2;
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12;
    if (at + 12 > t.length) return undefined;
    const tag = u16(t, at, le);
    if (tag === 0x0128) unit = u16(t, at + 8, le);
    if (tag === 0x011a || tag === 0x011b) {
      // RATIONAL: two LONGs at the offset the entry holds.
      const off = u32(t, at + 8, le);
      if (off + 8 > t.length) return undefined;
      const den = u32(t, off + 4, le);
      const value = den ? u32(t, off, le) / den : NaN;
      if (tag === 0x011a) x = value;
      else y = value;
    }
  }
  if (x === undefined || y === undefined) return undefined;
  const scale = unit === 2 ? 1 : unit === 3 ? CM_PER_INCH : 0;
  return scale ? square(x * scale, y * scale) : undefined;
}

function jpegDpi(b: Uint8Array): number | undefined {
  const found: { jfif?: number; exif?: number } = {};
  let at = 2;
  while (at + 4 <= b.length && b[at] === 0xff) {
    const marker = b[at + 1]!;
    // Start of scan, or a frame header: the metadata segments are behind us.
    if (
      marker === 0xda ||
      (marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc)
    )
      break;
    const length = u16(b, at + 2);
    if (length < 2) break;
    const payload = b.subarray(at + 4, at + 2 + length);
    if (marker === 0xe0 && found.jfif === undefined)
      found.jfif = jfifDpi(payload);
    if (marker === 0xe1 && found.exif === undefined)
      found.exif = exifDpi(payload);
    at += 2 + length;
  }
  return found.jfif ?? found.exif;
}

function pngDpi(b: Uint8Array): number | undefined {
  let at = 8;
  while (at + 12 <= b.length) {
    const length = u32(b, at);
    const type = ascii(b, at + 4, 4);
    if (type === "IDAT" || type === "IEND") return undefined;
    if (type === "pHYs" && length === 9 && at + 17 <= b.length) {
      if (b[at + 16] !== 1) return undefined;
      return square(u32(b, at + 8) * M_PER_INCH, u32(b, at + 12) * M_PER_INCH);
    }
    at += 12 + length;
  }
  return undefined;
}

/**
 * The plausible resolution, in dots per inch, a JPEG or PNG file states for
 * itself; undefined for any other bytes, or when it states none worth using.
 */
export function storedImageDpi(bytes: Uint8Array): number | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegDpi(bytes);
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") return pngDpi(bytes);
  return undefined;
}

/** `shown` (pixels) as points on paper at `dpi`; unchanged without one. */
export function atStoredDpi(
  shown: { width: number; height: number },
  dpi: number | undefined,
): { width: number; height: number } {
  if (!dpi) return shown;
  const k = 72 / dpi;
  return { width: shown.width * k, height: shown.height * k };
}

const orList = (items: readonly string[]) =>
  items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;

/**
 * The page copy's account of the resolutions {@link isPlausibleDpi} turns
 * down, from the same constants: "72 or 96 dpi, which … under 50 or over
 * 2,400 dpi". image-tools-w3-copy.test.ts holds every page that quotes it.
 */
export const IGNORED_DPI_COPY = `${orList(PLACEHOLDER_DPIS.map(String))} dpi, which cameras and apps write when they do not know, or one under ${MIN_PLAUSIBLE_DPI.toLocaleString("en-US")} or over ${MAX_PLAUSIBLE_DPI.toLocaleString("en-US")} dpi`;

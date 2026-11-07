/**
 * Remove a JPEG's camera and location details WITHOUT re-encoding it.
 *
 * JPG to PDF embeds each JPEG's DCT stream as it is (lossless), so until
 * 2026-11-07 everything stored beside the pixels went into the PDF with them:
 * the Exif block (camera, time, GPS coordinates, a thumbnail of the photo),
 * XMP, IPTC, comments, and the extra pictures a phone appends after the
 * image's end (MPF depth maps and previews, each with its own Exif). The FAQ
 * admitted it and told users to strip the data elsewhere.
 *
 * This walks the marker segments and copies every one the decoder needs,
 * byte for byte — quantisation and Huffman tables, the frame header, every
 * scan and its entropy-coded data, restart markers — and drops the rest:
 *
 *  - every APPn segment except a JFIF APP0, an ICC_PROFILE APP2 (the colour
 *    profile: dropping it would change how the photo's colours are shown)
 *    and an Adobe APP14 (it says whether the data is RGB, YCbCr or CMYK:
 *    dropping it would invert a CMYK photo);
 *  - COM comments;
 *  - anything after the end-of-image marker.
 *
 * The pixels cannot change: no byte the decoder reads for them is touched,
 * and jpeg-metadata.test.ts holds the kept segments to the input's.
 *
 * TOTAL, like `findOrientationTag`: it never throws. A stream whose header
 * segments cannot be walked to the first scan comes back as `null` (pdf-lib
 * cannot read such a file either); one that breaks AFTER the first scan keeps
 * its remainder as it is, with every header segment already walked.
 */

/** APPn segments kept, by marker and the identifier their payload starts with. */
const KEPT_APP: readonly { marker: number; id: string }[] = [
  { marker: 0xe0, id: "JFIF\0" },
  { marker: 0xe2, id: "ICC_PROFILE\0" },
  { marker: 0xee, id: "Adobe" },
];

const COM = 0xfe;
const SOS = 0xda;
const EOI = 0xd9;

function startsWith(bytes: Uint8Array, at: number, end: number, id: string) {
  if (end - at < id.length) return false;
  for (let i = 0; i < id.length; i++) {
    if (bytes[at + i] !== id.charCodeAt(i)) return false;
  }
  return true;
}

function isDropped(
  bytes: Uint8Array,
  marker: number,
  dataStart: number,
  segEnd: number,
) {
  if (marker === COM) return true;
  if (marker < 0xe0 || marker > 0xef) return false;
  return !KEPT_APP.some(
    (k) => k.marker === marker && startsWith(bytes, dataStart, segEnd, k.id),
  );
}

/**
 * `bytes` without its metadata segments and trailing data, or `null` when the
 * header segments cannot be walked to the first scan. Returns the same array
 * when there was nothing to remove.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array | null {
  const len = bytes.length;
  if (len < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const kept: [number, number][] = [[0, 2]];
  let dropped = false;
  let scanned = false;
  let pos = 2;
  // Past the first scan, a stream that stops making sense (a truncated file,
  // junk between scans) keeps the rest as it is: every header segment before
  // the image data, where cameras write their details, has been walked.
  const giveUp = () => {
    if (!scanned) return true;
    kept.push([pos, len]);
    return false;
  };
  walk: for (;;) {
    if (pos + 2 > len || bytes[pos] !== 0xff) {
      if (giveUp()) return null;
      break;
    }
    const marker = bytes[pos + 1]!;
    if (marker === 0xff) {
      // Fill byte before a marker: kept, so the stream stays as written.
      kept.push([pos, pos + 1]);
      pos += 1;
      continue;
    }
    if (marker === EOI) {
      kept.push([pos, pos + 2]);
      if (pos + 2 < len) dropped = true;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push([pos, pos + 2]);
      pos += 2;
      continue;
    }
    const segLen = pos + 4 > len ? 0 : (bytes[pos + 2]! << 8) | bytes[pos + 3]!;
    const segEnd = pos + 2 + segLen;
    if (segLen < 2 || segEnd > len) {
      if (giveUp()) return null;
      break;
    }
    if (isDropped(bytes, marker, pos + 4, segEnd)) {
      dropped = true;
      pos = segEnd;
      continue;
    }
    if (marker !== SOS) {
      kept.push([pos, segEnd]);
      pos = segEnd;
      continue;
    }
    // A scan: its header, then entropy-coded data up to the next marker that
    // is not a stuffed zero (FF00) or a restart (FFD0-FFD7).
    scanned = true;
    let at = segEnd;
    for (;;) {
      if (at + 1 >= len) {
        kept.push([pos, len]);
        break walk;
      }
      if (bytes[at] === 0xff) {
        const next = bytes[at + 1]!;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          at += 2;
          continue;
        }
        if (next !== 0xff) break;
      }
      at += 1;
    }
    kept.push([pos, at]);
    pos = at;
  }
  if (!dropped) return bytes;
  const size = kept.reduce((n, [a, b]) => n + b - a, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const [a, b] of kept) {
    out.set(bytes.subarray(a, b), at);
    at += b - a;
  }
  return out;
}

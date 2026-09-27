/**
 * JPEG fixtures for the EXIF Orientation tests, and the splicer that makes the
 * rest of them.
 *
 * The two base64 files were written by libvips (sharp 0.34.5) — not by the
 * code under test, and not by the splicer below — so the parser is checked
 * against a real writer's APP1 at least once:
 *
 *   JPEG_30X20        30×20 baseline JPEG, no APP segments at all. Stored
 *                     pixels: a red 10×10 block top-left, a blue 10×10 block
 *                     bottom-right, white elsewhere.
 *   JPEG_30X20_EXIF6  the same pixels saved with `withMetadata({orientation:
 *                     6})`: a little-endian ("II") Exif APP1 of six IFD0
 *                     entries. libvips also wrote an ICC APP2, removed here
 *                     (to keep the fixture small) by cutting that one
 *                     segment; sharp still decodes the result as 30×20,
 *                     orientation 6, and its auto-rotate puts the red block
 *                     top-RIGHT on a 20×30 image.
 *
 * Non-square on purpose: on a square image a quarter turn and no turn produce
 * the same box, and the defect this exists for is exactly a quarter turn.
 */
import type { ExifOrientation } from "@/lib/pdf/jpeg-orientation";

const b64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

export const JPEG_WIDTH = 30;
export const JPEG_HEIGHT = 20;

export const JPEG_30X20 = b64(
  "/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAUAB4DASIAAhEBAxEB/8QAGAABAQEBAQAAAAAAAAAAAAAAAAcGAwX/xAAvEAABAgMDCAsAAAAAAAAAAAAAAQQCAxEFEhMGBxUWISOj0jEyNkVRVFWCg7LC/8QAFwEBAQEBAAAAAAAAAAAAAAAABQQCBv/EACIRAAEEAQIHAAAAAAAAAAAAAAEAAgMRBQRRITI0YXGBsf/aAAwDAQACEQMRAD8Az5U8jOyzP3/eIao2D5DjTOY9Rk0bsGsDVpLw5MFbsNVWlVqu1dvSpLDC6N1lOZPJxaqIMYDd3xrY913Bi84lu2nYujtGOcDGxb+7hirS7TrIvipi9espvUuBL5R7TYifURCVhFHe/GyAMgBpWgABa2p1nb7p+b8E5AO2xHRs9/SppOYr/9k=",
);

export const JPEG_30X20_EXIF6 = b64(
  "/9j/4QC8RXhpZgAASUkqAAgAAAAGABIBAwABAAAABgAAABoBBQABAAAAVgAAABsBBQABAAAAXgAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAGmHBAABAAAAZgAAAAAAAAA4YwAA6AMAADhjAADoAwAABgAAkAcABAAAADAyMTABkQcABAAAAAECAwAAoAcABAAAADAxMDABoAMAAQAAAP//AAACoAQAAQAAAB4AAAADoAQAAQAAABQAAAAAAAAA/9sAQwANCQoLCggNCwoLDg4NDxMgFRMSEhMnHB4XIC4pMTAuKS0sMzpKPjM2RjcsLUBXQUZMTlJTUjI+WmFaUGBKUVJP/9sAQwEODg4TERMmFRUmTzUtNU9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09P/8AAEQgAFAAeAwEiAAIRAQMRAf/EABgAAQEBAQEAAAAAAAAAAAAAAAAHBgMF/8QALxAAAQIDAwgLAAAAAAAAAAAAAAEEAgMRBRITBgcVFiEjo9IxMjZFUVRVgoOywv/EABcBAQEBAQAAAAAAAAAAAAAAAAUEAgb/xAAiEQABBAECBwAAAAAAAAAAAAABAAIDEQUEUSEyNGFxgbH/2gAMAwEAAhEDEQA/AM+VPIzssz9/3iGqNg+Q40zmPUZNG7BrA1aS8OTBW7DVVpVartXb0qSwwujdZTmTycWqiDGA3d8a2PddwYvOJbtp2Lo7RjnAxsW/u4Yq0u06yL4qYvXrKb1LgS+Ue02In1EQlYRR3vxsgDIAaVoAAWtqdZ2+6fm/BOQDtsR0bPf0qaTmK//Z",
);

/** One JPEG segment: marker byte and payload (without the length field). */
function segment(marker: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  out[0] = 0xff;
  out[1] = marker;
  const len = payload.length + 2;
  out[2] = len >> 8;
  out[3] = len & 0xff;
  out.set(payload, 4);
  return out;
}

/**
 * An Exif APP1 whose IFD0 holds an unrelated entry (ImageWidth) and THEN the
 * Orientation — so a reader that only looks at the first entry is caught.
 */
export function exifApp1(
  orientation: number,
  { bigEndian = false }: { bigEndian?: boolean } = {},
): Uint8Array {
  const tiff = new Uint8Array(8 + 2 + 2 * 12 + 4);
  const view = new DataView(tiff.buffer);
  const le = !bigEndian;
  tiff[0] = tiff[1] = bigEndian ? 0x4d : 0x49;
  view.setUint16(2, 42, le);
  view.setUint32(4, 8, le);
  view.setUint16(8, 2, le);
  // entry 0: ImageWidth (0x0100) LONG 1 = 30
  view.setUint16(10, 0x0100, le);
  view.setUint16(12, 4, le);
  view.setUint32(14, 1, le);
  view.setUint32(18, 30, le);
  // entry 1: Orientation (0x0112) SHORT 1
  view.setUint16(22, 0x0112, le);
  view.setUint16(24, 3, le);
  view.setUint32(26, 1, le);
  view.setUint16(30, orientation, le);
  // next IFD: none
  view.setUint32(34, 0, le);
  const header = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0]);
  const payload = new Uint8Array(header.length + tiff.length);
  payload.set(header);
  payload.set(tiff, header.length);
  return segment(0xe1, payload);
}

/** A JFIF APP0, the segment most real files carry before their Exif APP1. */
export const JFIF_APP0 = segment(
  0xe0,
  new Uint8Array([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
);

/** An XMP APP1 — an APP1 that is NOT Exif and must be walked past. */
export const XMP_APP1 = segment(
  0xe1,
  new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>"),
);

/** `jpeg` with `segments` inserted right after SOI. */
export function spliceAfterSoi(
  jpeg: Uint8Array,
  ...segments: Uint8Array[]
): Uint8Array {
  const extra = segments.reduce((n, s) => n + s.length, 0);
  const out = new Uint8Array(jpeg.length + extra);
  out.set(jpeg.subarray(0, 2));
  let at = 2;
  for (const s of segments) {
    out.set(s, at);
    at += s.length;
  }
  out.set(jpeg.subarray(2), at);
  return out;
}

/** The 30×20 fixture carrying `orientation`, after a JFIF APP0 and an XMP APP1. */
export function jpegWithOrientation(
  orientation: ExifOrientation,
  opts: { bigEndian?: boolean } = {},
): Uint8Array {
  return spliceAfterSoi(
    JPEG_30X20,
    JFIF_APP0,
    XMP_APP1,
    exifApp1(orientation, opts),
  );
}

/**
 * Walk the marker segments from SOI to SOS and return their markers; throws on
 * a length that runs off the end. The health check for every spliced fixture:
 * a splice that broke the segment chain would make the parser's "1" a
 * correct answer about a broken file rather than a result.
 */
export function jpegSegmentMarkers(bytes: Uint8Array): number[] {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("no SOI");
  const markers: number[] = [];
  let pos = 2;
  for (;;) {
    if (pos + 4 > bytes.length || bytes[pos] !== 0xff) {
      throw new Error(`broken segment chain at ${pos}`);
    }
    const marker = bytes[pos + 1]!;
    markers.push(marker);
    if (marker === 0xda) return markers;
    const len = (bytes[pos + 2]! << 8) | bytes[pos + 3]!;
    pos += 2 + len;
  }
}

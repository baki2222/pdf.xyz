import { describe, expect, it } from "vitest";
import {
  exifApp1,
  JFIF_APP0,
  JPEG_30X20,
  JPEG_30X20_EXIF6,
  jpegSegmentMarkers,
  spliceAfterSoi,
  XMP_APP1,
} from "@/tests/jpeg-fixtures";
import { readJpegOrientation } from "./jpeg-orientation";
import { stripJpegMetadata } from "./jpeg-metadata";

/** One segment: marker and payload (the length field is written here). */
function seg(marker: number, payload: Uint8Array | string): Uint8Array {
  const body =
    typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  const out = new Uint8Array(4 + body.length);
  out.set([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff]);
  out.set(body, 4);
  return out;
}

const GPS = "GPS 23.8103N 90.4125E";
const ICC_APP2 = seg(0xe2, "ICC_PROFILE\0\x01\x01profile");
const MPF_APP2 = seg(0xe2, "MPF\0 pointer to a second image");
const IPTC_APP13 = seg(0xed, `Photoshop 3.0\0${GPS}`);
const ADOBE_APP14 = seg(
  0xee,
  new Uint8Array([0x41, 0x64, 0x6f, 0x62, 0x65, 0, 100, 0, 0, 0, 0, 1]),
);
const COMMENT = seg(0xfe, `taken at ${GPS}`);
const GPS_EXIF = (() => {
  // An Exif APP1 whose payload also carries a recognisable GPS string.
  const exif = exifApp1(6);
  const extra = new TextEncoder().encode(GPS);
  const payload = new Uint8Array(exif.length - 4 + extra.length);
  payload.set(exif.subarray(4));
  payload.set(extra, exif.length - 4);
  return seg(0xe1, payload);
})();

const contains = (hay: Uint8Array, needle: string) =>
  Buffer.from(hay).includes(Buffer.from(needle, "latin1"));

/** The bytes from the first DQT on: what the decoder reads for the pixels. */
const imageData = (jpeg: Uint8Array) => {
  const at = Buffer.from(jpeg).indexOf(Buffer.from([0xff, 0xdb]));
  expect(at).toBeGreaterThan(0);
  const end = Buffer.from(jpeg).lastIndexOf(Buffer.from([0xff, 0xd9]));
  return Buffer.from(jpeg.subarray(at, end + 2));
};

describe("stripJpegMetadata", () => {
  const phone = spliceAfterSoi(
    JPEG_30X20,
    JFIF_APP0,
    GPS_EXIF,
    XMP_APP1,
    ICC_APP2,
    MPF_APP2,
    IPTC_APP13,
    ADOBE_APP14,
    COMMENT,
  );
  // A phone appends a second picture (with its own Exif) after the end.
  const trailing = spliceAfterSoi(JPEG_30X20, GPS_EXIF);
  const withTrailer = new Uint8Array(phone.length + trailing.length);
  withTrailer.set(phone);
  withTrailer.set(trailing, phone.length);

  it("health check: the fixture carries every segment and the GPS text", () => {
    expect(jpegSegmentMarkers(withTrailer)).toEqual(
      expect.arrayContaining([0xe0, 0xe1, 0xe2, 0xed, 0xee, 0xfe, 0xdb, 0xda]),
    );
    expect(contains(withTrailer, GPS)).toBe(true);
    expect(readJpegOrientation(withTrailer)).toBe(6);
  });

  it("removes Exif, XMP, IPTC, MPF, comments and the trailing picture", () => {
    const out = stripJpegMetadata(withTrailer)!;
    expect(out).not.toBeNull();
    expect(contains(out, GPS)).toBe(false);
    expect(contains(out, "Exif")).toBe(false);
    expect(contains(out, "xap/1.0")).toBe(false);
    expect(contains(out, "MPF")).toBe(false);
    const markers = jpegSegmentMarkers(out);
    expect(markers).not.toContain(0xe1);
    expect(markers).not.toContain(0xed);
    expect(markers).not.toContain(0xfe);
    // Exactly one image: the file ends at the first picture's EOI.
    expect([out[out.length - 2], out[out.length - 1]]).toEqual([0xff, 0xd9]);
    expect(out.length).toBe(
      phone.length -
        GPS_EXIF.length -
        XMP_APP1.length -
        MPF_APP2.length -
        IPTC_APP13.length -
        COMMENT.length,
    );
  });

  it("keeps the colour segments and every byte of the image data", () => {
    const out = stripJpegMetadata(withTrailer)!;
    expect(contains(out, "JFIF")).toBe(true);
    expect(contains(out, "ICC_PROFILE")).toBe(true);
    expect(contains(out, "Adobe")).toBe(true);
    expect(imageData(out).equals(imageData(JPEG_30X20))).toBe(true);
  });

  it("returns the same bytes when there is nothing to remove", () => {
    expect(stripJpegMetadata(JPEG_30X20)).toBe(JPEG_30X20);
  });

  it("strips a real writer's (libvips) Exif", () => {
    const out = stripJpegMetadata(JPEG_30X20_EXIF6)!;
    expect(jpegSegmentMarkers(out)).not.toContain(0xe1);
    expect(imageData(out).equals(imageData(JPEG_30X20_EXIF6))).toBe(true);
  });

  it("strips the headers of a file cut short in its image data", () => {
    const cut = phone.subarray(0, phone.length - 6);
    const out = stripJpegMetadata(cut)!;
    expect(contains(out, GPS)).toBe(false);
    expect(
      Buffer.from(out).subarray(-10).equals(Buffer.from(cut).subarray(-10)),
    ).toBe(true);
  });

  it("is total: junk is null, never a throw", () => {
    expect(stripJpegMetadata(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
    expect(
      stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff])),
    ).toBeNull();
  });
});

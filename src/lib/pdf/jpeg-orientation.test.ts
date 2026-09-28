/**
 * The EXIF Orientation reader and the page matrix, each against something it
 * did not write.
 *
 *  - The reader is checked against a real writer (libvips' Exif APP1, in
 *    `JPEG_30X20_EXIF6`) and against spliced headers in BOTH byte orders,
 *    behind the APP0/JFIF and XMP APP1 segments real files carry first.
 *  - The matrix is checked against `displayedGrid`, which builds what a browser
 *    shows from pixel-grid flips and turns — no table shared with the product.
 *
 * Why it matters: a portrait phone photo is landscape pixels plus Orientation
 * 6. The browser previews it upright; PNG/JPG to PDF put the raw pixels on the
 * page, so the PDF came out lying on its side.
 */
import { describe, expect, it } from "vitest";
import {
  orientationMatrix,
  readJpegOrientation,
  swapsAxes,
  uprightJpeg,
  type ExifOrientation,
} from "./jpeg-orientation";
import {
  JFIF_APP0,
  JPEG_30X20,
  JPEG_30X20_EXIF6,
  JPEG_HEIGHT,
  JPEG_WIDTH,
  XMP_APP1,
  exifApp1,
  jpegSegmentMarkers,
  jpegWithOrientation,
  spliceAfterSoi,
} from "@/tests/jpeg-fixtures";
import { displayedGrid, placementMismatches } from "@/tests/exif-display";

const ORIENTATIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

describe("fixture health", () => {
  it("every spliced fixture is still an intact JPEG segment chain", () => {
    // A splice that broke the chain would make the reader's "1" a correct
    // answer about a broken file — a green for the wrong reason.
    const plain = jpegSegmentMarkers(JPEG_30X20);
    expect(plain.at(-1)).toBe(0xda);
    for (const o of ORIENTATIONS) {
      for (const bigEndian of [false, true]) {
        const markers = jpegSegmentMarkers(
          jpegWithOrientation(o, { bigEndian }),
        );
        expect(markers).toEqual([0xe0, 0xe1, 0xe1, ...plain]);
      }
    }
    expect(jpegSegmentMarkers(JPEG_30X20_EXIF6)[0]).toBe(0xe1);
  });
});

describe("readJpegOrientation", () => {
  it("reads a real writer's Exif APP1 (libvips, little-endian)", () => {
    expect(readJpegOrientation(JPEG_30X20_EXIF6)).toBe(6);
  });

  it("reads every orientation, in both byte orders, behind JFIF and XMP", () => {
    for (const o of ORIENTATIONS) {
      expect(readJpegOrientation(jpegWithOrientation(o))).toBe(o);
      expect(
        readJpegOrientation(jpegWithOrientation(o, { bigEndian: true })),
      ).toBe(o);
    }
  });

  it("reads 1 when there is no Exif APP1 at all", () => {
    expect(readJpegOrientation(JPEG_30X20)).toBe(1);
    expect(readJpegOrientation(spliceAfterSoi(JPEG_30X20, XMP_APP1))).toBe(1);
    expect(readJpegOrientation(spliceAfterSoi(JPEG_30X20, JFIF_APP0))).toBe(1);
  });

  it("takes the first Exif APP1, as the browser does", () => {
    const two = spliceAfterSoi(JPEG_30X20, exifApp1(8), exifApp1(3));
    expect(readJpegOrientation(two)).toBe(8);
  });

  it("reads out-of-range values as 1", () => {
    for (const value of [0, 9, 0xffff]) {
      expect(
        readJpegOrientation(spliceAfterSoi(JPEG_30X20, exifApp1(value))),
      ).toBe(1);
    }
  });

  it("never throws and never reads a value off a truncated header", () => {
    // Every prefix of a file with Orientation 6: a prefix that ends before the
    // whole APP1 is inside the buffer must read as 1 — the APP1's declared
    // length runs off the end — and nothing may throw. A throw here would turn
    // a photo that converts today into a failed job.
    const whole = jpegWithOrientation(6, { bigEndian: true });
    const app1End = 2 + JFIF_APP0.length + XMP_APP1.length + exifApp1(6).length;
    for (let n = 0; n <= whole.length; n++) {
      const got = readJpegOrientation(whole.subarray(0, n));
      expect(got).toBe(n >= app1End ? 6 : 1);
    }
  });

  it("reads 1 from garbage in the TIFF header rather than throwing", () => {
    const app1 = exifApp1(6);
    const tiff = 4 + 6; // marker+length, then "Exif\0\0"
    const corrupt = (at: number, value: number) => {
      const copy = app1.slice();
      copy[at] = value;
      return readJpegOrientation(spliceAfterSoi(JPEG_30X20, copy));
    };
    expect(corrupt(tiff, 0x58)).toBe(1); // byte order neither II nor MM
    expect(corrupt(tiff + 2, 43)).toBe(1); // magic 42 broken
    expect(corrupt(tiff + 4, 0xf0)).toBe(1); // IFD0 offset beyond the segment
    expect(corrupt(tiff + 8, 0)).toBe(1); // IFD0 claims no entries
    expect(corrupt(tiff + 8 + 2 + 12 + 2, 4)).toBe(1); // type LONG, not SHORT
    expect(corrupt(tiff + 8 + 2 + 12 + 4, 2)).toBe(1); // count 2, not 1
    // Positive control for the helper itself: changing a byte the tag does not
    // live in (ImageWidth's value) keeps 6, so the reds above are the tag's.
    expect(corrupt(tiff + 8 + 2 + 8, 99)).toBe(6);
  });
});

describe("uprightJpeg", () => {
  it("returns the SAME bytes when there is no turn to make", () => {
    expect(uprightJpeg(JPEG_30X20).bytes).toBe(JPEG_30X20);
    const one = jpegWithOrientation(1);
    expect(uprightJpeg(one)).toEqual({ orientation: 1, bytes: one });
  });

  it("rewrites the tag to 1 on a copy, two bytes and nothing else", () => {
    for (const o of ORIENTATIONS.filter((n) => n !== 1)) {
      for (const bigEndian of [false, true]) {
        const input = jpegWithOrientation(o, { bigEndian });
        const before = input.slice();
        const out = uprightJpeg(input);
        expect(out.orientation).toBe(o);
        expect(out.bytes).not.toBe(input);
        expect(input).toEqual(before); // the caller's bytes are untouched
        expect(out.bytes.length).toBe(input.length);
        const changed = [...out.bytes.keys()].filter(
          (i) => out.bytes[i] !== input[i],
        );
        expect(changed.length).toBeGreaterThan(0);
        expect(changed.length).toBeLessThanOrEqual(2);
        expect(readJpegOrientation(out.bytes)).toBe(1);
        expect(jpegSegmentMarkers(out.bytes)).toEqual(
          jpegSegmentMarkers(input),
        );
      }
    }
    const real = uprightJpeg(JPEG_30X20_EXIF6);
    expect(real.orientation).toBe(6);
    expect(readJpegOrientation(real.bytes)).toBe(1);
  });
});

describe("orientationMatrix", () => {
  const drawnWith = (matrixFor: ExifOrientation, shownAs: ExifOrientation) => {
    const [cols, rows] = [
      displayedGrid(JPEG_WIDTH, JPEG_HEIGHT, shownAs)[0]!.length,
      displayedGrid(JPEG_WIDTH, JPEG_HEIGHT, shownAs).length,
    ];
    // A display-shaped box, deliberately not at the origin.
    const box = { x: 50, y: 70, width: cols * 3, height: rows * 3 };
    return placementMismatches(
      {
        page: 0,
        ctm: orientationMatrix(matrixFor, box),
        width: JPEG_WIDTH,
        height: JPEG_HEIGHT,
        fillOpacity: undefined,
      },
      shownAs,
    );
  };

  it("shows every orientation the way the browser does", () => {
    for (const o of ORIENTATIONS) expect(drawnWith(o, o)).toEqual([]);
  });

  it("POSITIVE CONTROL: each matrix is wrong for every OTHER orientation", () => {
    // The checker can tell all eight apart; a checker that passed everything
    // would make the test above worthless. The pair that shipped — no turn at
    // all (matrix 1) for a phone photo (6) — is the first case.
    expect(drawnWith(1, 6).length).toBeGreaterThan(0);
    for (const m of ORIENTATIONS) {
      for (const o of ORIENTATIONS) {
        if (m !== o) expect(drawnWith(m, o).length).toBeGreaterThan(0);
      }
    }
  });

  it("swaps axes exactly for the quarter turns", () => {
    for (const o of ORIENTATIONS) {
      const shown = displayedGrid(JPEG_WIDTH, JPEG_HEIGHT, o);
      expect(swapsAxes(o)).toBe(shown.length === JPEG_WIDTH);
    }
  });
});

// @vitest-environment node
/**
 * The page marker's own facts: its length (the unit every sizing and budget
 * figure in `./chunking` is in), its alphabet, and the collision rule.
 */
import { describe, expect, it } from "vitest";
import { PAGE_JOIN } from "@/lib/pdf/text";
import {
  MARKER_COLLISION,
  collidesWithMarker,
  markerFor,
  separatorFor,
  separatorOverhead,
} from "./page-markers";

const fromCodes = (...codes: number[]): string =>
  String.fromCodePoint(...codes);

describe("page-markers", () => {
  it("separatorFor(n) is 22 + digits(n) characters, and its overhead 20 + digits(n)", () => {
    for (const n of [1, 9, 10, 99, 100, 9999]) {
      expect(separatorFor(n).length, `n = ${n}`).toBe(22 + String(n).length);
      expect(separatorOverhead(n), `n = ${n}`).toBe(20 + String(n).length);
      expect(separatorFor(n)).toBe(PAGE_JOIN + markerFor(n) + PAGE_JOIN);
    }
  });

  it("markerFor never holds a character outside printable ASCII", () => {
    for (const n of [1, 7, 42, 123, 9999, 123456]) {
      const marker = markerFor(n);
      for (const c of marker) {
        const code = c.codePointAt(0)!;
        expect(code >= 0x20 && code <= 0x7e, `${marker}: ${code}`).toBe(true);
      }
      expect(marker).toContain(String(n));
    }
  });

  it("MARKER_COLLISION catches the brand in any case, and not a spaced 'pdf xyz'", () => {
    for (const hit of ["pdfxyz", "PDFXYZ", "PdfXyz", "see pdfxyz.com"])
      expect(MARKER_COLLISION.test(hit), hit).toBe(true);
    for (const miss of ["pdf xyz", "pdf-xyz", "pdf.xyz", ""])
      expect(MARKER_COLLISION.test(miss), miss).toBe(false);
    // A marker collides with itself: a page quoting one is sent unmarked.
    expect(MARKER_COLLISION.test(markerFor(2))).toBe(true);
  });

  it("the collision rule reads the NFKC form: a full-width brand collides", () => {
    // U+FF30 U+FF24 U+FF26 U+FF38 U+FF39 U+FF3A: full-width P D F X Y Z.
    const fullWidth = fromCodes(0xff30, 0xff24, 0xff26, 0xff38, 0xff39, 0xff3a);
    expect(MARKER_COLLISION.test(fullWidth), "raw is blind to it").toBe(false);
    expect(collidesWithMarker(fullWidth)).toBe(true);
    expect(collidesWithMarker("pdf xyz")).toBe(false);
  });
});

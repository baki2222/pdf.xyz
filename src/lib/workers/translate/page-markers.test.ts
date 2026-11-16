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
  foldForMarker,
  markerFor,
  separatorFor,
  separatorOverhead,
} from "./page-markers";
import { readPageMarkers } from "./page-map";

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

  // HISTORY (2026-11-16, review minor 1): this test once read "MARKER_COLLISION
  // catches the brand in any case, and not a spaced 'pdf xyz'", and asserted
  // "pdf xyz" did NOT collide. That pinned a hole: the reader then knew
  // nothing of a broken brand, so a model writing "<<<PDF XYZ_PAGE_2>>>"
  // shipped it visibly while P5's /pdfxyz/i passed. The reader now strips a
  // brand broken by whitespace or a format character, so the collision rule
  // must catch the same spelling in a document, or the reader would strip the
  // document's own "PDF XYZ". Inverted, not deleted. Punctuation still breaks
  // the brand: "pdf.xyz" is this product's name and stays ordinary text.
  it("MARKER_COLLISION catches the brand in any case, broken by whitespace or a format character, and not by punctuation", () => {
    for (const hit of [
      "pdfxyz",
      "PDFXYZ",
      "PdfXyz",
      "see pdfxyz.com",
      "pdf xyz",
      "PDF  XYZ",
      `PDF${fromCodes(0x200b)}XYZ`, // zero-width space
      `PD${fromCodes(0x00ad)}FXYZ`, // soft hyphen
      `PDF${fromCodes(0x00a0)}XYZ`, // no-break space
      `P${fromCodes(0x200d)}D F${fromCodes(0x2060)}X Y Z`,
      `PDF${fromCodes(10)}XYZ`,
    ])
      expect(MARKER_COLLISION.test(hit), JSON.stringify(hit)).toBe(true);
    for (const miss of [
      "pdf-xyz",
      "pdf.xyz",
      "PDF",
      "XYZ",
      "PDF and XYZ",
      "pdf, xyz",
      "",
    ])
      expect(MARKER_COLLISION.test(miss), miss).toBe(false);
    // A marker collides with itself: a page quoting one is sent unmarked.
    expect(MARKER_COLLISION.test(markerFor(2))).toBe(true);
  });

  it("the collision rule reads the folded form: a full-width brand collides", () => {
    // U+FF30 U+FF24 U+FF26 U+FF38 U+FF39 U+FF3A: full-width P D F X Y Z.
    const fullWidth = fromCodes(0xff30, 0xff24, 0xff26, 0xff38, 0xff39, 0xff3a);
    expect(MARKER_COLLISION.test(fullWidth), "raw is blind to it").toBe(false);
    expect(collidesWithMarker(fullWidth)).toBe(true);
    // Inverted with the test above (history there): a spaced brand collides.
    expect(collidesWithMarker("pdf xyz")).toBe(true);
    expect(collidesWithMarker("pdf.xyz")).toBe(false);
  });

  it("the collision rule folds per CHARACTER, as the reader does: a brand followed by a combining mark collides", () => {
    // "pdfxyz" + U+0301 COMBINING ACUTE ACCENT. A whole-string NFKC composes
    // z + acute into U+017A and hides the brand; the reader folds each
    // character alone and so finds "pdfxyz" and would strip it. Judged with
    // the whole-string form this page was marked, and its own text stripped.
    const combining = `pdfxyz${fromCodes(0x0301)}`;
    expect(
      /pdfxyz/i.test(combining.normalize("NFKC")),
      "health: the whole-string form really hides it",
    ).toBe(false);
    expect(foldForMarker(combining)).toBe(combining);
    expect(collidesWithMarker(combining)).toBe(true);
    // And the reader strips exactly that spelling in a marked chunk's reply,
    // so the two sides agree on it.
    expect(
      readPageMarkers(`A ${combining} B`, [1, 2]).text.includes("pdfxyz"),
    ).toBe(false);
  });

  it("one fold for both sides: every string the reader strips a brand from, the collision rule catches", () => {
    // The same corpus through both: whatever readPageMarkers removes a brand
    // from (its text changed and lost the brand), collidesWithMarker flags.
    const corpus = [
      "pdfxyz",
      `PDF${fromCodes(0x200b)}XYZ`,
      `PD${fromCodes(0x00ad)}FXYZ`,
      `PDF${fromCodes(0x00a0)}XYZ`,
      "PDF XYZ",
      `pdfxyz${fromCodes(0x0301)}`,
      fromCodes(0xff30, 0xff24, 0xff26, 0xff38, 0xff39, 0xff3a),
      `pd${fromCodes(0x0066, 0x0307)}xyz`, // f + combining dot above
      "pdf.xyz",
      "PDF and XYZ",
      "pdf-xyz",
    ];
    let stripped = 0;
    for (const text of corpus) {
      const line = `Before ${text} after`;
      const out = readPageMarkers(line, [1, 2]).text;
      if (out !== line) {
        stripped += 1;
        expect(collidesWithMarker(line), JSON.stringify(text)).toBe(true);
      } else {
        expect(collidesWithMarker(line), JSON.stringify(text)).toBe(false);
      }
    }
    // Health: both directions are exercised.
    expect(stripped).toBeGreaterThanOrEqual(7);
    expect(corpus.length - stripped).toBeGreaterThanOrEqual(3);
  });
});

import { describe, expect, it } from "vitest";
import { sniffPdf } from "./pdf";

const enc = (s: string) => new TextEncoder().encode(s);
/** Windows wide enough to see the whole of any tiny synthetic buffer. */
const WIDE = { pdfHeaderScanBytes: 1024, pdfTrailerScanBytes: 1024 };

describe("sniffPdf", () => {
  it("flags an empty buffer", () => {
    expect(sniffPdf(new Uint8Array(0), WIDE)).toEqual({
      empty: true,
      hasHeader: false,
      hasEof: false,
    });
  });

  it("recognizes a well-formed tiny PDF envelope", () => {
    const pdf = enc("%PDF-1.7\n1 0 obj\n<< >>\nendobj\ntrailer\n%%EOF\n");
    expect(sniffPdf(pdf, WIDE)).toEqual({
      empty: false,
      hasHeader: true,
      hasEof: true,
    });
  });

  it("detects a header without a trailer", () => {
    const sniff = sniffPdf(enc("%PDF-1.4\nbody with no end marker"), WIDE);
    expect(sniff.hasHeader).toBe(true);
    expect(sniff.hasEof).toBe(false);
  });

  it("detects a trailer without a header", () => {
    const sniff = sniffPdf(enc("plain text then %%EOF"), WIDE);
    expect(sniff.hasHeader).toBe(false);
    expect(sniff.hasEof).toBe(true);
  });

  it("finds a header that is not at offset 0 but within the window", () => {
    expect(sniffPdf(enc("\n\n%PDF-1.5\n%%EOF"), WIDE).hasHeader).toBe(true);
  });

  it("does not find a header pushed beyond the leading window", () => {
    const buf = enc("XXXXXXXXXX%PDF-1.7 rest %%EOF");
    const sniff = sniffPdf(buf, {
      pdfHeaderScanBytes: 8,
      pdfTrailerScanBytes: 1024,
    });
    expect(sniff.hasHeader).toBe(false); // header lives at offset 10, window is 8
    expect(sniff.hasEof).toBe(true); // trailer still visible in the wide trailing window
  });

  it("does not find a trailer outside the trailing window (bounded scan)", () => {
    // The only %%EOF sits at the start; a narrow trailing window can't reach it.
    const buf = enc("%%EOF" + "Y".repeat(40));
    expect(
      sniffPdf(buf, { pdfHeaderScanBytes: 1024, pdfTrailerScanBytes: 8 })
        .hasEof,
    ).toBe(false);
    expect(sniffPdf(buf, WIDE).hasEof).toBe(true);
  });

  it("tolerates a window larger than the buffer", () => {
    const sniff = sniffPdf(enc("%PDF-\n%%EOF"), {
      pdfHeaderScanBytes: 1_000_000,
      pdfTrailerScanBytes: 1_000_000,
    });
    expect(sniff).toEqual({ empty: false, hasHeader: true, hasEof: true });
  });
});

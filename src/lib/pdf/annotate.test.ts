import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { PdfEngineError } from "./engine";
import {
  annotatePdf,
  annotatedOutputName,
  arrowHeadSegments,
  clampOpacity,
  getAnnotatePageSizes,
  isValidHexColor,
  isWinAnsiEncodable,
  parseHexColor,
  sanitizeNoteText,
  validateAnnotations,
  wrapText,
  type Annotation,
  type PageSize,
} from "./annotate";

/** A blank PDF with the given page sizes (points). */
async function blankPdf(sizes: [number, number][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const [w, h] of sizes) doc.addPage([w, h]);
  return doc.save();
}

describe("annotatedOutputName", () => {
  it("derives the name from the source file", () => {
    expect(annotatedOutputName("report.pdf")).toBe("report-annotated.pdf");
    expect(annotatedOutputName("")).toBe("document-annotated.pdf");
  });
});

describe("parseHexColor / isValidHexColor", () => {
  it("parses #rrggbb into 0–1 channels", () => {
    expect(parseHexColor("#ffffff")).toEqual({ r: 1, g: 1, b: 1 });
    expect(parseHexColor("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHexColor("#ff0000")).toEqual({ r: 1, g: 0, b: 0 });
  });

  it("accepts shorthand #rgb and a missing leading #", () => {
    expect(parseHexColor("#fff")).toEqual({ r: 1, g: 1, b: 1 });
    expect(parseHexColor("0080ff")).toEqual({ r: 0, g: 128 / 255, b: 1 });
  });

  it("rejects invalid colors", () => {
    for (const bad of ["", "#12", "#12345", "#gggggg", "red", "#1234567"]) {
      expect(parseHexColor(bad)).toBeNull();
      expect(isValidHexColor(bad)).toBe(false);
    }
    // Not a string at the type boundary.
    expect(parseHexColor(undefined as unknown as string)).toBeNull();
  });
});

describe("clampOpacity", () => {
  it("clamps into [0, 1] and defaults NaN to opaque", () => {
    expect(clampOpacity(0.4)).toBe(0.4);
    expect(clampOpacity(2)).toBe(1);
    expect(clampOpacity(-1)).toBe(0);
    expect(clampOpacity(Number.NaN)).toBe(1);
  });
});

describe("isWinAnsiEncodable / sanitizeNoteText", () => {
  it("accepts ASCII, Latin-1, and CP1252 punctuation", () => {
    expect(isWinAnsiEncodable("A".codePointAt(0)!)).toBe(true);
    expect(isWinAnsiEncodable("é".codePointAt(0)!)).toBe(true);
    expect(isWinAnsiEncodable("—".codePointAt(0)!)).toBe(true); // em dash
    expect(isWinAnsiEncodable("€".codePointAt(0)!)).toBe(true);
  });

  it("rejects code points the encoder can't represent", () => {
    expect(isWinAnsiEncodable("😀".codePointAt(0)!)).toBe(false);
    expect(isWinAnsiEncodable("日".codePointAt(0)!)).toBe(false);
  });

  it("keeps encodable text, replaces the rest with ?, and expands tabs", () => {
    expect(sanitizeNoteText("Hello — “world”")).toBe("Hello — “world”");
    expect(sanitizeNoteText("emoji 😀 test")).toBe("emoji ? test");
    expect(sanitizeNoteText("日本語")).toBe("???");
    expect(sanitizeNoteText("a\tb")).toBe("a    b");
    // Newlines survive so wrapping can break on them.
    expect(sanitizeNoteText("a\nb")).toBe("a\nb");
  });
});

describe("wrapText", () => {
  // A fake monospace measure: every character is 1 unit wide.
  const measure = (s: string) => s.length;

  it("returns one line per input line when width-wrapping is disabled", () => {
    expect(wrapText("one\ntwo", 0, measure)).toEqual(["one", "two"]);
    expect(wrapText("one\ntwo", Number.NaN, measure)).toEqual(["one", "two"]);
  });

  it("greedily wraps words to the width", () => {
    expect(wrapText("aaa bbb ccc", 7, measure)).toEqual(["aaa bbb", "ccc"]);
  });

  it("always breaks on explicit newlines even while wrapping", () => {
    expect(wrapText("aaa\nbbb ccc", 100, measure)).toEqual(["aaa", "bbb ccc"]);
  });

  it("splits a single word longer than the width", () => {
    expect(wrapText("abcdefgh", 3, measure)).toEqual(["abc", "def", "gh"]);
  });
});

describe("arrowHeadSegments", () => {
  it("returns two barbs anchored at the end point", () => {
    const segs = arrowHeadSegments(0, 0, 10, 0, 4);
    expect(segs).toHaveLength(2);
    for (const seg of segs) {
      expect(seg.start).toEqual({ x: 10, y: 0 });
      // Barbs point back toward the start (x < 10).
      expect(seg.end.x).toBeLessThan(10);
    }
  });

  it("returns nothing for a zero-length line or non-positive size", () => {
    expect(arrowHeadSegments(5, 5, 5, 5, 4)).toEqual([]);
    expect(arrowHeadSegments(0, 0, 10, 0, 0)).toEqual([]);
  });
});

describe("validateAnnotations", () => {
  const pages: PageSize[] = [
    { width: 612, height: 792 },
    { width: 400, height: 300 },
  ];
  const highlight = (over: Partial<Annotation> = {}): Annotation =>
    ({ type: "highlight", page: 1, x: 100, y: 100, width: 200, height: 50, color: "#ffff00", ...over } as Annotation);

  it("returns no issues for a valid set across the four types", () => {
    const annotations: Annotation[] = [
      { type: "highlight", page: 1, x: 10, y: 10, width: 50, height: 12, color: "#ff0" },
      { type: "rect", page: 1, x: 10, y: 30, width: 100, height: 40, color: "#3b82f6" },
      { type: "note", page: 2, x: 20, y: 200, text: "See here", color: "#111111", size: 12 },
      { type: "line", page: 2, x1: 0, y1: 0, x2: 100, y2: 80, color: "#ef4444", arrow: true },
    ];
    expect(validateAnnotations(annotations, pages)).toEqual([]);
  });

  it("flags out-of-range and non-integer pages", () => {
    expect(validateAnnotations([highlight({ page: 0 })], pages)[0]?.code).toBe("page-out-of-range");
    expect(validateAnnotations([highlight({ page: 3 })], pages)[0]?.code).toBe("page-out-of-range");
    expect(validateAnnotations([highlight({ page: 1.5 })], pages)[0]?.code).toBe("page-out-of-range");
  });

  it("flags invalid colors and out-of-range opacity", () => {
    expect(validateAnnotations([highlight({ color: "not-a-color" })], pages)[0]?.code).toBe("invalid-color");
    expect(validateAnnotations([highlight({ opacity: 2 })], pages)[0]?.code).toBe("invalid-opacity");
    expect(validateAnnotations([highlight({ opacity: -0.1 })], pages)[0]?.code).toBe("invalid-opacity");
  });

  it("flags non-finite, empty, and out-of-bounds rectangles", () => {
    expect(validateAnnotations([highlight({ x: Number.NaN })], pages)[0]?.code).toBe("invalid");
    expect(validateAnnotations([highlight({ width: 0 })], pages)[0]?.code).toBe("empty");
    expect(validateAnnotations([highlight({ x: 500, width: 200 })], pages)[0]?.code).toBe("out-of-bounds");
  });

  it("flags empty note text and a note off the page", () => {
    const note = (over: Partial<Annotation>): Annotation =>
      ({ type: "note", page: 1, x: 10, y: 10, text: "hi", color: "#000", ...over } as Annotation);
    expect(validateAnnotations([note({ text: "   " })], pages)[0]?.code).toBe("empty");
    expect(validateAnnotations([note({ x: 700 })], pages)[0]?.code).toBe("out-of-bounds");
    expect(validateAnnotations([note({ size: 0 })], pages)[0]?.code).toBe("invalid");
  });

  it("flags a zero-length line and endpoints off the page", () => {
    const line = (over: Partial<Annotation>): Annotation =>
      ({ type: "line", page: 1, x1: 0, y1: 0, x2: 100, y2: 100, color: "#000", ...over } as Annotation);
    expect(validateAnnotations([line({ x2: 0, y2: 0 })], pages)[0]?.code).toBe("empty");
    expect(validateAnnotations([line({ x2: 900 })], pages)[0]?.code).toBe("out-of-bounds");
  });

  it("reports the offending index for each issue", () => {
    const issues = validateAnnotations(
      [highlight(), highlight({ width: 0 }), highlight({ page: 9 })],
      pages,
    );
    expect(issues.map((issue) => issue.index)).toEqual([1, 2]);
  });
});

describe("annotatePdf", () => {
  it("flattens all four markup types, preserving page count and sizes", async () => {
    const sizes: [number, number][] = [
      [612, 792],
      [400, 300],
    ];
    const base = await blankPdf(sizes);
    const annotations: Annotation[] = [
      { type: "highlight", page: 1, x: 72, y: 700, width: 200, height: 16, color: "#ffee00", opacity: 0.4 },
      { type: "rect", page: 1, x: 60, y: 600, width: 240, height: 80, color: "#3b82f6", borderWidth: 2 },
      { type: "note", page: 2, x: 24, y: 260, text: "Reviewed — looks good", color: "#111111", size: 12 },
      { type: "line", page: 2, x1: 20, y1: 40, x2: 300, y2: 200, color: "#ef4444", thickness: 2, arrow: true },
    ];

    const result = await annotatePdf(base, annotations);

    expect(result.pageCount).toBe(2);
    expect(result.annotationCount).toBe(4);
    expect(result.counts).toEqual({ highlight: 1, rect: 1, note: 1, line: 1 });
    // Adding content grows the file beyond the blank base.
    expect(result.bytes.byteLength).toBeGreaterThan(base.byteLength);

    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(2);
    expect(out.getCreator()).toBe("pdf.xyz");
    out.getPages().forEach((page, i) => {
      expect(page.getWidth()).toBeCloseTo(sizes[i]![0]);
      expect(page.getHeight()).toBeCloseTo(sizes[i]![1]);
    });
  });

  it("draws a note with non-WinAnsi characters without throwing", async () => {
    const base = await blankPdf([[300, 300]]);
    const result = await annotatePdf(base, [
      { type: "note", page: 1, x: 20, y: 150, text: "Emoji 😀 and 日本語 note", color: "#000000", maxWidth: 260 },
    ]);
    expect(result.counts.note).toBe(1);
    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(1);
  });

  it("rejects an empty markup list", async () => {
    const base = await blankPdf([[200, 200]]);
    await expect(annotatePdf(base, [])).rejects.toBeInstanceOf(PdfEngineError);
  });

  it("rejects invalid markups before saving", async () => {
    const base = await blankPdf([[200, 100]]);
    await expect(
      annotatePdf(base, [
        { type: "highlight", page: 2, x: 0, y: 0, width: 10, height: 10, color: "#000" },
      ]),
    ).rejects.toThrow(/page 2 is out of range/);
  });

  it("rejects a file that isn't a PDF", async () => {
    const notPdf = new TextEncoder().encode("this is not a pdf");
    await expect(
      annotatePdf(notPdf, [
        { type: "rect", page: 1, x: 0, y: 0, width: 10, height: 10, color: "#000" },
      ]),
    ).rejects.toBeInstanceOf(PdfEngineError);
  });
});

describe("getAnnotatePageSizes", () => {
  it("reads each page's content-space size", async () => {
    const base = await blankPdf([
      [612, 792],
      [400, 300],
    ]);
    expect(await getAnnotatePageSizes(base)).toEqual([
      { width: 612, height: 792 },
      { width: 400, height: 300 },
    ]);
  });
});

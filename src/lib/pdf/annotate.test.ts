import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { PdfEngineError } from "./engine";
import {
  annotatePdf,
  annotatedOutputName,
  arrowHeadSegments,
  clampOpacity,
  displayedSize,
  getAnnotatePageSizes,
  isValidHexColor,
  isWinAnsiEncodable,
  noteFitIssues,
  nonWinAnsiCharacters,
  parseHexColor,
  sanitizeNoteText,
  toContentSpace,
  validateAnnotations,
  wrapText,
  type Annotation,
  type NoteMetrics,
  type PageFrame,
  type PageSize,
} from "./annotate";
import { STAMP_POSITIONS, placeStamp, resolveAlign } from "./stamp";

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

  it("keeps encodable text and expands tabs", () => {
    expect(sanitizeNoteText("Hello — “world”")).toBe("Hello — “world”");
    expect(sanitizeNoteText("a\tb")).toBe("a    b");
    // Newlines survive so wrapping can break on them.
    expect(sanitizeNoteText("a\nb")).toBe("a\nb");
  });

  it("passes non-WinAnsi text through UNCHANGED — it neither substitutes nor refuses", () => {
    // THIRD STATE OF THIS ASSERTION. Kept in one place so the history is
    // legible rather than archaeology:
    //
    //   1. Originally it required `sanitizeNoteText("日本語")` to return "???"
    //      and the export to succeed. It was pinning the defect: a user
    //      annotating a contract in Chinese was told "Markups applied" and
    //      downloaded a PDF of question marks.
    //   2. On 2026-08-10 it was inverted to require a THROW — silent corruption
    //      is worse than refusal.
    //   3. Now the throw is gone from here, because the alphabet limit is gone.
    //      A real Noto face is embedded by `embedStampFont`, so "日本語" is
    //      drawn rather than refused, and the refusal that remains — for the
    //      scripts we still cannot draw — belongs to the one place that knows
    //      what the fonts can do. Keeping a second, narrower refusal here would
    //      have meant Bengali notes rejected by a check that never noticed the
    //      fonts arrived.
    //
    // What survived all three: this function NEVER substitutes. That is the
    // invariant, and it is asserted directly.
    expect(sanitizeNoteText("日本語")).toBe("日本語");
    expect(sanitizeNoteText("গোপনীয়")).toBe("গোপনীয়");
    expect(sanitizeNoteText("Привет")).toBe("Привет");
    expect(sanitizeNoteText("emoji 😀 test")).toBe("emoji 😀 test");
    // The character that started it all must never appear from nowhere.
    expect(sanitizeNoteText("日本語")).not.toContain("?");
  });

  it("still reports which characters need a downloaded face", () => {
    // Renamed from `unsupportedNoteCharacters`: the predicate is unchanged but
    // the WORD was wrong the moment a Unicode face could be embedded. "語" is
    // not unsupported; it is not WinAnsi, which is a statement about the
    // built-in fonts and a routing decision, not a refusal.
    expect(nonWinAnsiCharacters("Hello — “world”")).toEqual([]);
    expect(nonWinAnsiCharacters("a\tb\nc")).toEqual([]);
    // Distinct characters only, so a long CJK note does not produce a wall.
    expect(nonWinAnsiCharacters("語語語")).toEqual(["語"]);
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
    ({
      type: "highlight",
      page: 1,
      x: 100,
      y: 100,
      width: 200,
      height: 50,
      color: "#ffff00",
      ...over,
    }) as Annotation;

  it("returns no issues for a valid set across the four types", () => {
    const annotations: Annotation[] = [
      {
        type: "highlight",
        page: 1,
        x: 10,
        y: 10,
        width: 50,
        height: 12,
        color: "#ff0",
      },
      {
        type: "rect",
        page: 1,
        x: 10,
        y: 30,
        width: 100,
        height: 40,
        color: "#3b82f6",
      },
      {
        type: "note",
        page: 2,
        x: 20,
        y: 200,
        text: "See here",
        color: "#111111",
        size: 12,
      },
      {
        type: "line",
        page: 2,
        x1: 0,
        y1: 0,
        x2: 100,
        y2: 80,
        color: "#ef4444",
        arrow: true,
      },
    ];
    expect(validateAnnotations(annotations, pages)).toEqual([]);
  });

  it("flags out-of-range and non-integer pages", () => {
    expect(validateAnnotations([highlight({ page: 0 })], pages)[0]?.code).toBe(
      "page-out-of-range",
    );
    expect(validateAnnotations([highlight({ page: 3 })], pages)[0]?.code).toBe(
      "page-out-of-range",
    );
    expect(
      validateAnnotations([highlight({ page: 1.5 })], pages)[0]?.code,
    ).toBe("page-out-of-range");
  });

  it("flags invalid colors and out-of-range opacity", () => {
    expect(
      validateAnnotations([highlight({ color: "not-a-color" })], pages)[0]
        ?.code,
    ).toBe("invalid-color");
    expect(
      validateAnnotations([highlight({ opacity: 2 })], pages)[0]?.code,
    ).toBe("invalid-opacity");
    expect(
      validateAnnotations([highlight({ opacity: -0.1 })], pages)[0]?.code,
    ).toBe("invalid-opacity");
  });

  it("flags non-finite, empty, and out-of-bounds rectangles", () => {
    expect(
      validateAnnotations([highlight({ x: Number.NaN })], pages)[0]?.code,
    ).toBe("invalid");
    expect(validateAnnotations([highlight({ width: 0 })], pages)[0]?.code).toBe(
      "empty",
    );
    expect(
      validateAnnotations([highlight({ x: 500, width: 200 })], pages)[0]?.code,
    ).toBe("out-of-bounds");
  });

  it("flags empty note text and a note off the page", () => {
    const note = (over: Partial<Annotation>): Annotation =>
      ({
        type: "note",
        page: 1,
        x: 10,
        y: 10,
        text: "hi",
        color: "#000",
        ...over,
      }) as Annotation;
    expect(validateAnnotations([note({ text: "   " })], pages)[0]?.code).toBe(
      "empty",
    );
    expect(validateAnnotations([note({ x: 700 })], pages)[0]?.code).toBe(
      "out-of-bounds",
    );
    expect(validateAnnotations([note({ size: 0 })], pages)[0]?.code).toBe(
      "invalid",
    );
  });

  it("flags a zero-length line and endpoints off the page", () => {
    const line = (over: Partial<Annotation>): Annotation =>
      ({
        type: "line",
        page: 1,
        x1: 0,
        y1: 0,
        x2: 100,
        y2: 100,
        color: "#000",
        ...over,
      }) as Annotation;
    expect(validateAnnotations([line({ x2: 0, y2: 0 })], pages)[0]?.code).toBe(
      "empty",
    );
    expect(validateAnnotations([line({ x2: 900 })], pages)[0]?.code).toBe(
      "out-of-bounds",
    );
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
      {
        type: "highlight",
        page: 1,
        x: 72,
        y: 700,
        width: 200,
        height: 16,
        color: "#ffee00",
        opacity: 0.4,
      },
      {
        type: "rect",
        page: 1,
        x: 60,
        y: 600,
        width: 240,
        height: 80,
        color: "#3b82f6",
        borderWidth: 2,
      },
      {
        type: "note",
        page: 2,
        x: 24,
        y: 260,
        text: "Reviewed — looks good",
        color: "#111111",
        size: 12,
      },
      {
        type: "line",
        page: 2,
        x1: 20,
        y1: 40,
        x2: 300,
        y2: 200,
        color: "#ef4444",
        thickness: 2,
        arrow: true,
      },
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

  it("refuses a note it cannot draw rather than exporting question marks", async () => {
    // Inverted 2026-08-10. This asserted the export SUCCEEDED for
    // "Emoji 😀 and 日本語 note" — which it did, by writing "Emoji ? and ??? note"
    // into the user's contract and reporting "Markups applied". The test was
    // agreeing with the bug.
    const base = await blankPdf([[300, 300]]);
    await expect(
      annotatePdf(base, [
        {
          type: "note",
          page: 1,
          x: 20,
          y: 150,
          text: "Emoji 😀 and 日本語 note",
          color: "#000000",
          maxWidth: 260,
        },
      ]),
    ).rejects.toThrow(PdfEngineError);
  });

  it("still draws a note whose characters the standard fonts cover", async () => {
    const base = await blankPdf([[300, 300]]);
    const result = await annotatePdf(base, [
      {
        type: "note",
        page: 1,
        x: 20,
        y: 150,
        text: "Café — “note”",
        color: "#000000",
        maxWidth: 260,
      },
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
        {
          type: "highlight",
          page: 2,
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          color: "#000",
        },
      ]),
    ).rejects.toThrow(/page 2 is out of range/);
  });

  it("rejects a file that isn't a PDF", async () => {
    const notPdf = new TextEncoder().encode("this is not a pdf");
    await expect(
      annotatePdf(notPdf, [
        {
          type: "rect",
          page: 1,
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          color: "#000",
        },
      ]),
    ).rejects.toBeInstanceOf(PdfEngineError);
  });
});

describe("toContentSpace / displayedSize", () => {
  const QUARTER_TURNS = Array.from(
    { length: 4 },
    (_, q) => (q * 90) as PageFrame["rotation"],
  );
  const frameFor = (rotation: PageFrame["rotation"]): PageFrame => ({
    x: 0,
    y: 0,
    width: 600,
    height: 800,
    rotation,
  });

  it("agrees with placeStamp, the site's other viewer-frame placement, on every rotation", () => {
    // Two independent statements of the same transform: the stamp tools'
    // (page numbers, headers) and annotate's. Every alignment is an anchor on
    // the displayed page; with a zero-size text the anchor IS the point.
    let compared = 0;
    for (const rotation of QUARTER_TURNS) {
      const frame = frameFor(rotation);
      const shown = displayedSize(frame);
      for (const position of STAMP_POSITIONS) {
        const { h, v } = resolveAlign(position);
        const margin = 36;
        const stamp = placeStamp({
          pageWidth: frame.width,
          pageHeight: frame.height,
          pageRotation: rotation,
          textWidth: 0,
          textHeight: 0,
          h,
          v,
          margin,
        });
        const vx =
          h === "left"
            ? margin
            : h === "right"
              ? shown.width - margin
              : shown.width / 2;
        const vy =
          v === "bottom"
            ? margin
            : v === "top"
              ? shown.height - margin
              : shown.height / 2;
        expect(toContentSpace({ x: vx, y: vy }, frame)).toEqual({
          x: stamp.x,
          y: stamp.y,
        });
        expect(stamp.rotate).toBe(rotation);
        compared += 1;
      }
    }
    expect(compared).toBe(QUARTER_TURNS.length * STAMP_POSITIONS.length);
  });

  it("maps the displayed page onto the whole box, offset by its origin", () => {
    for (const rotation of QUARTER_TURNS) {
      const frame = { ...frameFor(rotation), x: 30, y: 50 };
      const { width, height } = displayedSize(frame);
      expect([width, height]).toEqual(
        rotation % 180 === 0 ? [600, 800] : [800, 600],
      );
      const mapped = [
        [0, 0],
        [width, 0],
        [0, height],
        [width, height],
      ].map(([x, y]) => toContentSpace({ x: x!, y: y! }, frame));
      const xs = mapped.map((p) => p.x).sort((a, b) => a - b);
      const ys = mapped.map((p) => p.y).sort((a, b) => a - b);
      expect([xs[0], xs[3], ys[0], ys[3]]).toEqual([30, 630, 50, 850]);
    }
  });
});

describe("noteFitIssues", () => {
  // Plain metrics: every character 10 pt wide at size 10, ascent 8, descent 2.
  const metrics: NoteMetrics = {
    widthOfTextAtSize: (text, size) => text.length * size,
    heightAtSize: (size, options) =>
      options?.descender === false ? size * 0.8 : size,
  };
  const page: PageSize[] = [{ width: 200, height: 100 }];
  const note = (over: Partial<Annotation>): Annotation =>
    ({
      type: "note",
      page: 1,
      x: 10,
      y: 50,
      text: "hello",
      color: "#000",
      size: 10,
      ...over,
    }) as Annotation;

  it("POSITIVE CONTROL: a note that fits has no issue", () => {
    expect(noteFitIssues([note({})], page, metrics)).toEqual([]);
    // Right to the edge is still on the page: 10 + 19 * 10 = 200.
    expect(
      noteFitIssues([note({ text: "x".repeat(19) })], page, metrics),
    ).toEqual([]);
  });

  it("flags each edge by the amount the words leave the page", () => {
    const [right] = noteFitIssues(
      [note({ text: "x".repeat(20) })],
      page,
      metrics,
    );
    expect(right?.message).toMatch(/runs 10 pt past the right edge/);
    const [top] = noteFitIssues([note({ y: 95 })], page, metrics);
    expect(top?.message).toMatch(/rises 3 pt above the top edge/);
    // Three lines at 11.8 pt spacing from y 20: last baseline 20 - 23.6,
    // minus the 2 pt descent.
    const [bottom] = noteFitIssues(
      [note({ y: 20, text: "a\nb\nc" })],
      page,
      metrics,
    );
    expect(bottom?.message).toMatch(/runs 6 pt below the bottom edge/);
  });

  it("measures the wrapped lines, not the anchor", () => {
    // Unwrapped, 30 characters run off a 200 pt page; wrapped at 100 pt they
    // fit, three lines down from y 80.
    const text = "aaaa bbbb cccc dddd eeee ffff";
    expect(noteFitIssues([note({ text, y: 80 })], page, metrics)).toHaveLength(
      1,
    );
    expect(
      noteFitIssues([note({ text, y: 80, maxWidth: 100 })], page, metrics),
    ).toEqual([]);
  });

  it("leaves invalid markups to validateAnnotations", () => {
    expect(
      noteFitIssues([note({ page: 5, text: "x".repeat(50) })], page, metrics),
    ).toEqual([]);
  });
});

describe("getAnnotatePageSizes", () => {
  // Rotated and cropped pages are pinned against what pdfjs displays, in
  // annotate.pdfjs.test.ts.
  it("reads each unrotated page's size", async () => {
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

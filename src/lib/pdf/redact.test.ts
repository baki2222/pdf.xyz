import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  displayedPageSize,
  pageSizeForRaster,
  redactPdf,
  redactPresetById,
  redactedOutputName,
  redactionFillHex,
  redactionRectToPixels,
  validateRedactions,
  type PageSize,
  type RedactionRect,
} from "./redact";

describe("redact naming and presets", () => {
  it("names output from the source file", () => {
    expect(redactedOutputName("report.pdf")).toBe("report-redacted.pdf");
    expect(redactedOutputName("")).toBe("document-redacted.pdf");
  });

  it("resolves known presets and falls back to print", () => {
    expect(redactPresetById("screen").dpi).toBe(96);
    expect(redactPresetById("print").dpi).toBe(150);
    expect(redactPresetById("unknown").id).toBe("print");
  });

  it("maps fill colors to hex, defaulting to black", () => {
    expect(redactionFillHex("black")).toBe("#000000");
    expect(redactionFillHex("white")).toBe("#ffffff");
    expect(redactionFillHex(undefined)).toBe("#000000");
  });
});

describe("displayedPageSize", () => {
  it("keeps orientation for 0° and 180°", () => {
    expect(displayedPageSize(612, 792, 0)).toEqual({ width: 612, height: 792 });
    expect(displayedPageSize(612, 792, 180)).toEqual({ width: 612, height: 792 });
  });

  it("swaps width/height for 90° and 270° (incl. negatives)", () => {
    expect(displayedPageSize(612, 792, 90)).toEqual({ width: 792, height: 612 });
    expect(displayedPageSize(612, 792, 270)).toEqual({ width: 792, height: 612 });
    expect(displayedPageSize(612, 792, -90)).toEqual({ width: 792, height: 612 });
  });

  it("normalizes odd rotation values", () => {
    expect(displayedPageSize(612, 792, 450)).toEqual({ width: 792, height: 612 });
    expect(displayedPageSize(612, 792)).toEqual({ width: 612, height: 792 });
  });
});

describe("validateRedactions", () => {
  const pages: PageSize[] = [
    { width: 612, height: 792 },
    { width: 400, height: 300 },
  ];
  const box = (over: Partial<RedactionRect> = {}): RedactionRect => ({
    page: 1,
    x: 100,
    y: 100,
    width: 200,
    height: 50,
    ...over,
  });

  it("returns no issues for valid boxes", () => {
    expect(validateRedactions([box(), box({ page: 2, x: 0, y: 0, width: 400, height: 300 })], pages)).toEqual([]);
  });

  it("accepts a box flush against the page edges", () => {
    expect(validateRedactions([box({ x: 0, y: 0, width: 612, height: 792 })], pages)).toEqual([]);
  });

  it("flags out-of-range and non-integer pages", () => {
    expect(validateRedactions([box({ page: 0 })], pages)[0]?.code).toBe("page-out-of-range");
    expect(validateRedactions([box({ page: 3 })], pages)[0]?.code).toBe("page-out-of-range");
    expect(validateRedactions([box({ page: 1.5 })], pages)[0]?.code).toBe("page-out-of-range");
  });

  it("flags non-finite coordinates", () => {
    expect(validateRedactions([box({ x: Number.NaN })], pages)[0]?.code).toBe("invalid");
    expect(validateRedactions([box({ width: Number.POSITIVE_INFINITY })], pages)[0]?.code).toBe("invalid");
  });

  it("flags zero or negative sizes", () => {
    expect(validateRedactions([box({ width: 0 })], pages)[0]?.code).toBe("empty");
    expect(validateRedactions([box({ height: -10 })], pages)[0]?.code).toBe("empty");
  });

  it("flags boxes that extend past the page", () => {
    expect(validateRedactions([box({ x: -20 })], pages)[0]?.code).toBe("out-of-bounds");
    expect(validateRedactions([box({ x: 500, width: 200 })], pages)[0]?.code).toBe("out-of-bounds");
    expect(validateRedactions([box({ page: 2, y: 280, height: 40 })], pages)[0]?.code).toBe("out-of-bounds");
  });

  it("reports the offending index for each issue", () => {
    const issues = validateRedactions([box(), box({ width: 0 }), box({ page: 9 })], pages);
    expect(issues.map((issue) => issue.index)).toEqual([1, 2]);
  });
});

describe("redactionRectToPixels", () => {
  it("maps a bottom-left box to a top-left pixel box at scale 1", () => {
    // 612x792 pt page rendered at 612x792 px (scale 1). A box at y=700..750
    // sits 42..92 px from the top.
    expect(
      redactionRectToPixels(
        { x: 100, y: 700, width: 200, height: 50 },
        { width: 612, height: 792, pageWidth: 612, pageHeight: 792 },
      ),
    ).toEqual({ x: 100, y: 42, width: 200, height: 50 });
  });

  it("scales device pixels independently on each axis", () => {
    expect(
      redactionRectToPixels(
        { x: 100, y: 700, width: 200, height: 50 },
        { width: 1224, height: 1584, pageWidth: 612, pageHeight: 792 },
      ),
    ).toEqual({ x: 200, y: 84, width: 400, height: 100 });
  });

  it("rounds outward so no readable sliver is left", () => {
    const px = redactionRectToPixels(
      { x: 10.4, y: 10.4, width: 5.2, height: 5.2 },
      { width: 100, height: 100, pageWidth: 100, pageHeight: 100 },
    );
    // left floors to 10, right ceils to 16 -> width 6 (covers the fractional edge).
    expect(px.x).toBe(10);
    expect(px.width).toBe(6);
  });

  it("clamps a box that spills past the canvas", () => {
    const px = redactionRectToPixels(
      { x: -50, y: -50, width: 1000, height: 1000 },
      { width: 200, height: 200, pageWidth: 200, pageHeight: 200 },
    );
    expect(px).toEqual({ x: 0, y: 0, width: 200, height: 200 });
  });
});

describe("pageSizeForRaster", () => {
  it("prefers PDF point dimensions when present", () => {
    expect(pageSizeForRaster({ pageWidth: 612, pageHeight: 792, width: 1275, height: 1650 })).toEqual([612, 792]);
  });

  it("falls back to pixel dimensions for degenerate pages", () => {
    expect(pageSizeForRaster({ pageWidth: 0, pageHeight: Number.NaN, width: 320, height: 200 })).toEqual([320, 200]);
  });
});

describe("redactPdf validation", () => {
  async function onePagePdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]);
    return doc.save();
  }

  it("rejects invalid boxes before rasterizing", async () => {
    await expect(
      redactPdf(await onePagePdf(), {
        rects: [{ page: 2, x: 0, y: 0, width: 10, height: 10 }],
      }),
    ).rejects.toThrow(/page 2 is out of range/);
  });
});

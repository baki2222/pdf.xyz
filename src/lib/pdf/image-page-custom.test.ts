import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { boxOf, drawnImages } from "@/tests/drawn-images";
import { JPEG_30X20, JPEG_HEIGHT, JPEG_WIDTH } from "@/tests/jpeg-fixtures";
import { greyPng } from "@/tests/density-fixtures";
import {
  DEFAULT_IMAGE_PAGE_OPTIONS,
  imagePageSizeById,
  type ImagePageOptions,
} from "./image-page-layout";
import { buildImagePdf, imagesToPdf } from "./image-to-pdf";
import {
  MAX_CUSTOM_MARGIN_PT,
  MIN_CUSTOM_PAGE_PT,
  customMargin,
  customPageSize,
  lengthToPoints,
  pageSetupProblem,
} from "./image-page-custom";

/*
 * Audits jpg-to-pdf#3 / png-to-pdf#5 (2026-11-08): a page size and a margin
 * typed in mm or inches. Read back from the saved PDF's MediaBox and the
 * image's box under the CTM a viewer applies.
 */

const photo = { name: "p.jpg", type: "image/jpeg", bytes: JPEG_30X20 };
const big = { name: "scan.png", type: "image/png", bytes: greyPng(1200, 1600) };

async function drawn(pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf);
  const { width, height } = doc.getPage(0).getSize();
  const b = boxOf((await drawnImages(pdf))[0]!.ctm);
  return { width, height, b };
}

const custom = (
  size: { width: string; height: string; unit: "mm" | "in" },
  extra: Partial<ImagePageOptions> = {},
): ImagePageOptions => {
  const s = customPageSize(size.width, size.height, size.unit);
  if ("problem" in s) throw new Error(s.problem);
  return {
    ...DEFAULT_IMAGE_PAGE_OPTIONS,
    pageSize: "custom",
    customSize: s,
    ...extra,
  };
};

describe("custom page size (audits jpg-to-pdf#3, png-to-pdf#5)", () => {
  it("a 4 × 6 in photo print is a 288 × 432 pt page, portrait by default", async () => {
    const d = await drawn(
      await imagesToPdf(
        "jpg",
        [photo],
        custom({ width: "4", height: "6", unit: "in" }),
      ),
    );
    expect([d.width, d.height]).toEqual([288, 432]);
  });

  it("typed wide, it is still held portrait; Landscape turns it", async () => {
    const options = custom(
      { width: "6", height: "4", unit: "in" },
      { orientation: "landscape" },
    );
    const d = await drawn(await imagesToPdf("jpg", [photo], options));
    expect([d.width, d.height]).toEqual([432, 288]);
  });

  it("A6 typed in mm is the A6 page (105 × 148 mm)", async () => {
    const d = await drawn(
      await imagesToPdf(
        "jpg",
        [photo],
        custom({ width: "105", height: "148", unit: "mm" }),
      ),
    );
    expect(d.width).toBeCloseTo((105 * 72) / 25.4, 6);
    expect(d.height).toBeCloseTo((148 * 72) / 25.4, 6);
  });

  it("reaches the size-limit builder", async () => {
    const d = await drawn(
      await buildImagePdf(
        "jpg",
        [photo],
        custom({ width: "4", height: "6", unit: "in" }),
      ),
    );
    expect([d.width, d.height]).toEqual([288, 432]);
  });
});

describe("custom margin", () => {
  it("10 mm on A4: a large image meets a 10 mm margin", async () => {
    const m = customMargin("10", "mm");
    if (typeof m !== "number") throw new Error(m.problem);
    const options: ImagePageOptions = {
      ...DEFAULT_IMAGE_PAGE_OPTIONS,
      pageSize: "a4",
      margin: "custom",
      customMarginPt: m,
    };
    const d = await drawn(await imagesToPdf("png", [big], options));
    const a4 = imagePageSizeById("a4").size!;
    // 1200 × 1600 is wider than A4's inner shape: it meets left and right.
    expect(d.b.x0).toBeCloseTo(m, 6);
    expect(d.b.x1).toBeCloseTo(a4.width - m, 6);
  });

  it("under Fit to image the page is the image plus the custom margin", async () => {
    const options: ImagePageOptions = {
      ...DEFAULT_IMAGE_PAGE_OPTIONS,
      pageSize: "fit",
      margin: "custom",
      customMarginPt: 9,
    };
    const d = await drawn(await imagesToPdf("jpg", [photo], options));
    expect([d.width, d.height]).toEqual([JPEG_WIDTH + 18, JPEG_HEIGHT + 18]);
  });

  it("a margin that leaves no room is refused by the engine, in the runner's words", async () => {
    const options = custom(
      { width: "1", height: "1", unit: "in" },
      { margin: "custom", customMarginPt: 30 },
    );
    const problem = pageSetupProblem(options, "in");
    expect(problem).toMatch(/leaves no room/);
    // The engine says it in mm, the unit it is not told; same sentence.
    await expect(imagesToPdf("jpg", [photo], options)).rejects.toThrow(
      pageSetupProblem(options, "mm")!,
    );
  });

  it("control: the same margin on a page with room is accepted", () => {
    const options = custom(
      { width: "4", height: "6", unit: "in" },
      { margin: "custom", customMarginPt: 30 },
    );
    expect(pageSetupProblem(options)).toBeUndefined();
  });
});

describe("typed lengths", () => {
  it("takes a decimal point or a decimal comma", () => {
    expect(lengthToPoints("4.5", "in")).toBe(324);
    expect(lengthToPoints("4,5", "in")).toBe(324);
    expect(lengthToPoints(" 25.4 ", "mm")).toBeCloseTo(72, 6);
  });

  it.each(["", "abc", "0", "-3", "4 in", "1e3"])("refuses %j", (text) => {
    expect(lengthToPoints(text, "mm")).toBeUndefined();
  });

  it("bounds a page side and a margin, saying the bounds in the unit typed", () => {
    const tiny = customPageSize("0.1", "6", "in");
    expect("problem" in tiny && tiny.problem).toContain(
      `${MIN_CUSTOM_PAGE_PT / 72} in`,
    );
    expect("problem" in customPageSize("4", "201", "in")).toBe(true);
    const wide = customMargin("3", "in");
    expect(typeof wide === "object" && wide.problem).toContain(
      `${MAX_CUSTOM_MARGIN_PT / 72} in`,
    );
    expect(customMargin("0", "mm")).toBe(0);
  });
});

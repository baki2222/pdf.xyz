// @vitest-environment node
/**
 * Smart defaults (redesign E.9): the order a batch of numbered files is put
 * in, and the resolution a long PDF is rendered at. Each default is said
 * with its reason, so the reason is tested beside the decision.
 *
 * The natural-order CORPUS runs both ways: names that must be reordered, to
 * the order a person expects, and names that must be left exactly as they
 * were dropped — mixed stems, names without numbers, a single file, a drop
 * that is already in order.
 */
import { describe, expect, it } from "vitest";
import { RASTER_RESOLUTIONS } from "@/lib/pdf/pdf-to-image";
import {
  LARGE_RASTER_PAGES,
  defaultResolution,
  naturalOrder,
  orderNote,
} from "./defaults";

const apply = (names: string[]) => {
  const order = naturalOrder(names);
  return order ? order.order.map((i) => names[i]) : null;
};

describe("naturalOrder — reordered", () => {
  const CORPUS: [string[], string[]][] = [
    [
      ["scan 1.pdf", "scan 10.pdf", "scan 2.pdf"],
      ["scan 1.pdf", "scan 2.pdf", "scan 10.pdf"],
    ],
    [
      ["IMG_0012.jpg", "IMG_0003.jpg", "IMG_0100.jpg"],
      ["IMG_0003.jpg", "IMG_0012.jpg", "IMG_0100.jpg"],
    ],
    [
      ["page-10-final.pdf", "page-9-final.pdf"],
      ["page-9-final.pdf", "page-10-final.pdf"],
    ],
    // The stem is compared without case: a camera and a phone disagree.
    [
      ["Scan 3.pdf", "scan 2.PDF"],
      ["scan 2.PDF", "Scan 3.pdf"],
    ],
    // Only the LAST number counts: a year in the stem is part of the stem.
    [
      ["report 2024 part 3.pdf", "report 2024 part 1.pdf"],
      ["report 2024 part 1.pdf", "report 2024 part 3.pdf"],
    ],
  ];
  for (const [dropped, expected] of CORPUS)
    it(dropped.join(", "), () => expect(apply(dropped)).toEqual(expected));

  it("keeps the drop order between equal numbers (a stable sort)", () => {
    expect(apply(["b 2.pdf", "b 02.pdf", "b 1.pdf"])).toEqual([
      "b 1.pdf",
      "b 2.pdf",
      "b 02.pdf",
    ]);
  });

  it("names the numbers in their new order", () => {
    expect(
      naturalOrder(["scan 1.pdf", "scan 10.pdf", "scan 2.pdf"])!.numbers,
    ).toEqual([1, 2, 10]);
  });
});

describe("naturalOrder — left as dropped", () => {
  const UNCHANGED: string[][] = [
    // Mixed stems: no shared sequence to restore.
    ["scan 2.pdf", "photo 1.pdf"],
    ["scan 10.pdf", "scan 2.pdf", "cover.pdf"],
    ["a1.pdf", "b2.pdf", "a3.pdf"],
    // No numbers at all.
    ["cover.pdf", "appendix.pdf"],
    // One file is never a sequence.
    ["scan 10.pdf"],
    [],
    // Already in order: nothing to say.
    ["scan 1.pdf", "scan 2.pdf", "scan 10.pdf"],
  ];
  for (const names of UNCHANGED)
    it(names.join(", ") || "(none)", () => {
      expect(naturalOrder(names)).toBeNull();
    });
});

describe("orderNote", () => {
  it("says what was done and shows the numbers, the first three at most", () => {
    expect(orderNote([1, 2, 10])).toBe(
      "Ordered by the numbers in the file names (1, 2, 10)",
    );
    expect(orderNote([3, 12])).toBe(
      "Ordered by the numbers in the file names (3, 12)",
    );
    expect(orderNote([1, 2, 3, 4, 5])).toBe(
      "Ordered by the numbers in the file names (1, 2, 3, …)",
    );
  });
});

describe("defaultResolution", () => {
  it("chooses Screen past the threshold, with the page count as its reason", () => {
    expect(LARGE_RASTER_PAGES).toBe(60);
    expect(defaultResolution(212)).toEqual({
      id: "screen",
      reason: "Screen resolution — this PDF has 212 pages",
    });
    expect(defaultResolution(LARGE_RASTER_PAGES + 1)?.id).toBe("screen");
  });

  it("says nothing at or under the threshold — the usual default stands", () => {
    for (const pages of [LARGE_RASTER_PAGES, 59, 1, 0])
      expect(defaultResolution(pages), String(pages)).toBeNull();
  });

  it("chooses a resolution the picker offers, and names it by its label", () => {
    const choice = defaultResolution(500)!;
    const offered = RASTER_RESOLUTIONS.find((r) => r.id === choice.id);
    expect(offered).toBeDefined();
    expect(choice.reason.startsWith(`${offered!.label} resolution`)).toBe(true);
  });
});

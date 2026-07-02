import { describe, expect, it } from "vitest";
import {
  allIndices,
  invertSelection,
  isAllSelected,
  rangeInclusive,
  selectRange,
  toggleIndex,
} from "./selection";

const set = (...values: number[]) => new Set(values);

describe("toggleIndex", () => {
  it("adds a missing index and removes a present one", () => {
    expect([...toggleIndex(set(1, 2), 3)]).toEqual([1, 2, 3]);
    expect([...toggleIndex(set(1, 2), 2)]).toEqual([1]);
  });

  it("does not mutate the input set", () => {
    const original = set(1);
    toggleIndex(original, 2);
    expect([...original]).toEqual([1]);
  });
});

describe("allIndices", () => {
  it("returns every index in [0, count)", () => {
    expect([...allIndices(3)]).toEqual([0, 1, 2]);
  });

  it("returns an empty set for zero or negative counts", () => {
    expect(allIndices(0).size).toBe(0);
    expect(allIndices(-5).size).toBe(0);
  });
});

describe("invertSelection", () => {
  it("returns the complement within [0, count)", () => {
    expect([...invertSelection(set(0, 2), 4)]).toEqual([1, 3]);
  });

  it("inverting twice returns the original selection", () => {
    const original = set(1, 3);
    const once = invertSelection(original, 5);
    expect([...invertSelection(once, 5)]).toEqual([...original]);
  });
});

describe("rangeInclusive", () => {
  it("is inclusive and ascending regardless of argument order", () => {
    expect(rangeInclusive(2, 5)).toEqual([2, 3, 4, 5]);
    expect(rangeInclusive(5, 2)).toEqual([2, 3, 4, 5]);
    expect(rangeInclusive(3, 3)).toEqual([3]);
  });
});

describe("selectRange", () => {
  it("adds the inclusive anchor→index range to the selection", () => {
    expect([...selectRange(set(0), 2, 4, 10)]).toEqual([0, 2, 3, 4]);
  });

  it("clamps out-of-range indices", () => {
    expect([...selectRange(set(), -2, 3, 3)]).toEqual([0, 1, 2]);
  });
});

describe("isAllSelected", () => {
  it("is true only when every page is selected", () => {
    expect(isAllSelected(set(0, 1, 2), 3)).toBe(true);
    expect(isAllSelected(set(0, 1), 3)).toBe(false);
  });

  it("is false for an empty document", () => {
    expect(isAllSelected(set(), 0)).toBe(false);
  });
});

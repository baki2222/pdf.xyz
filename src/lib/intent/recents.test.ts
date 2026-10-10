// @vitest-environment jsdom
/**
 * Recents remember WHICH tools finished a job here — slugs and times, and
 * nothing a file holds or is called. The persisted JSON is read back key by
 * key, so a field added later (a file name, say) fails here before it ships.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRecents,
  MAX_RECENTS,
  readRecents,
  recordCompletion,
  RECENTS_STORAGE_KEY,
  resetRecentsForTests,
  useRecents,
} from "./recents";

beforeEach(() => {
  window.localStorage.clear();
  resetRecentsForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  resetRecentsForTests();
});

const stored = () =>
  JSON.parse(window.localStorage.getItem(RECENTS_STORAGE_KEY) ?? "null");

describe("what is stored", () => {
  it("slugs and times only, newest first, each once", () => {
    recordCompletion("merge-pdf", 1);
    recordCompletion("compress-pdf", 2);
    recordCompletion("merge-pdf", 3);
    expect(readRecents()).toEqual([
      { slug: "merge-pdf", at: 3 },
      { slug: "compress-pdf", at: 2 },
    ]);
    const json = stored();
    expect(Object.keys(json).sort()).toEqual(["items", "version"]);
    expect(json.version).toBe(1);
    for (const item of json.items)
      expect(Object.keys(item).sort()).toEqual(["at", "slug"]);
  });

  it(`at most ${MAX_RECENTS}; the oldest fall off`, () => {
    for (let i = 0; i < MAX_RECENTS + 2; i++) recordCompletion(`tool-${i}`, i);
    const recents = readRecents();
    expect(recents).toHaveLength(MAX_RECENTS);
    expect(recents[0]!.slug).toBe(`tool-${MAX_RECENTS + 1}`);
    expect(recents.map((r) => r.slug)).not.toContain("tool-0");
  });

  it("refuses anything that is not a slug", () => {
    recordCompletion("Quarterly Report.pdf", 1);
    recordCompletion("../etc", 1);
    expect(readRecents()).toEqual([]);
    expect(window.localStorage.getItem(RECENTS_STORAGE_KEY)).toBeNull();
  });

  it("reads anything malformed as nothing", () => {
    for (const raw of [
      "not json",
      "null",
      JSON.stringify({ version: 2, items: [] }),
      JSON.stringify({ version: 1, items: "x" }),
      JSON.stringify({
        version: 1,
        items: [{ slug: "My File.pdf", at: 1 }, { slug: "merge-pdf" }],
      }),
    ]) {
      window.localStorage.setItem(RECENTS_STORAGE_KEY, raw);
      expect(readRecents(), raw).toEqual([]);
    }
  });

  it("clearRecents forgets every one", () => {
    recordCompletion("merge-pdf", 1);
    clearRecents();
    expect(readRecents()).toEqual([]);
    expect(window.localStorage.getItem(RECENTS_STORAGE_KEY)).toBeNull();
  });

  it("a browser that refuses storage gets no recents and no error", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => recordCompletion("merge-pdf", 1)).not.toThrow();
    expect(readRecents()).toEqual([]);
  });
});

describe("useRecents", () => {
  it("follows a completion here and one in another tab", () => {
    const { result } = renderHook(() => useRecents());
    expect(result.current).toEqual([]);
    act(() => recordCompletion("merge-pdf", 1));
    expect(result.current.map((r) => r.slug)).toEqual(["merge-pdf"]);

    // Another tab writes; this one hears the storage event.
    act(() => {
      window.localStorage.setItem(
        RECENTS_STORAGE_KEY,
        JSON.stringify({ version: 1, items: [{ slug: "rotate-pdf", at: 2 }] }),
      );
      window.dispatchEvent(
        new StorageEvent("storage", { key: RECENTS_STORAGE_KEY }),
      );
    });
    expect(result.current.map((r) => r.slug)).toEqual(["rotate-pdf"]);
  });

  it("keeps one snapshot while nothing changed", () => {
    recordCompletion("merge-pdf", 1);
    const { result, rerender } = renderHook(() => useRecents());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

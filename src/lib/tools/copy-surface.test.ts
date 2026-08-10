// @vitest-environment node
/**
 * The shared walk reaches the files it exists to read — proven, not assumed.
 *
 * The corpus-proof idiom from the docs census, applied to the copy surface:
 * the walk's reach is its load-bearing part, and it failed silently twice
 * (marketing-honesty missing site.ts; then tool-facts.ts — the file holding
 * every tool page's facts, FAQ answers, and steps — landing outside the walk
 * in the very change built to close that class). A future copy file landing
 * outside the walk must collapse loudly here, not sit silently unread by the
 * three guards that import this walk.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { copyFiles } from "./copy-surface";

describe("the copy surface reaches what the guards must read", () => {
  it("includes the load-bearing copy sources", () => {
    const files = copyFiles().map((f) => path.relative(process.cwd(), f).replace(/\\/g, "/"));
    for (const expected of [
      "src/lib/tools/tool-facts.ts",
      "src/lib/tools/catalog.ts",
      "src/lib/tools/categories.ts",
      "src/lib/tools/processing.ts",
      "src/lib/faq.ts",
      "src/lib/site.ts",
    ]) {
      expect(files, `the walk no longer reaches ${expected} — the guards are blind to it`).toContain(expected);
    }
  });

  it("never walks test files into the copy surface", () => {
    const tests = copyFiles().filter((f) => f.includes(".test."));
    expect(tests).toEqual([]);
  });
});

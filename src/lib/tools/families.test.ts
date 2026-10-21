// @vitest-environment node
/**
 * The home page's filter chips, derived from the catalogue (see
 * `./families.ts`). The owner's brief (2026-10-21) named the chips a visitor
 * should see: All, Organize, Convert, Edit, Sign, Security, Optimize, AI.
 * That list is the EXPECTED VALUE here, not the source — the chips are
 * derived, and this checks the derivation lands on it.
 */
import { describe, expect, it } from "vitest";
import { categories, tools } from "@/lib/tools";
import { familyOf, toolFamilies } from "./families";

describe("tool families", () => {
  it("health: the catalogue is the whole catalogue", () => {
    expect(tools.length).toBeGreaterThanOrEqual(40);
    expect(categories.length).toBeGreaterThanOrEqual(6);
  });

  it("fold the categories into the chips a visitor reads, in catalogue order", () => {
    expect(toolFamilies().map((f) => f.label)).toEqual([
      "Organize",
      "Convert",
      "Edit",
      "Sign",
      "Security",
      "Optimize",
      "AI",
    ]);
  });

  it("put every tool in exactly one family, the one its category folds into", () => {
    const families = toolFamilies();
    for (const tool of tools) {
      const homes = families.filter((f) => f.tools.includes(tool));
      expect(
        homes.map((f) => f.id),
        tool.slug,
      ).toEqual([familyOf(tool)]);
    }
    expect(families.reduce((n, f) => n + f.tools.length, 0)).toBe(tools.length);
  });

  it("fold only categories that share a first word: Convert holds both directions", () => {
    const convert = toolFamilies().find((f) => f.id === "convert")!;
    expect([...convert.categories].sort()).toEqual([
      "convert-from",
      "convert-to",
    ]);
    for (const f of toolFamilies())
      if (f.id !== "convert") expect(f.categories, f.id).toHaveLength(1);
  });
});

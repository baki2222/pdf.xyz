// @vitest-environment node
import { describe, expect, it } from "vitest";
import { toolCount } from "./tools";
import { processingSplit } from "./tools/processing-split";
import { socialCardChips } from "./og";

/**
 * The shared social card said "Runs in your browser" as a flat chip beside
 * "50 tools", while about two in five of those tools upload the file to a
 * worker. No copy guard could see it: `src/lib/og.tsx` sat outside the copy
 * walk (it is listed there now). This reads the chips the card paints.
 */
describe("the social card's chips", () => {
  const chips = socialCardChips();

  it("any chip about where the file goes states the never-upload count", () => {
    const split = processingSplit();
    // Health: the two answers differ, or the next assertion is vacuous.
    expect(split.neverUploads.length).toBeLessThan(toolCount);
    const locality = chips.filter((c) =>
      /browser|upload|device|local/i.test(c),
    );
    expect(locality.length).toBeGreaterThanOrEqual(1);
    for (const chip of locality) {
      expect(chip).toContain(String(split.neverUploads.length));
    }
  });

  it("no chip makes the unqualified claim that shipped", () => {
    expect(chips).not.toContain("Runs in your browser");
    for (const chip of chips) {
      expect(chip).not.toMatch(/^runs (entirely )?in your browser$/i);
    }
  });
});

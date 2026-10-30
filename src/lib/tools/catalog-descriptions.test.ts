// @vitest-environment node
/**
 * Meta descriptions fit what a searcher can actually read.
 *
 * Google renders roughly 155–160 characters of a meta description; beyond
 * ~165 the tail is invisible in serps, so an over-long description is spending
 * its best material where nobody sees it. This pins the ceiling ONLY — there
 * is deliberately no floor, because a description that stops short when the
 * truth runs out is the ruled-correct outcome (thin-stays-thin), and a floor
 * would be padding pressure.
 *
 * The catalogue is IMPORTED, not regex-parsed: three instruments in a row
 * were broken by parsing this file's source with a pattern window
 * (markdown-to-pdf's load-bearing comment, every time). The module is
 * TypeScript we can call; calling it is the non-fragile reading.
 */
import { describe, expect, it } from "vitest";
import { tools } from "./catalog";

const SERP_CEILING = 165;

describe("catalog descriptions", () => {
  it("covers the whole catalogue (health check for the suite itself)", () => {
    expect(tools.length).toBe(54);
    for (const tool of tools) {
      expect(tool.description, `${tool.slug} has no description`).toBeTruthy();
    }
  });

  it(`no description exceeds the ~${SERP_CEILING}-char serp ceiling`, () => {
    const over = tools
      .filter((t) => t.description.length > SERP_CEILING)
      .map(
        (t) =>
          `${t.slug}: ${t.description.length} chars — the tail past ~${SERP_CEILING} is invisible in search results`,
      );
    expect(over, over.join("\n")).toEqual([]);
  });
});

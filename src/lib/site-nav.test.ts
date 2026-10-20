// @vitest-environment node
/**
 * Which header link is marked current.
 *
 * HISTORY. The header used `pathname.startsWith(href)` per item, so every
 * item whose href prefixes the path lit up. That was invisible while "AI
 * tools" linked `/tools?category=ai` — no pathname starts with a query string
 * — and became two current links the moment it linked `/tools/category/ai`,
 * which starts with `/tools` too. `activeNavHref` then picked the LONGEST
 * prefix. The property is ONE current item: the most specific.
 *
 * WP-09: the rule is each item's own `match` list, read against the path AND
 * the query, because `/tools?category=ai` — the old shared URL the explorer
 * still filters by — is the AI tools, and "All tools" lit on it (pathname
 * only). The longest-prefix test below is kept, re-pointed at the new rule;
 * the query case it could not see is added, with the pathname-only reading
 * (the server render, before the query is known) as its control.
 */
import { describe, expect, it } from "vitest";
import { currentNavHref, primaryNav } from "./site";
import { categoryHref } from "./tools/category-href";

const q = (s: string) => new URLSearchParams(s);
const AI = categoryHref("ai");

describe("primaryNav", () => {
  it("is All tools, AI tools, Guides, Workspace, Pricing (D.1)", () => {
    expect(primaryNav.map((i) => i.label)).toEqual([
      "All tools",
      "AI tools",
      "Guides",
      "Workspace",
      "Pricing",
    ]);
  });

  it("every item but the in-page anchor has match rules", () => {
    for (const item of primaryNav) {
      if (item.href.includes("#")) continue;
      expect(item.match?.length ?? 0, item.label).toBeGreaterThan(0);
    }
  });
});

describe("currentNavHref", () => {
  it("marks exactly the most specific item", () => {
    expect(currentNavHref(AI, q(""))).toBe(AI);
    // The shape that lit two items: every item that prefix-matches the path.
    const naive = primaryNav.filter(
      (i) =>
        i.href.startsWith("/") && !i.href.includes("#") && AI.startsWith(i.href),
    );
    expect(naive.length, "control: the naive rule sees two").toBe(2);
  });

  it("on /tools?category=ai only AI tools is current", () => {
    expect(currentNavHref("/tools", q("category=ai"))).toBe(AI);
    // Control: pathname only (the server render) cannot see the query.
    expect(currentNavHref("/tools", null)).toBe("/tools");
    // Another category's filter is still All tools.
    expect(currentNavHref("/tools", q("category=organize"))).toBe("/tools");
    expect(currentNavHref("/tools", q("q=merge"))).toBe("/tools");
  });

  it("keeps the section behaviour for the rest of the site", () => {
    expect(currentNavHref("/tools", q(""))).toBe("/tools");
    expect(currentNavHref("/tools/merge-pdf", q(""))).toBe("/tools");
    expect(currentNavHref(categoryHref("organize"), q(""))).toBe("/tools");
    expect(currentNavHref("/workspace", q(""))).toBe("/workspace");
    expect(currentNavHref("/guides", q(""))).toBe("/guides");
    expect(currentNavHref("/guides/how-to-merge-pdf-files", q(""))).toBe(
      "/guides",
    );
  });

  it("never marks an anchor, and needs a segment boundary", () => {
    expect(currentNavHref("/", q(""))).toBeUndefined();
    expect(currentNavHref("/toolsmith", q(""))).toBeUndefined();
    expect(currentNavHref("/guidesx", q(""))).toBeUndefined();
    expect(currentNavHref("/privacy", q(""))).toBeUndefined();
  });
});

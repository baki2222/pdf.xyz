// @vitest-environment node
/**
 * Which header link is marked current.
 *
 * The header used `pathname.startsWith(href)` per item, so every item whose
 * href prefixes the path lit up. That was invisible while "AI tools" linked
 * `/tools?category=ai` — no pathname starts with a query string — and became
 * two current links the moment it linked `/tools/category/ai`, which starts
 * with `/tools` too. The property is ONE current item: the most specific.
 */
import { describe, expect, it } from "vitest";
import { activeNavHref, primaryNav } from "./site";
import { categoryHref } from "./tools/category-href";

describe("activeNavHref", () => {
  it("marks exactly the most specific item", () => {
    expect(activeNavHref(categoryHref("ai"))).toBe(categoryHref("ai"));
    // The shape that lit two items: every item that prefix-matches the path.
    const naive = primaryNav.filter(
      (i) =>
        i.href.startsWith("/") &&
        !i.href.includes("#") &&
        categoryHref("ai").startsWith(i.href),
    );
    expect(naive.length, "control: the naive rule sees two").toBe(2);
  });

  it("keeps the section behaviour for the rest of the site", () => {
    expect(activeNavHref("/tools")).toBe("/tools");
    expect(activeNavHref("/tools/merge-pdf")).toBe("/tools");
    expect(activeNavHref(categoryHref("organize"))).toBe("/tools");
    expect(activeNavHref("/workspace")).toBe("/workspace");
  });

  it("never marks an anchor, and needs a segment boundary", () => {
    expect(activeNavHref("/")).toBeUndefined();
    expect(activeNavHref("/toolsmith")).toBeUndefined();
    expect(activeNavHref("/guides")).toBeUndefined();
  });
});

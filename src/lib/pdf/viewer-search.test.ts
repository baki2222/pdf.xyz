import { describe, expect, it } from "vitest";
import { VIEWER_MAX_MATCHES, VIEWER_MAX_QUERY } from "./viewer-geometry";
import {
  findInItems,
  hasSearchableText,
  pageSearchText,
  searchStatus,
  viewerSearchPattern,
  type SearchItem,
} from "./viewer-search";

const items = (...strs: (string | [string, true])[]): SearchItem[] =>
  strs.map((s) =>
    typeof s === "string" ? { str: s } : { str: s[0], hasEOL: true },
  );

const find = (list: SearchItem[], q: string, matchCase = false) =>
  findInItems(list, viewerSearchPattern(q, { matchCase })!);

describe("viewer search: character ranges inside the items a match covers", () => {
  it("finds a word inside one item, by character", () => {
    expect(find(items("The total due is 40"), "total")).toEqual([
      [{ item: 0, start: 4, end: 9 }],
    ]);
  });

  it("finds a match across item boundaries, split where the items split", () => {
    // pdf.js often cuts a line into several items mid-word.
    expect(find(items("Inv", "oice No. ", "42"), "invoice no. 42")).toEqual([
      [
        { item: 0, start: 0, end: 3 },
        { item: 1, start: 0, end: 9 },
        { item: 2, start: 0, end: 2 },
      ],
    ]);
  });

  it("matches a space in the query against a line break between items, and highlights no separator", () => {
    const list = items(["Total", true], "due");
    expect(pageSearchText(list).text).toBe("Total\ndue");
    expect(find(list, "total due")).toEqual([
      [
        { item: 0, start: 0, end: 5 },
        { item: 1, start: 0, end: 3 },
      ],
    ]);
  });

  it("is case-blind unless Match case is on", () => {
    const list = items("Alpha alpha ALPHA");
    expect(find(list, "alpha")).toHaveLength(3);
    expect(find(list, "alpha", true)).toEqual([
      [{ item: 0, start: 6, end: 11 }],
    ]);
  });

  it("takes the query literally: regex characters are text", () => {
    expect(find(items("cost (USD) 1.5"), "(usd)")).toHaveLength(1);
    expect(find(items("a+b"), "a+b")).toHaveLength(1);
    expect(find(items("aab"), "a+b")).toHaveLength(0);
  });

  it("finds nothing for a blank query, and cuts a long one to the field's limit", () => {
    expect(viewerSearchPattern("   ", { matchCase: false })).toBeNull();
    const long = "x".repeat(VIEWER_MAX_QUERY + 50);
    expect(viewerSearchPattern(long, { matchCase: false })!.source.length).toBe(
      VIEWER_MAX_QUERY,
    );
  });

  it("stops at the cap, and the cap is the limit passed", () => {
    const many = items("ab ".repeat(VIEWER_MAX_MATCHES + 100));
    expect(find(many, "ab")).toHaveLength(VIEWER_MAX_MATCHES);
    expect(
      findInItems(many, viewerSearchPattern("ab", { matchCase: false })!, 7),
    ).toHaveLength(7);
    expect(
      findInItems(many, viewerSearchPattern("ab", { matchCase: false })!, 0),
    ).toEqual([]);
  });

  it("tells a page with text from a scanned one", () => {
    expect(hasSearchableText(items(" ", "\n"))).toBe(false);
    expect(hasSearchableText(items(" ", "a"))).toBe(true);
    expect(hasSearchableText([])).toBe(false);
  });
});

describe("the search status says what it found and what it could not search", () => {
  const base = {
    matches: 0,
    pagesWithMatches: 0,
    searched: 10,
    total: 10,
    pagesWithoutText: 0,
    pagesCapped: 0,
    stoppedAtCap: false,
  };
  it("progress, then a count", () => {
    expect(searchStatus({ ...base, searched: 3 })).toBe(
      "Searching… page 3 of 10.",
    );
    expect(searchStatus(base)).toBe("No matches.");
    expect(searchStatus({ ...base, matches: 1, pagesWithMatches: 1 })).toBe(
      "1 match on 1 page.",
    );
  });

  it("names the cap, the scanned pages and the pages read in part", () => {
    const s = searchStatus({
      ...base,
      matches: VIEWER_MAX_MATCHES,
      pagesWithMatches: 4,
      searched: 6,
      stoppedAtCap: true,
      pagesWithoutText: 2,
      pagesCapped: 1,
    });
    expect(s).toContain(`first ${VIEWER_MAX_MATCHES} matches`);
    expect(s).toContain("2 pages have no selectable text");
    expect(s).toContain("1 page has more text than this view reads");
    // Not "searching" once it stopped at the cap.
    expect(s).not.toContain("Searching");
  });
});

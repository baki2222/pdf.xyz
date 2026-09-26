// @vitest-environment node
/**
 * Category links are built by `categoryHref`, and only by it.
 *
 * WHAT THIS REPLACES: seven hand-spelled `/tools?category=<id>` links — the
 * header and footer "AI tools", the AI section's CTA, the homepage's eight
 * "View all" links, and the tool page's breadcrumb and category chip — every
 * one pointing at a filtered view whose canonical is `/tools`. A finding named
 * three of them; a search found seven. A list of call sites is the thing that
 * misses the fourth, so the subjects here are DISCOVERED: every non-test
 * source file under `src`, comments stripped (a docblock explaining the old
 * URL is not a link).
 *
 * Two properties, both directions of one rule:
 *  1. nothing writes a `?category=` link — the query form still FILTERS (the
 *     explorer parses it, so old shared URLs work) but nothing points at it;
 *  2. nothing spells `/tools/category/` by hand — the helper is the one place,
 *     so a route rename cannot leave a stale link behind.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withoutComments } from "./copy-surface";
import { CATEGORY_PATH_PREFIX, categoryHref } from "./category-href";
import { categories } from "./categories";
import { footerNav, primaryNav } from "@/lib/site";
import { generateStaticParams } from "@/app/tools/category/[category]/page";

const ROOT = process.cwd();
const rel = (file: string) =>
  path.relative(ROOT, file).split(path.sep).join("/");

function sourceFiles(dir = path.join(ROOT, "src")): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name))
      out.push(full);
  }
  return out;
}

/** A query-string category link, in any quoting a source file can use. */
const QUERY_LINK = /\?category=/;
/** The landing-page path, spelled out rather than built. */
const SPELLED_PATH = /["'`]\/tools\/category\//;

/**
 * NOT MINE TO EDIT, and time-boxed: the tool page's breadcrumb and category
 * chip are being switched to `categoryHref` by the content lane in the same
 * programme of work. This entry is a RATCHET, not an allowance — the test
 * below fails the moment the file stops writing `?category=`, so the
 * exemption is deleted in the change that makes it unnecessary rather than
 * outliving it.
 */
const PENDING = new Set(["src/app/tools/[slug]/page.tsx"]);

describe("category links go through categoryHref", () => {
  const files = sourceFiles();
  const sources = new Map(
    files.map((f) => [rel(f), withoutComments(readFileSync(f, "utf8"))]),
  );

  it("the walk sees the codebase, including the files that link categories", () => {
    // Health check: a walk that found nothing passes every ⊆ below.
    expect(files.length).toBeGreaterThan(200);
    for (const known of [
      "src/lib/site.ts",
      "src/components/sections/ai-section.tsx",
      "src/components/sections/tool-showcase.tsx",
      "src/components/tools/tools-explorer.tsx",
    ]) {
      expect(sources.has(known), known).toBe(true);
    }
  });

  it("the detectors catch the shapes that shipped, and not a comment", () => {
    // Positive controls: the literal lines this change removed.
    expect(
      QUERY_LINK.test(`{ label: "AI tools", href: "/tools?category=ai" }`),
    ).toBe(true);
    expect(QUERY_LINK.test("href={`/tools?category=${category.id}`}")).toBe(
      true,
    );
    expect(SPELLED_PATH.test("href={`/tools/category/${id}`}")).toBe(true);
    // …and the stripper is what keeps an explanatory docblock out.
    expect(
      QUERY_LINK.test(
        withoutComments("/** used to be `/tools?category=ai` */"),
      ),
    ).toBe(false);
  });

  it("no source file writes a ?category= link", () => {
    const offenders = [...sources]
      .filter(([file, src]) => !PENDING.has(file) && QUERY_LINK.test(src))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it("every pending exemption is still needed", () => {
    // The ratchet. If this fails, the file was fixed: delete it from PENDING.
    for (const file of PENDING) {
      expect(
        QUERY_LINK.test(sources.get(file) ?? ""),
        `${file} no longer writes ?category= — remove it from PENDING`,
      ).toBe(true);
    }
  });

  it("only category-href.ts spells the landing-page path", () => {
    const offenders = [...sources]
      .filter(
        ([file, src]) =>
          file !== "src/lib/tools/category-href.ts" && SPELLED_PATH.test(src),
      )
      .map(([file]) => file);
    expect(offenders).toEqual([]);
    expect(categoryHref("ai").startsWith(CATEGORY_PATH_PREFIX)).toBe(true);
  });

  it("every category link in the nav resolves to a prerendered category page", () => {
    const prerendered = new Set(
      generateStaticParams().map((p) => categoryHref(p.category)),
    );
    const navHrefs = [
      ...primaryNav.map((i) => i.href),
      ...footerNav.flatMap((c) => c.items.map((i) => i.href ?? "")),
    ].filter((href) => href.startsWith(CATEGORY_PATH_PREFIX));
    // Positive: the header's AI link and the footer's whole column are here.
    expect(navHrefs).toContain(categoryHref("ai"));
    expect(navHrefs.length).toBeGreaterThanOrEqual(categories.length);
    expect(navHrefs.filter((href) => !prerendered.has(href))).toEqual([]);
    // And the footer names every category — derived, so a new one is linked.
    for (const c of categories) expect(navHrefs).toContain(categoryHref(c.id));
  });
});

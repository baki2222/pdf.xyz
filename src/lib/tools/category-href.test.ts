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
 *  1. nothing outside `PENDING` writes a `?category=` link — the query form
 *     still FILTERS (the explorer parses it, so old shared URLs work), and
 *     only the pending files still point at it;
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

/**
 * The backticked `src/…` paths a docblock lists after `STILL LINKED FROM`, up
 * to the end of that paragraph — or `null` when the docblock has no such list.
 */
function stillLinkedFrom(raw: string): string[] | null {
  const at = raw.indexOf("STILL LINKED FROM");
  if (at < 0) return null;
  const rest = raw.slice(at);
  const end = rest.search(/\n\s*\*\s*\n|\*\//);
  const paragraph = end < 0 ? rest : rest.slice(0, end);
  return [...paragraph.matchAll(/`(src\/[^`]+)`/g)].map((m) => m[1]!).sort();
}

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

/**
 * The prose that describes the rule tells the truth about `PENDING`.
 *
 * WHAT SHIPPED: the helper's docblock said "Every link is built here" and the
 * landing route's said "nothing links it any more", while all fifty tool pages
 * still linked `/tools?category=<id>` from their category chip and their
 * BreadcrumbList — the very file `PENDING` exempts. The ratchet above was
 * honest and the two paragraphs describing it were not; a comment is not a
 * guard, so the paragraphs now LIST what still links the query form, and the
 * list is compared with `PENDING` in both directions. Emptying `PENDING`
 * fails here until the prose is updated to match.
 *
 * The two docblocks are found, not named: the module that DEFINES
 * `categoryHref`, and the route file `CATEGORY_PATH_PREFIX` resolves to.
 */
describe("the docblocks list what still links ?category=", () => {
  const raw = (file: string) =>
    readFileSync(path.join(ROOT, ...file.split("/")), "utf8");
  const helper = sourceFiles()
    .map(rel)
    .filter((file) => /export function categoryHref\b/.test(raw(file)));
  const route = `src/app${CATEGORY_PATH_PREFIX}[category]/page.tsx`;

  it("finds exactly one helper and a real route file", () => {
    expect(helper).toEqual(["src/lib/tools/category-href.ts"]);
    expect(raw(route)).toMatch(/generateStaticParams/);
  });

  it("the parser sees a list, and sees the old claim as no list at all", () => {
    // Positive control: the shape the docblocks use.
    expect(
      stillLinkedFrom(
        " * STILL LINKED FROM: `src/a.tsx` and\n * `src/b/[x].tsx`.\n *\n * `src/c.ts`",
      ),
    ).toEqual(["src/a.tsx", "src/b/[x].tsx"]);
    // The sentence that shipped false carries no list, so it cannot pass.
    expect(
      stillLinkedFrom(
        " * (the explorer reads it), but nothing links it any more — links are built by\n * `categoryHref`.\n */",
      ),
    ).toBeNull();
  });

  it.each([
    ["helper", () => helper[0]!],
    ["route", () => route],
  ])("the %s docblock lists exactly the PENDING files", (_label, file) => {
    const listed = stillLinkedFrom(raw(file()));
    expect(listed, `${file()} has no STILL LINKED FROM list`).not.toBeNull();
    expect(listed).toEqual([...PENDING].sort());
  });
});

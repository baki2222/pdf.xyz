// @vitest-environment node
/**
 * No page or layout reads the request, so every page can be prerendered.
 *
 * WHAT SHIPPED: `/tools` awaited `searchParams` to seed its filter and
 * `/workspace` awaited it for one `?tool=` slug. Either is enough to make a
 * route dynamic, and in production both answered
 * `Cache-Control: private, no-cache, no-store` with a server render per hit —
 * the catalogue hub that links every tool, and the page the header and hero
 * send people to — on a one-vCPU origin. Both values are now read in the
 * browser (`parseToolsQuery`, `deepLinkedToolSlug`), because nothing the
 * server renders depended on them.
 *
 * The subjects are DISCOVERED — every `page`/`layout` file under `src/app`,
 * Next's own route convention — so a new page is covered without being named.
 * The build is the authority (`○`/`●` vs `ƒ` in its route table); this is the
 * cheap, always-on proxy for it, and it names what it cannot see: a request
 * API called from a component the page imports is outside the scan.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withoutComments } from "@/lib/tools/copy-surface";
import { parseToolsQuery } from "@/lib/tools/tools-query";
import { deepLinkedToolSlug } from "./workspace/deep-link";

const APP = path.join(process.cwd(), "src", "app");

function routeFiles(dir = APP): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (/^(page|layout)\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * The request-time APIs and the explicit opt-outs of static rendering. The
 * `next/headers` functions are matched by their IMPORT, not their call: the
 * privacy policy's prose says "cookies (the _ga family)", which a call-shaped
 * pattern flagged on the first run.
 */
const REQUEST_TIME =
  /\bsearchParams\b|from\s+["']next\/headers["']|\bconnection\(\s*\)|dynamic\s*=\s*["']force-dynamic["']|revalidate\s*=\s*0\b/;

const rel = (file: string) =>
  path.relative(process.cwd(), file).split(path.sep).join("/");

describe("pages are prerenderable", () => {
  const files = routeFiles();

  it("the walk finds the pages it is about", () => {
    const names = files.map(rel);
    expect(names.length, names.join(", ")).toBeGreaterThanOrEqual(8);
    expect(names).toContain("src/app/tools/page.tsx");
    expect(names).toContain("src/app/workspace/page.tsx");
    expect(names).toContain("src/app/layout.tsx");
  });

  it("the detector catches the shapes that shipped, not a comment about them", () => {
    // Positive controls: the two signatures this change removed.
    expect(
      REQUEST_TIME.test(
        "searchParams: Promise<{ category?: string; q?: string }>;",
      ),
    ).toBe(true);
    expect(REQUEST_TIME.test("const { tool } = await searchParams;")).toBe(
      true,
    );
    expect(REQUEST_TIME.test(`import { headers } from "next/headers";`)).toBe(
      true,
    );
    expect(REQUEST_TIME.test("await connection();")).toBe(true);
    // …and the prose that tripped the first version of this pattern.
    expect(REQUEST_TIME.test("its measurement cookies (the _ga family)")).toBe(
      false,
    );
    expect(
      REQUEST_TIME.test(withoutComments("// used to await `searchParams`")),
    ).toBe(false);
  });

  it("no page or layout reads the request", () => {
    const dynamic = files
      .filter((file) =>
        REQUEST_TIME.test(withoutComments(readFileSync(file, "utf8"))),
      )
      .map(rel);
    expect(dynamic).toEqual([]);
  });

  it("the deep links still resolve, in the browser", () => {
    expect(parseToolsQuery("?category=ai&q=chat")).toEqual({
      category: "ai",
      query: "chat",
      accepts: null,
      runs: "all",
    });
    expect(parseToolsQuery("?category=bogus").category).toBe("all");
    // ?accepts= is read here too, never by the page: a known format, in any
    // spelling, or nothing at all.
    expect(parseToolsQuery("?accepts=jpeg").accepts).toBe("JPG");
    expect(parseToolsQuery("?accepts=bogus").accepts).toBeNull();
    // ?runs= likewise (WP-06): where a tool runs, or every tool for a value
    // the explorer does not offer — never an empty grid.
    expect(parseToolsQuery("?runs=never-uploads").runs).toBe("never-uploads");
    expect(parseToolsQuery("?runs=bogus").runs).toBe("all");
    const summaries = [{ slug: "merge-pdf" }];
    expect(deepLinkedToolSlug("?tool=merge-pdf", summaries)).toBe("merge-pdf");
    expect(deepLinkedToolSlug("?tool=not-a-tool", summaries)).toBeUndefined();
    expect(deepLinkedToolSlug("", summaries)).toBeUndefined();
  });
});

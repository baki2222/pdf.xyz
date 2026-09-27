// @vitest-environment node
/**
 * The sitemap and the robots directives must agree, in both directions.
 *
 * WHAT SHIPPED WITHOUT THIS GUARD: `/status` answered `200` with
 * `<meta name="robots" content="index, follow"/>` and
 * `<link rel="canonical" href="https://pdf.xyz/status"/>`, and was absent from
 * `https://pdf.xyz/sitemap.xml` — measured on production 2026-08-22. Four
 * non-tool URLs made the sitemap (`/`, `/tools`, `/privacy`, `/terms`) and the
 * fifth indexable page did not, so the one page the privacy policy cites as the
 * authoritative "which tools run where" list was reachable only by crawling a
 * single inline link inside that policy. Nothing failed, because the two halves
 * of the decision lived in different files and never met.
 *
 * THE PROPERTY, not the mechanism: **every indexable route is in the sitemap,
 * and every sitemap entry is indexable.** Not "`/status` is in the sitemap" —
 * that exit condition would be satisfied by a hard-coded line and would say
 * nothing about the sixth page. A route added tomorrow is covered because the
 * route set is DISCOVERED, never named:
 *
 *   - the routes come from walking `src/app` for Next's `page` file convention,
 *     so a page this file does not know about is still checked (a named list
 *     cannot see a route it does not name);
 *   - `[slug]` is expanded through the segment's own `generateStaticParams`,
 *     which `dynamicParams = false` makes the complete and only source of valid
 *     slugs — so the tool pages are enumerated by the same function Next uses;
 *   - indexability is read from the `Metadata` each segment actually exports
 *     (`generateMetadata` where present, `metadata` otherwise), which is the
 *     object Next renders the `robots` meta tag from — not from a re-derivation
 *     of `buildMetadata`'s argument.
 *
 * HEALTH CHECKS, because `[] ⊆ X` is vacuously true and a blind predicate
 * reports the strongest possible pass. Three ways this could pass while seeing
 * nothing, each closed below: the walk finds no pages; metadata resolution
 * yields `undefined` for every route so nothing is classified either way; the
 * sitemap comes back empty. So the corpus is bounded at both ends, and BOTH
 * classifications must be non-empty — an indexable route AND a `noindex` one.
 * `/workspace` is the positive control for the second: it is deliberately
 * `noindex, nofollow` and deliberately absent from the sitemap, so it exercises
 * the "correctly omitted" arm that the `/status` defect never would.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Metadata } from "next";
import { describe, expect, it } from "vitest";
import sitemap from "./sitemap";
import robots from "./robots";
import { siteConfig } from "@/lib/site";
import { tools } from "@/lib/tools";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ *
 *  1. Discover the routes. Walk the tree; never type a list.
 * ------------------------------------------------------------------ */

interface PageFile {
  /** Import specifier relative to this file, e.g. `./tools/[slug]/page`. */
  specifier: string;
  /** Route pattern, e.g. `/tools/[slug]`. */
  pattern: string;
}

/**
 * Every `page.{ts,tsx}` under `src/app` — Next's own convention for "this
 * directory is a route", which is the artifact the framework already depends
 * on. Route groups `(name)` contribute no path segment; `_private` folders and
 * `@parallel` slots are not routes at all.
 */
function discoverPageFiles(dir = HERE, segments: string[] = []): PageFile[] {
  const found: PageFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_") || entry.name.startsWith("@")) continue;
      const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
      found.push(
        ...discoverPageFiles(
          path.join(dir, entry.name),
          isGroup ? segments : [...segments, entry.name],
        ),
      );
    } else if (/^page\.tsx?$/.test(entry.name)) {
      const rel = path
        .relative(HERE, path.join(dir, entry.name))
        .split(path.sep)
        .join("/")
        .replace(/\.tsx?$/, "");
      found.push({
        specifier: `./${rel}`,
        pattern: `/${segments.join("/")}`,
      });
    }
  }
  return found;
}

/* ------------------------------------------------------------------ *
 *  2. Resolve each route's indexability from the metadata Next renders.
 * ------------------------------------------------------------------ */

interface RouteMetadata {
  /** Concrete path, e.g. `/tools/merge-pdf`. */
  route: string;
  indexable: boolean;
  canonical: string | undefined;
}

type PageModule = {
  metadata?: Metadata;
  generateMetadata?: (args: {
    params: Promise<Record<string, string>>;
  }) => Promise<Metadata> | Metadata;
  generateStaticParams?: () => Array<Record<string, string>>;
};

/**
 * `robots` on a resolved `Metadata` is a union that includes a raw string and
 * `null`. Only the object form carries `index`, and only `index: false` is a
 * refusal — an absent directive means "indexable" to a crawler, so that is what
 * it means here too. A shape this cannot classify throws rather than defaulting,
 * because a silent default is how a guard goes blind.
 */
function readsAsIndexable(meta: Metadata, route: string): boolean {
  const directive = meta.robots;
  if (directive === undefined || directive === null) return true;
  if (typeof directive === "object" && "index" in directive) {
    return directive.index !== false;
  }
  throw new Error(
    `${route}: cannot classify robots directive ${JSON.stringify(directive)} — teach this guard the shape rather than letting it guess.`,
  );
}

async function resolveRoutes(): Promise<RouteMetadata[]> {
  const resolved: RouteMetadata[] = [];
  for (const page of discoverPageFiles()) {
    const mod: PageModule = await import(/* @vite-ignore */ page.specifier);
    const paramSets = mod.generateStaticParams
      ? mod.generateStaticParams()
      : [{}];

    for (const params of paramSets) {
      const route = page.pattern.replace(/\[(\.{3})?(\w+)\]/g, (_m, _rest, k) =>
        String(params[k as string]),
      );
      const meta = mod.generateMetadata
        ? await mod.generateMetadata({ params: Promise.resolve(params) })
        : mod.metadata;
      if (!meta) {
        throw new Error(
          `${route}: the segment exports neither \`metadata\` nor \`generateMetadata\`, so its robots directive is unknowable here.`,
        );
      }
      const canonical = meta.alternates?.canonical;
      resolved.push({
        route,
        indexable: readsAsIndexable(meta, route),
        canonical: typeof canonical === "string" ? canonical : undefined,
      });
    }
  }
  return resolved;
}

const pathnameOf = (url: string) => new URL(url).pathname;

describe("routes, the sitemap, and the robots directives agree", () => {
  it("the corpus is big enough to mean something", async () => {
    const files = discoverPageFiles();
    const routes = await resolveRoutes();
    const entries = sitemap();

    // Bound at BOTH ends, and report the MEMBERS rather than a count — a zero
    // from a walk is a claim, and it is the claim that makes every ⊆ assertion
    // below report the strongest possible pass. The mirror is a walk that starts
    // following something it should not (a `_private` folder, a parallel slot):
    // that grows the set instead, and answering an easier question is a defect
    // in the same family.
    const patterns = files.map((f) => f.pattern).sort();
    expect(
      patterns.length,
      `route patterns found: ${patterns.join(", ")}`,
    ).toBeGreaterThanOrEqual(5);
    expect(
      patterns.length,
      `route patterns found: ${patterns.join(", ")}`,
    ).toBeLessThan(25);
    // A second, independent bound on the same walk: the `[slug]` segment must
    // have expanded through `generateStaticParams`, so the concrete route count
    // has to clear the catalogue. A walk that found the static pages but silently
    // failed to expand the dynamic one lands inside the range above.
    expect(routes.length).toBeGreaterThanOrEqual(tools.length + 5);
    // Raised from +25 on 2026-09-27, with guides/catalog.test.ts's guide
    // ceiling, when two lanes each added five guides (21 guide routes). It
    // tolerates 25; a count near that is the signal to revisit both.
    expect(routes.length).toBeLessThan(tools.length + 33);
    expect(entries.length).toBeGreaterThanOrEqual(tools.length);
    // It resolves every route module (~1 s alone); under a full parallel run
    // it passed vitest's 5 s default intermittently. Measured 2026-09-27.
  }, 30_000);

  it("both classifications are populated, so the predicate is not blind", async () => {
    const routes = await resolveRoutes();
    const indexable = routes.filter((r) => r.indexable).map((r) => r.route);
    const noindex = routes.filter((r) => !r.indexable).map((r) => r.route);

    // Without this, a `readsAsIndexable` that returned a constant would satisfy
    // one of the two ⊆ checks below trivially and the other vacuously.
    expect(indexable.length).toBeGreaterThan(0);
    expect(
      noindex,
      "no route resolved to `noindex` — either the site really has none (then this control needs a new subject) or metadata resolution has gone blind",
    ).not.toEqual([]);
    // The positive control for the "correctly omitted" arm.
    expect(noindex).toContain("/workspace");
  });

  it("every indexable route is in the sitemap", async () => {
    const routes = await resolveRoutes();
    const inSitemap = new Set(sitemap().map((e) => pathnameOf(e.url)));
    const missing = routes
      .filter((r) => r.indexable && !inSitemap.has(r.route))
      .map((r) => r.route);

    // `/status` was here: `index, follow`, self-canonical, and undiscoverable.
    // A page that invites indexing and is then withheld from the sitemap is
    // asking a crawler to find it by luck.
    expect(missing).toEqual([]);
  });

  it("every sitemap entry is an indexable route", async () => {
    const routes = await resolveRoutes();
    const indexable = new Map(routes.map((r) => [r.route, r.indexable]));
    const wrong = sitemap()
      .map((e) => pathnameOf(e.url))
      .filter((p) => indexable.get(p) !== true);

    // Two failures at once: a sitemap URL that no page serves (a 404 submitted
    // to Search Console), and a sitemap URL whose own page says `noindex` (a
    // direct contradiction, which crawlers resolve against the sitemap).
    expect(wrong).toEqual([]);
  });

  it("every indexable route's canonical is its own URL", async () => {
    // A page in the sitemap that points its canonical somewhere else asks the
    // crawler to index the URL and then to credit a different one.
    const routes = await resolveRoutes();
    const mismatched = routes
      .filter((r) => r.indexable)
      .filter(
        (r) => r.canonical !== new URL(r.route, siteConfig.url).toString(),
      )
      .map((r) => `${r.route} → ${r.canonical}`);
    expect(mismatched).toEqual([]);
  });

  it("robots.txt does not block anything the sitemap advertises", async () => {
    const directives = robots();
    const rules = Array.isArray(directives.rules)
      ? directives.rules
      : [directives.rules];
    const disallowed = rules
      .flatMap((rule) => {
        const value = rule?.disallow;
        return value === undefined
          ? []
          : Array.isArray(value)
            ? value
            : [value];
      })
      .filter((p) => p.trim() !== "");

    // A `Disallow` that covers an indexed URL is worse than useless: the crawler
    // stops fetching the page, so it never reads the very `noindex` a
    // `Disallow` is usually reached for. Today the rule set allows everything —
    // this asserts the sitemap and robots.txt cannot drift into disagreeing.
    const blocked = sitemap()
      .map((e) => pathnameOf(e.url))
      .filter((p) => disallowed.some((rule) => p.startsWith(rule)));
    expect(blocked).toEqual([]);

    // And the sitemap it points crawlers at is the one this module
    // generates. robots.txt may advertise SEVERAL entry points (it gained the
    // sitemap index on 2026-09-20), so the property is membership plus
    // same-origin — not a single string, which would have failed here for the
    // right reason and been "fixed" by deleting the check.
    const declared = Array.isArray(directives.sitemap)
      ? directives.sitemap
      : [directives.sitemap];
    expect(declared).toContain(
      new URL("/sitemap.xml", siteConfig.url).toString(),
    );
    for (const advertised of declared) {
      expect(new URL(String(advertised)).origin).toBe(
        new URL(siteConfig.url).origin,
      );
    }
  });
});

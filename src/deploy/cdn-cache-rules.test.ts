// @vitest-environment node
/**
 * The ORIGIN Cache-Control of every crawler-facing file: present, one value,
 * and one that lets an edge hold it — checked against the rules Next actually
 * loads and the headers the Route Handlers actually return.
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * `robots.txt`, `sitemap.xml`, and the web manifest were given
 * `s-maxage=86400, stale-while-revalidate=604800` in `vercel.json`. The site
 * left Vercel on 2026-08-24 and that file stopped being read by anything —
 * silently, because a dropped cache header changes nothing a visitor can see
 * and nothing a test was watching. Measured on production four days later:
 * `/sitemap.xml` and `/manifest.webmanifest` served
 * `max-age=0, must-revalidate` with `cf-cache-status: DYNAMIC`, so every
 * crawler hit reached a one-vCPU origin to re-render bytes it had already
 * rendered.
 *
 * That is a config file outliving its platform — the same shape as a guard
 * naming files it no longer covers. The rule now lives in `next.config.mjs`,
 * which is read by `next start` wherever it runs, and this pins BOTH halves:
 * the rule is present, and the platform file that used to shadow it is gone.
 *
 * ── WHAT THIS DOES NOT SEE (the titles used to claim it did) ────────────────
 *
 * Until 2026-09-27 this suite was titled "the crawler-facing files stay
 * edge-cacheable" and one test "gives the edge a real window and the browser
 * none". It read next.config.mjs and nothing else, so it could observe
 * neither, and both were false while it was green:
 *
 * - the EDGE: `/sitemap-index.xml` served `cf-cache-status: DYNAMIC` on
 *   2026-09-20 with this file green, and `/sitemaps/pages.xml` still did on
 *   2026-09-27 — edge eligibility is a Cloudflare Cache Rule no test here can
 *   read (docs/DEPLOYMENT.md §2);
 * - the BROWSER: every path in that Cache Rule was served `max-age=14400` on
 *   2026-09-27 while the origin sent `max-age=0` — Cloudflare rewrites it.
 *
 * The titles now say "origin", and the path list is DERIVED from src/app
 * instead of typed: the typed list had four members while five crawler files
 * were served, and the fifth — nested at `sitemaps/pages.xml`, which a
 * one-level walk misses — was the one the edge was not caching.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import loadCustomRoutes from "next/dist/lib/load-custom-routes";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { modifyRouteRegex } from "next/dist/lib/redirect-status";
import nextConfig from "../../next.config.mjs";

const ROOT = process.cwd();
const APP = path.join(ROOT, "src", "app");

/** A crawler-facing URL path and the Route Handler that serves it, if any. */
interface CrawlerFile {
  urlPath: string;
  handler: string | null;
}

/**
 * Metadata-route conventions → the URL Next serves them at. `robots` and
 * `manifest` are root-only in Next; `sitemap` may nest. Static-file forms
 * (`robots.txt` placed in app/) are served under their own name.
 */
const METADATA_FILES: Record<string, string> = {
  "robots.ts": "robots.txt",
  "robots.js": "robots.txt",
  "robots.txt": "robots.txt",
  "sitemap.ts": "sitemap.xml",
  "sitemap.js": "sitemap.xml",
  "sitemap.xml": "sitemap.xml",
  "manifest.ts": "manifest.webmanifest",
  "manifest.js": "manifest.webmanifest",
  "manifest.webmanifest": "manifest.webmanifest",
};

/** A Route Handler whose folder is a crawler document's file name. */
const CRAWLER_HANDLER_DIR = /\.(xml|txt|webmanifest)$/;

/**
 * Walk src/app at every depth. Route groups `(x)` add no URL segment; private
 * folders `_x` are not routable.
 */
function deriveCrawlerFiles(): CrawlerFile[] {
  const found: CrawlerFile[] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name.startsWith("_") || name === "node_modules") continue;
        const isGroup = name.startsWith("(") && name.endsWith(")");
        walk(full, isGroup ? segments : [...segments, name]);
        continue;
      }
      const served = METADATA_FILES[name];
      if (served) {
        found.push({ urlPath: [...segments, served].join("/"), handler: null });
      } else if (
        /^route\.(ts|js)$/.test(name) &&
        CRAWLER_HANDLER_DIR.test(segments.at(-1) ?? "")
      ) {
        found.push({ urlPath: segments.join("/"), handler: full });
      }
    }
  };
  walk(APP, []);
  return found.sort((a, b) => a.urlPath.localeCompare(b.urlPath));
}

const CRAWLER_FILES = deriveCrawlerFiles();

/** Header rules exactly as `next build` / `next start` load them. */
async function loadHeaderRules() {
  const routes = await loadCustomRoutes({
    ...nextConfig,
    basePath: "",
    trailingSlash: false,
  } as unknown as Parameters<typeof loadCustomRoutes>[0]);
  return routes.headers;
}

/**
 * The Cache-Control next.config.mjs attaches to `/<urlPath>`, matched the way
 * `next/dist/server/lib/router-utils/filesystem.js` builds header routes.
 * Later matching rules override earlier ones for the same key.
 */
async function configCacheControl(urlPath: string): Promise<string | null> {
  let value: string | null = null;
  for (const rule of await loadHeaderRules()) {
    const match = getPathMatch(rule.source, {
      strict: true,
      removeUnnamedParams: true,
      regexModifier: (regex) => modifyRouteRegex(regex),
    });
    if (!match(`/${urlPath}`)) continue;
    for (const header of rule.headers) {
      if (header.key.toLowerCase() === "cache-control") value = header.value;
    }
  }
  return value;
}

/** The Cache-Control a Route Handler's own Response carries. */
async function handlerCacheControl(file: string): Promise<string | null> {
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
    GET?: () => Response | Promise<Response>;
  };
  expect(mod.GET, `${file} exports no GET`).toBeTypeOf("function");
  const res = await mod.GET!();
  return res.headers.get("cache-control");
}

/** Every origin-side Cache-Control for each crawler path, by source. */
async function originHeaders() {
  return Promise.all(
    CRAWLER_FILES.map(async (file) => ({
      urlPath: file.urlPath,
      config: await configCacheControl(file.urlPath),
      handler: file.handler ? await handlerCacheControl(file.handler) : null,
    })),
  );
}

describe("origin Cache-Control for the crawler-facing files (next.config.mjs + Route Handlers)", () => {
  it("derives a plausible crawler set from src/app, nested sitemaps included", () => {
    // Health check and positive control on the derivation itself. Five on
    // 2026-09-27; far outside 4..12 means the walk broke, and every assertion
    // below would then pass (or fail) about the wrong set.
    const paths = CRAWLER_FILES.map((f) => f.urlPath);
    expect(paths.length).toBeGreaterThanOrEqual(4);
    expect(paths.length).toBeLessThanOrEqual(12);
    for (const known of ["robots.txt", "sitemap.xml", "sitemaps/pages.xml"]) {
      expect(paths, `the walk did not find ${known}`).toContain(known);
    }
  });

  it("gives every derived crawler path an origin Cache-Control, and one value where two sources set it", async () => {
    // A Route Handler's headers are its own, so a path served by one needs no
    // config rule — but where both set it, they must agree, or which one wins
    // at the origin becomes the thing nobody knows.
    const problems: string[] = [];
    for (const { urlPath, config, handler } of await originHeaders()) {
      if (!config && !handler) problems.push(`/${urlPath}: no Cache-Control`);
      if (config && handler && config !== handler)
        problems.push(`/${urlPath}: config "${config}" ≠ handler "${handler}"`);
    }
    expect(problems).toEqual([]);
  });

  it("has the origin ask for an edge window (s-maxage ≥ 1h, stale-while-revalidate) and browser revalidation (max-age=0)", async () => {
    // What the ORIGIN asks for. Whether Cloudflare caches it is its Cache
    // Rule's decision, and it currently rewrites max-age to 14400 on the paths
    // it caches (docs/DEPLOYMENT.md §2) — neither is observable from here.
    const problems: string[] = [];
    for (const { urlPath, config, handler } of await originHeaders()) {
      const value = handler ?? config ?? "";
      // Read as a NUMBER, not matched as a string: `s-maxage=1` would satisfy
      // a presence check while caching nothing.
      const sMaxAge = Number(/\bs-maxage=(\d+)\b/.exec(value)?.[1] ?? 0);
      if (sMaxAge < 3600) problems.push(`/${urlPath}: s-maxage ${sMaxAge}`);
      if (!/\bstale-while-revalidate=\d+/.test(value))
        problems.push(`/${urlPath}: no stale-while-revalidate`);
      if (!/(^|[\s,])max-age=0\b/.test(value))
        problems.push(`/${urlPath}: origin max-age is not 0 ("${value}")`);
    }
    expect(problems).toEqual([]);
  });

  it("names no path in the config's crawler rule that the app does not serve", async () => {
    // The other direction of coverage: a stale alternative in the grouped
    // `source` is a claim about a file that no longer exists.
    const derived = new Set(CRAWLER_FILES.map((f) => f.urlPath));
    const grouped = (await loadHeaderRules())
      .filter((rule) =>
        rule.headers.some((h) => h.key.toLowerCase() === "cache-control"),
      )
      .map((rule) => /^\/\(([^)]+)\)$/.exec(rule.source)?.[1])
      .filter((alts): alts is string => Boolean(alts));
    expect(grouped.length, "no grouped crawler rule in next.config.mjs").toBe(
      1,
    );
    const stale = grouped[0]!.split("|").filter((alt) => !derived.has(alt));
    expect(stale).toEqual([]);
  });

  it("keeps no platform config file that could shadow it again", () => {
    // `vercel.json` carried this rule and was still in the tree, still
    // correct-looking, and read by nothing, for four days after the move. A
    // deleted file cannot drift; a dormant one waits to be believed.
    expect(existsSync(path.join(ROOT, "vercel.json"))).toBe(false);
  });
});

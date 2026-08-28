// @vitest-environment node
/**
 * The crawler-facing files must be cacheable at the edge — and the rule must
 * live where the platform we actually run can read it.
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
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const config = readFileSync(path.join(ROOT, "next.config.mjs"), "utf8");

/** The three paths only crawlers and installers fetch. */
const CRAWLER_PATHS = ["robots.txt", "sitemap.xml", "manifest.webmanifest"];

describe("the crawler-facing files stay edge-cacheable", () => {
  it("names all three in one rule", () => {
    const rule = config.match(/source:\s*"\/\(([^)]+)\)"/);
    expect(
      rule,
      "no grouped source rule found in next.config.mjs",
    ).toBeTruthy();
    const covered = rule![1]!.split("|").map((p) => p.trim());
    // Compared as sets: order is not the property, coverage is.
    expect([...covered].sort()).toEqual([...CRAWLER_PATHS].sort());
  });

  it("gives the edge a real window and the browser none", () => {
    // `max-age=0` keeps browsers revalidating (a stale sitemap in a browser
    // cache helps nobody); `s-maxage` is the half that takes load off the
    // origin, and it is the half that silently went missing.
    const matched = config.match(
      /source:\s*"\/\((?:robots|sitemap|manifest)[^"]*"[\s\S]{0,400}?value:\s*\n?\s*"([^"]+)"/,
    );
    const cacheControl = matched?.[1] ?? "";
    expect(cacheControl, "the rule carries no Cache-Control value").not.toBe(
      "",
    );
    expect(cacheControl).toMatch(/\bmax-age=0\b/);
    expect(cacheControl).toMatch(/\bstale-while-revalidate=\d+/);
    // The edge window is read as a NUMBER, not matched as a string: `s-maxage=1`
    // would satisfy a presence check while caching nothing.
    const sMaxAge = Number(/\bs-maxage=(\d+)\b/.exec(cacheControl)?.[1] ?? 0);
    expect(sMaxAge).toBeGreaterThanOrEqual(3600);
  });

  it("keeps no platform config file that could shadow it again", () => {
    // `vercel.json` carried this rule and was still in the tree, still
    // correct-looking, and read by nothing, for four days after the move. A
    // deleted file cannot drift; a dormant one waits to be believed.
    expect(existsSync(path.join(ROOT, "vercel.json"))).toBe(false);
  });
});

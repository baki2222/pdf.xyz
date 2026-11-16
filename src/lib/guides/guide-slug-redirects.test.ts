// @vitest-environment node
/**
 * A guide URL that was ever served stays served, or moves with a 308 (audit
 * #2, 2026-11-17).
 *
 * The size guides keep their slugs (`…-to-100-kb`) though their titles name
 * every preset: renaming an indexed URL throws away what it has earned unless
 * a permanent redirect carries it. Nothing here forbids a rename; it forbids
 * a rename WITHOUT the redirect.
 *
 * The subjects are DERIVED from `src/deploy/ssr-baseline.json`, the record of
 * pages a build has already prerendered, never typed: every `guides/<slug>.html`
 * key there is a URL a deployment served. Each must still be a guide, or be
 * the `source` of a `permanent: true` entry in `next.config.mjs`'s
 * `redirects()` whose destination is a current guide.
 */
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config.mjs";
import baseline from "../../deploy/ssr-baseline.json";
import { getAllGuideSlugs } from "./index";

interface Redirect {
  source: string;
  destination: string;
  permanent?: boolean;
  has?: unknown;
}

const GUIDE_KEY = /^guides\/(.+)\.html$/;

/** Every guide slug a recorded build prerendered. */
const servedSlugs = Object.keys((baseline as { pages: object }).pages).flatMap(
  (key) => {
    const m = GUIDE_KEY.exec(key);
    return m ? [m[1]!] : [];
  },
);

/** The served slugs that are neither a guide now nor permanently redirected to one. */
function lostGuideSlugs(
  served: readonly string[],
  current: readonly string[],
  redirects: readonly Redirect[],
): string[] {
  const live = new Set(current);
  return served.filter((slug) => {
    if (live.has(slug)) return false;
    return !redirects.some(
      (r) =>
        r.source === `/guides/${slug}` &&
        r.permanent === true &&
        r.has === undefined &&
        live.has(r.destination.replace(/^\/guides\//, "")) &&
        r.destination.startsWith("/guides/"),
    );
  });
}

async function configRedirects(): Promise<Redirect[]> {
  const fn = (nextConfig as { redirects?: () => Promise<Redirect[]> })
    .redirects;
  return fn ? await fn() : [];
}

describe("every guide URL a build served is still a guide, or 308s to one", () => {
  it("derives the served set from the baseline (health check: at least 66, both size guides)", () => {
    expect(servedSlugs.length).toBeGreaterThanOrEqual(66);
    expect(servedSlugs).toEqual(
      expect.arrayContaining([
        "how-to-compress-a-pdf-to-100-kb",
        "how-to-convert-jpg-to-pdf-under-100-kb",
      ]),
    );
  });

  it("no served guide slug is lost", async () => {
    expect(
      lostGuideSlugs(servedSlugs, getAllGuideSlugs(), await configRedirects()),
    ).toEqual([]);
  });

  it("reports exactly a slug that disappears without a redirect (positive control)", async () => {
    const gone = "how-to-compress-a-pdf-to-100-kb";
    const current = getAllGuideSlugs().filter((s) => s !== gone);
    expect(
      lostGuideSlugs(servedSlugs, current, await configRedirects()),
    ).toEqual([gone]);
  });

  it("a permanent redirect to a current guide clears it, and only that (negative control)", async () => {
    const gone = "how-to-compress-a-pdf-to-100-kb";
    const current = getAllGuideSlugs().filter((s) => s !== gone);
    const to = "/guides/how-to-convert-jpg-to-pdf-under-100-kb";
    const config = await configRedirects();
    expect(
      lostGuideSlugs(servedSlugs, current, [
        ...config,
        { source: `/guides/${gone}`, destination: to, permanent: true },
      ]),
    ).toEqual([]);
    // A temporary redirect, or one to a page that is not a guide, does not.
    expect(
      lostGuideSlugs(servedSlugs, current, [
        ...config,
        { source: `/guides/${gone}`, destination: to, permanent: false },
        { source: `/guides/${gone}`, destination: "/tools", permanent: true },
      ]),
    ).toEqual([gone]);
  });
});

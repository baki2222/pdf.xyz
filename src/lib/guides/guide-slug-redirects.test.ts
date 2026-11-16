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
 * The property is "a URL a deployment ever served", and the subjects come
 * from `served-guide-slugs.json`, an APPEND-ONLY ledger of guide slugs. Each
 * must still be a guide, or be the `source` of a `permanent: true` entry in
 * `next.config.mjs`'s `redirects()` whose destination is a current guide.
 *
 * History (review of 2026-11-17): the first version read its subjects from
 * `src/deploy/ssr-baseline.json` alone. A renaming PR regenerates that file
 * (`pnpm ssr:baseline`), so the old slug left the guard's set in the same
 * commit that dropped it, and a rename with no redirect passed green; only
 * the two slugs the health check named were safe. The baseline is now a
 * second source the ledger must COVER, never the set the guard runs over; the
 * control "a rename regenerated into the baseline" below keeps that hole
 * visible. Seeded from every `guides/*.html` key in every committed version
 * of the baseline (66, all still guides on 2026-11-17).
 */
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config.mjs";
import baseline from "../../deploy/ssr-baseline.json";
import ledger from "./served-guide-slugs.json";
import { getAllGuideSlugs } from "./index";

interface Redirect {
  source: string;
  destination: string;
  permanent?: boolean;
  has?: unknown;
}

const GUIDE_KEY = /^guides\/(.+)\.html$/;
const SIZE_GUIDES = [
  "how-to-compress-a-pdf-to-100-kb",
  "how-to-convert-jpg-to-pdf-under-100-kb",
];

/** Every guide slug a set of recorded pages holds. */
function guideSlugsOf(pages: object): string[] {
  return Object.keys(pages).flatMap((key) => {
    const m = GUIDE_KEY.exec(key);
    return m ? [m[1]!] : [];
  });
}
const baselineSlugs = guideSlugsOf((baseline as { pages: object }).pages);
const served: readonly string[] = ledger;

/** The served slugs that are neither a guide now nor permanently redirected to one. */
function lostGuideSlugs(
  servedSet: readonly string[],
  current: readonly string[],
  redirects: readonly Redirect[],
): string[] {
  const live = new Set(current);
  return servedSet.filter((slug) => {
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

const missingFrom = (set: readonly string[], from: readonly string[]) => {
  const have = new Set(from);
  return set.filter((s) => !have.has(s));
};

async function configRedirects(): Promise<Redirect[]> {
  const fn = (nextConfig as { redirects?: () => Promise<Redirect[]> })
    .redirects;
  return fn ? await fn() : [];
}

describe("every guide URL ever served is still a guide, or 308s to one", () => {
  it("the ledger is plausible: at least 66 slugs, both size guides, sorted, no repeats (health check)", () => {
    expect(served.length).toBeGreaterThanOrEqual(66);
    expect(served).toEqual(expect.arrayContaining(SIZE_GUIDES));
    expect([...served].sort()).toEqual(served);
    expect(new Set(served).size).toBe(served.length);
    // The second source is plausible too: a baseline that lost its guide
    // pages would make the next check vacuous.
    expect(baselineSlugs.length).toBeGreaterThanOrEqual(66);
  });

  it("every current guide is in the ledger (append a new guide's slug to served-guide-slugs.json)", () => {
    expect(missingFrom(getAllGuideSlugs(), served)).toEqual([]);
  });

  it("every guide page the SSR baseline records is in the ledger", () => {
    expect(missingFrom(baselineSlugs, served)).toEqual([]);
  });

  it("no served guide slug is lost", async () => {
    expect(
      lostGuideSlugs(served, getAllGuideSlugs(), await configRedirects()),
    ).toEqual([]);
  });

  it("reports exactly a slug that disappears without a redirect (positive control)", async () => {
    const gone = SIZE_GUIDES[0]!;
    const current = getAllGuideSlugs().filter((s) => s !== gone);
    expect(lostGuideSlugs(served, current, await configRedirects())).toEqual([
      gone,
    ]);
  });

  it("a rename regenerated into the baseline is still caught, for a guide no check names (control)", async () => {
    // Discovered, not typed: the first guide that is not a size guide.
    const gone = getAllGuideSlugs().find((s) => !SIZE_GUIDES.includes(s))!;
    expect(gone).toBeTruthy();
    const renamed = `${gone}-renamed`;
    const current = getAllGuideSlugs().map((s) => (s === gone ? renamed : s));
    // What `pnpm ssr:baseline` records after the rename.
    const regenerated = baselineSlugs.map((s) => (s === gone ? renamed : s));
    const config = await configRedirects();
    // The baseline alone cannot see it: the hole the first version had.
    expect(lostGuideSlugs(regenerated, current, config)).toEqual([]);
    // The ledger does, and the new slug is reported as missing from it.
    expect(lostGuideSlugs(served, current, config)).toEqual([gone]);
    expect(missingFrom(current, served)).toEqual([renamed]);
  });

  it("a permanent redirect to a current guide clears it, and only that (negative control)", async () => {
    const gone = SIZE_GUIDES[0]!;
    const current = getAllGuideSlugs().filter((s) => s !== gone);
    const to = `/guides/${SIZE_GUIDES[1]!}`;
    const config = await configRedirects();
    expect(
      lostGuideSlugs(served, current, [
        ...config,
        { source: `/guides/${gone}`, destination: to, permanent: true },
      ]),
    ).toEqual([]);
    // A temporary redirect, or one to a page that is not a guide, does not.
    expect(
      lostGuideSlugs(served, current, [
        ...config,
        { source: `/guides/${gone}`, destination: to, permanent: false },
        { source: `/guides/${gone}`, destination: "/tools", permanent: true },
      ]),
    ).toEqual([gone]);
  });
});

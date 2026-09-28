// @vitest-environment node
/**
 * `www.<apex>` answers every path with a PERMANENT redirect to the same path on
 * the apex — checked by running `next.config.mjs` through Next's own route
 * loader and matcher, not by reading the config as text.
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * `www` is a proxied CNAME of the apex (docs/DEPLOYMENT.md §4) and nothing
 * redirected it. Measured 2026-09-27: `https://www.pdf.xyz/tools/merge-pdf`
 * → `200 OK`, `x-nextjs-cache: HIT` — the entire site served on two hosts, with
 * only the canonical tag saying which copy counts, while Search Console knew
 * about 30 of the site's 67 URLs and had indexed 27 (read 2026-09-20).
 *
 * ── WHAT IS DERIVED, AND FROM WHAT ─────────────────────────────────────────
 *
 * - The hosts come from `siteConfig.url`, the canonical origin every page's
 *   `<link rel=canonical>` already uses. The config has to type its host (an
 *   `.mjs` file loaded by `next start` cannot import `src/`), so this is the
 *   relationship pin: change the domain in one place and not the other, and
 *   the www host this file derives stops being redirected.
 * - The paths come from `sitemap()` — the site's own published list of what
 *   exists — plus the crawler files and a query-string case. Bounded below, so
 *   a sitemap that renders empty cannot turn "every path redirects" into
 *   `[] ⊆ X`.
 *
 * ── WHAT THIS DOES NOT SEE ─────────────────────────────────────────────────
 *
 * Whether production serves it. This proves the rule Next would load; the
 * wire (`curl -sI https://www.pdf.xyz/tools/merge-pdf`, expecting 308 and a
 * Location on the apex) is the check after deploy, and the http→https hop in
 * front of it is not this repository's (DEPLOYMENT.md §4, owner action).
 */
import { format as formatUrl } from "node:url";
import { describe, expect, it } from "vitest";
import loadCustomRoutes from "next/dist/lib/load-custom-routes";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import {
  matchHas,
  prepareDestination,
} from "next/dist/shared/lib/router/utils/prepare-destination";
import {
  getRedirectStatus,
  modifyRouteRegex,
} from "next/dist/lib/redirect-status";
import { addRequestMeta } from "next/dist/server/request-meta";
import { stringifyQuery } from "next/dist/server/server-route-utils";
import { normalizeRepeatedSlashes } from "next/dist/shared/lib/utils";
import nextConfig from "../../next.config.mjs";
import sitemap from "@/app/sitemap";
import { siteConfig } from "@/lib/site";

const APEX = new URL(siteConfig.url);
const WWW_HOST = `www.${APEX.hostname}`;

type Redirect = Awaited<
  ReturnType<typeof loadCustomRoutes>
>["redirects"][number];

/** The redirects exactly as `next build` / `next start` load them. */
async function loadRedirects(): Promise<Redirect[]> {
  const routes = await loadCustomRoutes({
    ...nextConfig,
    basePath: "",
    trailingSlash: false,
    // Cast: the loader takes the full resolved NextConfig; these are the
    // fields it reads, with Next's defaults for the ones we do not set.
  } as unknown as Parameters<typeof loadCustomRoutes>[0]);
  return routes.redirects;
}

/**
 * One request through the redirect phase, the way
 * `next/dist/server/lib/router-utils/{filesystem,resolve-routes}.js` does it:
 * the same matcher options (including the `/_next` exemption), the same
 * `has` check against the Host header, the same destination compiler and
 * status. Returns the first redirect that fires, or null.
 */
function resolve(
  redirects: Redirect[],
  host: string,
  pathAndQuery: string,
): { status: number; location: string } | null {
  const url = new URL(pathAndQuery, "http://placeholder");
  const query = Object.fromEntries(url.searchParams);
  // A request as the router sees it: the Host header, and the parsed initial
  // query recorded the way router-server records it (stringifyQuery encodes
  // only values it can find there).
  const req = { headers: { host } } as unknown as Parameters<
    typeof matchHas
  >[0] &
    Parameters<typeof stringifyQuery>[0];
  addRequestMeta(req, "initQuery", { ...query });
  for (const route of redirects) {
    const match = getPathMatch(route.source, {
      strict: true,
      removeUnnamedParams: true,
      // `internal` is set on Next's own trailing-slash redirects and is not
      // in the public Redirect type.
      regexModifier: (regex) =>
        (route as { internal?: boolean }).internal
          ? regex
          : modifyRouteRegex(regex, ["/_next"]),
    });
    let params = match(url.pathname);
    if (!params) continue;
    if (route.has || route.missing) {
      const hasParams = matchHas(req, query, route.has, route.missing);
      if (!hasParams) continue;
      params = { ...params, ...hasParams };
    }
    const { parsedDestination } = prepareDestination({
      appendParamsToQuery: false,
      destination: route.destination,
      params,
      query,
    });
    // resolve-routes.js, then router-server.js's `url.format(parsedUrl)`.
    const destQuery = parsedDestination.query;
    const target: Record<string, unknown> = { ...parsedDestination };
    delete target.query;
    target.search = stringifyQuery(req, destQuery);
    target.pathname = normalizeRepeatedSlashes(parsedDestination.pathname);
    return {
      status: getRedirectStatus(route),
      location: formatUrl(target as unknown as URL),
    };
  }
  return null;
}

/** The corpus: every sitemap path, the crawler files, and a query string. */
function corpus(): string[] {
  const fromSitemap = sitemap().map((entry) => {
    const u = new URL(entry.url);
    return `${u.pathname}${u.search}`;
  });
  return [
    ...new Set([
      "/",
      ...fromSitemap,
      "/robots.txt",
      "/sitemap.xml",
      "/sitemap-index.xml",
      "/sitemaps/pages.xml",
      "/manifest.webmanifest",
      "/tools/merge-pdf?utm_source=backlink&ref=a%20b",
    ]),
  ];
}

describe("www redirects to the apex", () => {
  it("derives a www host that is not the apex itself", () => {
    // Health check on the derivation: were siteConfig.url ever www, "www." +
    // hostname would name a host nobody serves and every assertion below
    // would be about the wrong pair.
    expect(APEX.hostname.startsWith("www.")).toBe(false);
    expect(APEX.protocol).toBe("https:");
  });

  it("walks a corpus the size of the site, not an empty one", () => {
    // The sitemap held 67 URLs on 2026-09-20; a corpus far below that means
    // the derivation broke, and "every path redirects" would be vacuous.
    const paths = corpus();
    expect(paths.length).toBeGreaterThanOrEqual(60);
    expect(paths.length).toBeLessThan(500);
  });

  it("answers every path on www with 301/308 to the same path and query on the apex", async () => {
    const redirects = await loadRedirects();
    const wrong: string[] = [];
    for (const path of corpus()) {
      const got = resolve(redirects, WWW_HOST, path);
      const expected = `${APEX.origin}${path}`;
      // Compared as parsed URLs: `https://pdf.xyz` and `https://pdf.xyz/` are
      // the same resource (Next emits the former for `/`). Query encoding is
      // NOT normalised by this — `a+b` and `a%20b` stay different.
      if (
        !got ||
        (got.status !== 301 && got.status !== 308) ||
        new URL(got.location).href !== new URL(expected).href
      ) {
        wrong.push(
          `${WWW_HOST}${path} → ${got ? `${got.status} ${got.location}` : "no redirect"} (want 301/308 ${expected})`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  it("serves the apex itself without redirecting (no loop, and the positive control)", async () => {
    // The inverse half. A rule that fired on every host would pass the test
    // above and send the apex into a redirect loop; this is also what shows
    // the resolver can tell hosts apart at all.
    const redirects = await loadRedirects();
    const fired = corpus()
      .map((path) => [path, resolve(redirects, APEX.hostname, path)] as const)
      .filter(([, got]) => got !== null);
    expect(fired).toEqual([]);
  });

  it("matches the www host exactly, not by substring or unescaped dot", async () => {
    const redirects = await loadRedirects();
    const lookalikes = [
      `beta.${APEX.hostname}`,
      `${WWW_HOST}.example.com`,
      `x${WWW_HOST}`,
      WWW_HOST.replace(".", "x"),
    ];
    for (const host of lookalikes) {
      expect(resolve(redirects, host, "/tools"), host).toBeNull();
    }
    // Host headers carry a port behind some proxies; Next strips it, and so
    // must the match.
    expect(resolve(redirects, `${WWW_HOST}:443`, "/tools")?.location).toBe(
      `${APEX.origin}/tools`,
    );
  });
});

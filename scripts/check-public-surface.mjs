/**
 * Does the SITE still serve? — the companion to `check-operations-posture.mjs`.
 *
 * That check reads one JSON payload and answers "is the worker fleet healthy".
 * It is deliberately narrow, and the narrowness left a real hole: between the
 * Vercel exit and this file, a page-level 500 on `/tools`, a sitemap that
 * stopped parsing, or a lost `X-Robots-Tag` on `beta` would have alerted
 * NOBODY. The operations payload would have gone on saying `health: ok`,
 * truthfully, about a different question.
 *
 * ── THE CORPUS IS DERIVED, NOT TYPED ────────────────────────────────────────
 *
 * A hand-typed page list cannot see a page it does not name, and this codebase
 * has paid for that four separate ways (CLAUDE.md rule 4). The set here comes
 * from the site's OWN published claim of what should be reachable — the
 * sitemap — so adding a tool page enrolls it automatically and REMOVING one
 * from the sitemap cannot quietly shrink the check: the plausibility bound
 * below fails first.
 *
 * ── THE noindex PAIR, AND WHY BOTH HALVES ARE HERE ──────────────────────────
 *
 * `beta.pdf.xyz` must carry `noindex` (it serves the same app; indexed, it is
 * duplicate content competing with the apex). The apex must NOT. Coolify sets
 * this per-domain from a single array — one misclick moves it — and a
 * deindexed apex is the most expensive silent failure this product has: it
 * looks perfect to every visitor while Google drops the site.
 *
 * They are checked TOGETHER on purpose. The beta assertion is the positive
 * control for the instrument: if header reading broke, "apex has no noindex"
 * would keep passing for the wrong reason, and a check that cannot fail is
 * the defect this repository exists to prevent.
 */

import { readFile } from "node:fs/promises";

const BASE = process.argv[2] ?? process.env.SURFACE_BASE ?? "https://pdf.xyz";
const BETA = process.env.SURFACE_BETA ?? "https://beta.pdf.xyz";
const TIMEOUT_MS = 20_000;

/**
 * The sitemap lists 50 tool pages, the guides, and a handful of top-level
 * routes — 66 URLs when the guides section shipped (2026-09-17). A sitemap
 * that suddenly holds a dozen URLs is itself the alarm — without this, a
 * shrunken corpus reports the strongest possible pass (`[] ⊆ X`). Raised
 * 40 → 60 with the guides: a floor 26 under the real count would have let
 * the entire guides section vanish without a word from the watcher.
 */
const MIN_SITEMAP_URLS = 60;

/** How many derived tool pages to sample, spread evenly across the sitemap. */
const SAMPLE = 6;

class SurfaceFailure extends Error {
  name = "SurfaceFailure";
}

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exitCode = 1;
  throw new SurfaceFailure();
}

// Same rationale as the operations check: let the process end naturally so the
// message flushes, rather than tearing down a closing socket with process.exit.
process.on("uncaughtException", (err) => {
  if (!(err instanceof SurfaceFailure)) throw err;
});

async function get(url) {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err) => {
    if (err instanceof SurfaceFailure) throw err;
    fail([
      `UNREACHABLE — ${url}`,
      `  ${err instanceof Error ? err.message : String(err)}`,
      "  Unreachable is not healthy.",
    ]);
  });
  return {
    status: res.status,
    robots: res.headers.get("x-robots-tag") ?? "",
    contentType: res.headers.get("content-type") ?? "",
    // WAS DISCARDED. Every other header this response carries was dropped
    // here, which is why the only production assertions this file could make
    // were about two of them — and why the security headers below had never
    // been checked anywhere except a LOCAL `next start`.
    headers: res.headers,
    body: await res.text(),
  };
}

const isNoindex = (value) => /noindex/i.test(value);

// ---- the sitemap, which is both a check and the source of the corpus ----
// Cache-busted, deliberately: /sitemap.xml carries `s-maxage=86400`, so for up
// to a day after a deploy that GROWS the sitemap, some Cloudflare colos still
// serve the old one — and this check then fails its own shrink bound against a
// perfectly healthy origin (measured 2026-09-17: one runner read 67 URLs, the
// next read 55, eight minutes apart, straddling the guides launch). The corpus
// must be the origin's current truth; the query string gives the edge a key it
// has never cached. The SAMPLED pages below stay un-busted on purpose — for
// them, what the edge serves IS what a crawler receives.
const sitemapUrl = `${BASE}/sitemap.xml?corpus=${Date.now()}`;
const sitemap = await get(sitemapUrl);
if (sitemap.status !== 200 || !/xml/i.test(sitemap.contentType)) {
  fail([
    `SITEMAP — ${sitemapUrl} answered ${sitemap.status} (${sitemap.contentType || "no content-type"})`,
    "  Search engines read this file; a non-XML 200 is as broken as a 500.",
  ]);
}

const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
  m[1].trim(),
);
if (locs.length < MIN_SITEMAP_URLS) {
  fail([
    `SITEMAP — only ${locs.length} URLs (expected at least ${MIN_SITEMAP_URLS})`,
    "  A corpus that shrinks silently turns every check below into a vacuous",
    "  pass. Either the catalogue lost pages or the sitemap stopped rendering.",
  ]);
}

// A deterministic spread rather than the first N: consecutive entries share a
// code path, so the first six would test one route six times.
const step = Math.max(1, Math.floor(locs.length / SAMPLE));
const sampled = Array.from(
  { length: Math.min(SAMPLE, locs.length) },
  (_, i) => locs[i * step],
)
  // The sitemap publishes ABSOLUTE canonical URLs, so a sampled entry names
  // the apex whatever BASE is. Left alone, running this against any other
  // origin would probe production pages and report them as that origin's —
  // a right command over the wrong set, in the one file written to prevent
  // exactly that. Re-home each path onto the BASE actually under test.
  .map((loc) => {
    try {
      return new URL(new URL(loc).pathname, BASE).toString();
    } catch {
      return new URL(loc, BASE).toString();
    }
  });

// Top-level routes always checked by name — they are the ones a visitor and a
// crawler reach first, and they are FEWER than the derived set, not instead
// of it.
const always = [
  `${BASE}/`,
  `${BASE}/tools`,
  `${BASE}/guides`,
  // The sitemap index, added 2026-09-20. It is a crawler entry point that no
  // human ever opens, which is exactly the class of URL that breaks unwatched.
  `${BASE}/sitemap-index.xml`,
  `${BASE}/privacy`,
  `${BASE}/terms`,
];
const targets = [...new Set([...always, ...sampled])];

const broken = [];
const wronglyHidden = [];
for (const url of targets) {
  const page = await get(url);
  if (page.status !== 200) broken.push(`${url} → HTTP ${page.status}`);
  // The apex must stay indexable. `/workspace` is legitimately noindex, but it
  // is not in the sitemap, so it cannot appear here.
  if (isNoindex(page.robots))
    wronglyHidden.push(`${url} → X-Robots-Tag: ${page.robots}`);
}

// ---- the inverse control: beta MUST be hidden ----
const beta = await get(`${BETA}/`);
const betaVisible = beta.status === 200 && !isNoindex(beta.robots);

if (broken.length || wronglyHidden.length || betaVisible) {
  fail([
    "pdf.xyz public surface is NOT ok",
    "",
    ...(broken.length
      ? ["  pages not serving 200:", ...broken.map((b) => `    ${b}`), ""]
      : []),
    ...(wronglyHidden.length
      ? [
          "  INDEXABLE PAGES MARKED noindex — this deindexes the site:",
          ...wronglyHidden.map((w) => `    ${w}`),
          "    Check Coolify → the app's domains → per-domain noindex list.",
          "",
        ]
      : []),
    ...(betaVisible
      ? [
          `  ${BETA} is INDEXABLE (status ${beta.status}, x-robots-tag: ${beta.robots || "absent"})`,
          "    It serves the same app; indexed, it competes with the apex.",
          "",
        ]
      : []),
    `  corpus: ${targets.length} URLs derived from ${locs.length} sitemap entries`,
  ]);
}

// ---- the security headers, checked where they are actually served ----
/**
 * `next.config.mjs` defines seven response headers — CSP, HSTS, COOP,
 * Permissions-Policy, Referrer-Policy, X-Content-Type-Options, X-Frame-Options.
 * Until now NOTHING asserted them in production. The only check was
 * `e2e/smoke.spec.ts`, which runs against a local `next start`, and
 * `Strict-Transport-Security` is emitted under `if (!isDev)` — so the one
 * header that cannot be observed locally was also the one nobody fetched
 * remotely.
 *
 * This repo has already paid for exactly that gap once, and said so in
 * `next.config.mjs` itself: the CDN cache rule "lived in `vercel.json` and
 * stopped applying the moment the site left Vercel — silently." A header block
 * is the same kind of thing: config that only means something at the tier that
 * serves it.
 *
 * Measured 2026-09-20 before writing this: all seven were present on
 * `https://pdf.xyz/`. The gap was in the checking, not in the site — which is
 * exactly when a guard is cheapest to add and least likely to be believed
 * later.
 *
 * THE NAMES ARE DERIVED from `next.config.mjs`, never typed here. Add a header
 * there and this demands it in production; delete one deliberately and this
 * stops asking, in the same commit. A typed list could do neither.
 */
const configSource = await readFile(
  new URL("../next.config.mjs", import.meta.url),
  "utf8",
);
// `securityHeaders()` — NOT `async headers()`, which is where the parse was
// pointed first and found nothing: the list is a const built ABOVE the config
// object and merely referenced from it. The health check below caught that,
// which is the whole reason it is above the assertion instead of after it.
const headersStart = configSource.indexOf("function securityHeaders()");
const headersBlock =
  headersStart === -1 ? "" : configSource.slice(headersStart);
const expectedHeaders = [
  ...new Set(
    [...headersBlock.matchAll(/key:\s*"([A-Za-z-]+)"/g)].map((m) =>
      m[1].toLowerCase(),
    ),
  ),
].filter((name) => name !== "cache-control");

// Health check, before the assertion that depends on it. A parse that found
// nothing would make the loop below vacuously true — `[] ⊆ X`, the strongest
// possible pass — and a parse that swallowed the whole file would fail for a
// reason nobody could act on.
if (expectedHeaders.length < 5 || expectedHeaders.length > 20) {
  fail([
    `SECURITY HEADER LIST DID NOT PARSE — found ${expectedHeaders.length}`,
    `  ${expectedHeaders.join(", ") || "(none)"}`,
    "  next.config.mjs's `async headers()` block is the source of this list.",
    "  If its shape changed, fix the parse — do not delete the check.",
  ]);
}

const home = await get(`${BASE}/?headers=${Date.now()}`);
const missingHeaders = expectedHeaders.filter(
  (name) => !home.headers.get(name),
);
if (missingHeaders.length > 0) {
  fail([
    "SECURITY HEADERS MISSING IN PRODUCTION —",
    ...missingHeaders.map(
      (name) => `    ${name} is defined in next.config.mjs and not served`,
    ),
    "",
    "  These are emitted by the Next app, so the usual cause is that the",
    "  response never reached it: a proxy, a cached error object, or a tier",
    "  serving static bytes. Check Coolify and the Cloudflare rules.",
    `  expected ${expectedHeaders.length}: ${expectedHeaders.join(", ")}`,
  ]);
}

console.log(
  `ok — ${targets.length} pages serve 200 and stay indexable ` +
    `(from ${locs.length} sitemap URLs), beta stays noindex, ` +
    `${expectedHeaders.length} security headers served`,
);

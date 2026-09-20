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

console.log(
  `ok — ${targets.length} pages serve 200 and stay indexable ` +
    `(from ${locs.length} sitemap URLs), beta stays noindex`,
);

#!/usr/bin/env node
/**
 * Tell IndexNow — Bing, and through it DuckDuckGo, Yahoo and ChatGPT search,
 * plus Yandex, Seznam and Naver — which pdf.xyz URLs are new or changed, so a
 * page is crawled the day it ships instead of whenever a crawler next reads
 * the sitemap. Google does not take part; Search Console is its channel.
 *
 *   node scripts/indexnow-submit.mjs --before=<sitemap.xml saved pre-deploy>
 *   node scripts/indexnow-submit.mjs --all            (every sitemap URL)
 *   node scripts/indexnow-submit.mjs --all --dry-run  (print, send nothing)
 *
 * WHICH URLS: with `--before`, the URLs in the LIVE sitemap that the saved one
 * did not list, plus those whose <lastmod> moved. Tool pages carry no lastmod,
 * so a date cut-off would never submit a new tool; a before/after diff does.
 *
 * THE KEY is not a secret — IndexNow verifies ownership by fetching it from the
 * site. Its one source is the file `public/` serves: exactly one
 * `public/<32 hex>.txt` whose body is its own name. The script reads the key
 * from there and fetches it from the live site BEFORE submitting, because
 * IndexNow answers 403 for a key it cannot fetch and the publish job would
 * otherwise blame the engine for our deploy.
 *
 * Dependency-free on purpose: publish.yml runs it with the runner's own node,
 * outside the images, where no `node_modules` exists. Run it from the
 * repository root.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const KEY_FILE = /^([0-9a-f]{32})\.txt$/;
/** IndexNow's per-request ceiling. */
const MAX_URLS = 10_000;

/**
 * The sitemap as the ORIGIN serves it now. Cloudflare holds `/sitemap.xml`
 * for up to a day (`s-maxage=86400`, plus a week stale-while-revalidate —
 * deliberate, see src/deploy/cdn-cache-rules.test.ts), so a plain GET right
 * after a deploy returns the PREVIOUS build's list: measured 2026-10-31, 110
 * URLs at the edge (`Age: 7617`, HIT) against 114 at the origin. Diffing that
 * against the pre-deploy snapshot would submit nothing, every run, green.
 * A query string is part of the edge's cache key, so a unique one is a miss.
 */
export function freshSitemapUrl(base, tag = String(Date.now())) {
  return `${base}/sitemap.xml?indexnow=${encodeURIComponent(tag)}`;
}

/** The one key `publicDir` serves, or a thrown reason there is not exactly one. */
export function findIndexNowKey(publicDir) {
  const keys = readdirSync(publicDir).flatMap((name) => {
    const match = KEY_FILE.exec(name);
    if (!match) return [];
    const body = readFileSync(path.join(publicDir, name), "utf8").trim();
    return body === match[1] ? [match[1]] : [];
  });
  if (keys.length !== 1)
    throw new Error(
      `expected exactly one IndexNow key file (<32 hex>.txt holding its own name) in ${publicDir}, found ${keys.length}`,
    );
  return keys[0];
}

/** `loc → lastmod` (empty string when the entry has none), in sitemap order. */
export function sitemapEntries(xml) {
  const entries = new Map();
  for (const [, body] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(body)?.[1]?.trim();
    if (!loc) continue;
    entries.set(
      loc,
      /<lastmod>([^<]+)<\/lastmod>/.exec(body)?.[1]?.trim() ?? "",
    );
  }
  return entries;
}

/** URLs `after` lists that `before` did not, or whose lastmod moved. */
export function changedUrls(beforeXml, afterXml) {
  const before = sitemapEntries(beforeXml);
  return [...sitemapEntries(afterXml)]
    .filter(([loc, lastmod]) => !before.has(loc) || before.get(loc) !== lastmod)
    .map(([loc]) => loc);
}

/** The request body IndexNow takes; every URL must be on `base`'s host. */
export function indexNowPayload(base, key, urls) {
  const { host, origin } = new URL(base);
  const foreign = urls.filter((u) => new URL(u).host !== host);
  if (foreign.length)
    throw new Error(`URLs not on ${host}: ${foreign.join(", ")}`);
  return {
    host,
    key,
    keyLocation: `${origin}/${key}.txt`,
    urlList: urls.slice(0, MAX_URLS),
  };
}

async function main(argv) {
  const base = process.env.BASE ?? "https://pdf.xyz";
  const all = argv.includes("--all");
  const dryRun = argv.includes("--dry-run");
  const beforeFile = argv.find((a) => a.startsWith("--before="))?.slice(9);
  if (!all && !beforeFile) {
    console.error("pass --before=<saved sitemap.xml> or --all");
    return 2;
  }

  // Run from the repository root (publish.yml runs it from the checkout).
  const key = findIndexNowKey(path.resolve("public"));

  const sitemapUrl = freshSitemapUrl(base);
  const res = await fetch(sitemapUrl);
  if (!res.ok) throw new Error(`GET ${sitemapUrl} → ${res.status}`);
  const live = await res.text();
  const urls = all
    ? [...sitemapEntries(live).keys()]
    : changedUrls(readFileSync(beforeFile, "utf8"), live);
  if (sitemapEntries(live).size === 0)
    throw new Error("the live sitemap parsed to no URLs");
  if (urls.length === 0) {
    console.log("indexnow: no new or changed URLs in the sitemap");
    return 0;
  }

  const body = indexNowPayload(base, key, urls);
  const served = await fetch(body.keyLocation);
  const servedKey = served.ok ? (await served.text()).trim() : "";
  if (servedKey !== key)
    throw new Error(
      `${body.keyLocation} does not serve the key (status ${served.status}); IndexNow would refuse it`,
    );

  console.log(
    `indexnow: ${body.urlList.length} URL(s)${dryRun ? " (dry run)" : ""}`,
  );
  for (const u of body.urlList) console.log(`  ${u}`);
  if (dryRun) return 0;

  const sent = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  // 200 accepted, 202 accepted pending key validation; anything else is a refusal.
  console.log(`indexnow: ${INDEXNOW_ENDPOINT} → ${sent.status}`);
  return sent.status === 200 || sent.status === 202 ? 0 : 1;
}

// No `import.meta` anywhere in this file: Playwright's loader transpiles
// e2e imports to CommonJS, where it is a SyntaxError, and e2e/smoke.spec.ts
// imports findIndexNowKey so the key rule has one definition.
if (path.basename(process.argv[1] ?? "") === "indexnow-submit.mjs") {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`indexnow: ${error.message}`);
      process.exit(1);
    },
  );
}

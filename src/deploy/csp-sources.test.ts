// @vitest-environment node
/**
 * What the served Content-Security-Policy actually allows — read from the
 * headers the real `next.config.mjs` produces, and matched the way a browser
 * matches a CSP source expression, not by substring.
 *
 * Two defects this pins (2026-09 audit):
 *  - script-src allowed ALL of https://www.googletagmanager.com, which also
 *    serves `gtm.js?id=GTM-<anyone>`: any Tag Manager container, an
 *    attacker's included — a known CSP bypass that survives removing
 *    'unsafe-inline'.
 *  - connect-src added `https://*.r2.cloudflarestorage.com` on its own: every
 *    R2 account, so injected script could PUT stolen data to its own bucket.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GTAG_SRC } from "@/lib/analytics/ga4";

const ROOT = process.cwd();

async function servedCsp(): Promise<Map<string, string[]>> {
  const config = (await import(path.join(ROOT, "next.config.mjs"))).default as {
    headers: () => Promise<
      { source: string; headers: { key: string; value: string }[] }[]
    >;
  };
  const rules = await config.headers();
  const all = rules.find((r) => r.source === "/:path*")!;
  const csp = all.headers.find((h) => h.key === "Content-Security-Policy")!;
  const directives = new Map<string, string[]>();
  for (const part of csp.value.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name, sources);
  }
  return directives;
}

/**
 * CSP3 host-source matching, the subset used here: scheme and host must match
 * (a leading `*.` matches any subdomain), and a path ending in "/" matches
 * every path under it; otherwise the path must match exactly. Query ignored.
 */
function allows(sources: string[], url: string): boolean {
  const target = new URL(url);
  return sources.some((source) => {
    if (source.startsWith("'") || !source.includes("://")) return false;
    const m = /^(https?):\/\/(\*\.)?([^/]+)(\/.*)?$/.exec(source);
    if (!m) return false;
    const [, scheme, wildcard, host, sourcePath] = m;
    if (`${scheme}:` !== target.protocol) return false;
    const hostOk = wildcard
      ? target.hostname.endsWith(`.${host}`)
      : target.hostname === host;
    if (!hostOk) return false;
    if (!sourcePath) return true;
    return sourcePath.endsWith("/")
      ? target.pathname.startsWith(sourcePath)
      : target.pathname === sourcePath;
  });
}

const GTM_CONTAINER = "https://www.googletagmanager.com/gtm.js?id=GTM-ATTACKER";

describe("the served CSP's script-src", () => {
  it("the matcher can see the bypass (positive control)", () => {
    expect(allows(["https://www.googletagmanager.com"], GTM_CONTAINER)).toBe(
      true,
    );
    expect(
      allows(["https://www.googletagmanager.com/gtag/"], GTM_CONTAINER),
    ).toBe(false);
  });

  it("loads the gtag script the consent gate injects, and no Tag Manager container", async () => {
    const scriptSrc = (await servedCsp()).get("script-src")!;
    // Health check: the directive exists and carries the Google source at all.
    expect(scriptSrc.some((s) => s.includes("googletagmanager"))).toBe(true);
    // Relationship: the URL ga4.ts injects is exactly what the policy admits…
    expect(allows(scriptSrc, GTAG_SRC)).toBe(true);
    // …and the container endpoint on the same host is not.
    expect(allows(scriptSrc, GTM_CONTAINER)).toBe(false);
  });
});

describe("the served CSP's connect-src storage origins", () => {
  const saved = process.env.NEXT_PUBLIC_STORAGE_CONNECT_SRC;
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_STORAGE_CONNECT_SRC;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_STORAGE_CONNECT_SRC;
    else process.env.NEXT_PUBLIC_STORAGE_CONNECT_SRC = saved;
  });

  const someoneElsesBucket =
    "https://attacker-account.r2.cloudflarestorage.com/loot/doc.pdf";

  it("adds no storage origin of its own", async () => {
    const connect = (await servedCsp()).get("connect-src")!;
    expect(connect).toContain("'self'");
    expect(allows(connect, someoneElsesBucket)).toBe(false);
  });

  it("admits exactly the account the deployment names (positive control)", async () => {
    process.env.NEXT_PUBLIC_STORAGE_CONNECT_SRC =
      "https://acct123.r2.cloudflarestorage.com https://*.acct123.r2.cloudflarestorage.com";
    const connect = (await servedCsp()).get("connect-src")!;
    expect(
      allows(connect, "https://acct123.r2.cloudflarestorage.com/bucket/f_1"),
    ).toBe(true);
    expect(
      allows(connect, "https://bucket.acct123.r2.cloudflarestorage.com/f_1"),
    ).toBe(true);
    expect(allows(connect, someoneElsesBucket)).toBe(false);
  });
});

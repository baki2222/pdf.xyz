// @vitest-environment node
/**
 * The limiter may key a visitor by address ONLY while /privacy says it does —
 * and /privacy may say it does only while the limiter can.
 *
 * ── WHY (2026-10-10, the legal-pages sweep, row 1) ──────────────────────────
 *
 * Production counts every request in ONE shared bucket: read at the wire on
 * 2026-10-10, `/api/worker/operations` reported
 * `rateLimit.code = "remote-configured-shared"`. The bucket holds no
 * identifier, so /privacy can truthfully say so. But three environment
 * variables (`PDFXYZ_RATE_LIMIT_TRUST_PROXY`, `…_KEY_SALT`,
 * `…_CLIENT_IP_HEADER`) switch the limiter to a salted SHA-256 of each
 * visitor's address, stored with its counter for up to a day — pseudonymous
 * personal data /privacy never mentioned, set by an operator in a console no
 * test can see. A copy guard cannot fail on an env var. So the switch now
 * runs THROUGH the copy: per-client keying needs the three variables AND the
 * privacy disclosure, and the disclosure is what /privacy renders.
 *
 * ── WHAT IT PINS — a relationship, read through the composed chain ──────────
 *
 * env → `resolveRateLimitConfig` → `deriveClientToken`, the path every route
 * takes, against the RENDERED page: the page describes hashed addresses
 * exactly when the full per-client environment yields a per-client token.
 * Changing either side alone is red.
 *
 * ── EXIT CONDITION ──────────────────────────────────────────────────────────
 *
 * None: this is the binding, not a ban. To key per client, flip the
 * disclosure, read the sentence it then renders, and ship both together.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "@/app/privacy/page";
import { PER_CLIENT_KEYING_DISCLOSED } from "@/lib/privacy/keying";
import { RATE_LIMIT_DISCLOSURE } from "@/lib/privacy/rate-limits";
import {
  RATE_LIMIT_ENV,
  discloseKeyingForTests,
  resolveRateLimitConfig,
} from "./config";
import { SHARED_BUCKET_TOKEN, deriveClientToken } from "./identity";

/** Everything per-client keying needs from the environment. */
const PER_CLIENT_ENV = {
  [RATE_LIMIT_ENV.provider]: "redis",
  [RATE_LIMIT_ENV.trustForwardedFor]: "true",
  [RATE_LIMIT_ENV.keySalt]: "keying-disclosure-test-salt",
  [RATE_LIMIT_ENV.clientIpHeader]: "cf-connecting-ip",
};

const CALLER = new Headers({ "cf-connecting-ip": "203.0.113.7" });

/** /privacy §4, as text. */
function collectSection(): string {
  const html = renderToStaticMarkup(<PrivacyPage />);
  const start = html.indexOf('id="what-we-collect"');
  expect(start, "/privacy lost its #what-we-collect section").toBeGreaterThan(
    0,
  );
  const end = html.indexOf("<section", start + 1);
  return html
    .slice(start, end === -1 ? undefined : end)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/\s+/g, " ");
}

/** The page tells a reader their address is hashed and kept with a counter. */
const DISCLOSES_HASHED_ADDRESS =
  /\b(?:hash|hashed)\b[^.]*\b(?:IP\s+)?address\b|\baddress\b[^.]*\b(?:hash|hashed)\b/i;

describe("per-client rate-limit keying is bound to the privacy disclosure", () => {
  it("positive control: the predicate reads a disclosure, and spares the shared sentence", () => {
    expect(
      "we count requests per network address, turned into a salted one-way hash",
    ).toMatch(DISCLOSES_HASHED_ADDRESS);
    expect(
      "Rate limits count requests from everyone together in one shared counter, which holds no identifier.",
    ).not.toMatch(DISCLOSES_HASHED_ADDRESS);
  });

  it("health: without the environment, every request is shared whatever the page says", () => {
    const config = resolveRateLimitConfig({});
    expect(deriveClientToken(CALLER, config)).toBe(SHARED_BUCKET_TOKEN);
  });

  it("the full per-client environment keys by address exactly when /privacy says so", () => {
    const disclosed = DISCLOSES_HASHED_ADDRESS.test(collectSection());
    const token = deriveClientToken(
      CALLER,
      resolveRateLimitConfig(PER_CLIENT_ENV),
    );
    expect(
      token !== SHARED_BUCKET_TOKEN,
      disclosed
        ? "/privacy says addresses are hashed, but the limiter keys everyone together"
        : "the environment alone switched on per-client keying, which /privacy does not disclose",
    ).toBe(disclosed);
  });

  it("positive control: in the disclosed counterfactual the same chain keys by address", () => {
    // Without this, a limiter that could never key per client would pass the
    // test above forever while /privacy says "shared" — vacuously.
    discloseKeyingForTests(true);
    const token = deriveClientToken(
      CALLER,
      resolveRateLimitConfig(PER_CLIENT_ENV),
    );
    expect(token).toMatch(/^c_[0-9a-f]{32}$/);
  });

  it("the page's sentence is the one the flag selects", () => {
    // The disclosure module renders one of two sentences by the flag the
    // limiter reads; the page must render THAT sentence, not its own words.
    expect(collectSection()).toContain(RATE_LIMIT_DISCLOSURE.slice(0, 60));
    expect(DISCLOSES_HASHED_ADDRESS.test(RATE_LIMIT_DISCLOSURE)).toBe(
      PER_CLIENT_KEYING_DISCLOSED,
    );
  });

  it("no source outside the tests can pretend the page discloses it", () => {
    // The seam exists for tests; a production caller would be the env switch
    // all over again. Searched in src and scripts, members printed.
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "node_modules") walk(full);
        } else if (
          /\.(?:ts|tsx|mjs|js)$/.test(e.name) &&
          !/\.(?:test|spec)\./.test(e.name)
        ) {
          const text = readFileSync(full, "utf8");
          if (/\bdiscloseKeyingForTests\s*\(/.test(text))
            callers.push(
              path.relative(process.cwd(), full).replace(/\\/g, "/"),
            );
        }
      }
    };
    walk(path.join(process.cwd(), "src"));
    walk(path.join(process.cwd(), "scripts"));
    // The definition and the per-test reset are the only two.
    expect(callers.sort()).toEqual([
      "src/lib/ratelimit/config.ts",
      "src/tests/setup.ts",
    ]);
  });
});

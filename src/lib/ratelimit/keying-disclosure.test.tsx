// @vitest-environment node
/**
 * The limiter may key a visitor by address ONLY while /privacy says it does —
 * and /privacy may say it does only while the limiter can. And every OTHER
 * place the product says who shares a count says the same thing.
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
 * ── AND THE SAME PROPERTY WAS STATED A SECOND TIME (review, 2026-10-10) ─────
 *
 * The first version of this file bound the limiter to /privacy §4 and to
 * nothing else. Every AI tool page said "30,774 free characters of AI text a
 * day for your connection" (AI Data Extraction: "one pool per connection"),
 * the 429 said "The free AI allowance for this connection is used up", and
 * the AI ceiling message said "not the daily AI allowance for your
 * connection" — all while the change above made per-client keying
 * impossible, so the `ai.characters` bucket was ONE pool for the whole site
 * in every deployment. /privacy §4 and the tool pages contradicted each
 * other, and this guard certified the half it read. House rule 2: name the
 * PROPERTY — who shares one count — not the mechanism (the §4 sentence).
 *
 * ── WHAT IT PINS — a relationship, read through the composed chain ──────────
 *
 * env → `resolveRateLimitConfig` → `deriveClientToken`, the path every route
 * takes, against what a reader RECEIVES:
 *  - /privacy §4 describes hashed addresses exactly when the full per-client
 *    environment yields a per-client token;
 *  - every AI tool page, rendered, scopes its allowance to the connection
 *    exactly then, and to everyone using pdf.xyz otherwise — and so do the
 *    refusals served at runtime;
 *  - no copy file states that scope by hand, so the words a flipped flag
 *    selects are the words every surface renders.
 * Changing either side alone is red. The disclosed counterfactual is a
 * positive control on both the limiter and the copy builder.
 *
 * ── EXIT CONDITION ──────────────────────────────────────────────────────────
 *
 * None: this is the binding, not a ban. To key per client, flip the
 * disclosure, read the sentences it then renders, and ship them together.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import PrivacyPage from "@/app/privacy/page";
import { PER_CLIENT_KEYING_DISCLOSED } from "@/lib/privacy/keying";
import { RATE_LIMIT_DISCLOSURE } from "@/lib/privacy/rate-limits";
import {
  AI_ALLOWANCE_ACTION,
  AI_ALLOWANCE_USED_MESSAGE,
  ALLOWANCE_SCOPE,
  aiAllowanceCopy,
  allowanceScopeFor,
} from "@/lib/jobs/ai-allowance";
import { AI_CEILING_REACHED_MESSAGE } from "@/lib/jobs/ai-spend-ceiling";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { tools } from "@/lib/tools";
import {
  copyFiles,
  flattenForPhraseSearch,
  withoutComments,
} from "@/lib/tools/copy-surface";
import {
  RATE_LIMIT_ENV,
  discloseKeyingForTests,
  resolveRateLimitConfig,
} from "./config";
import { SHARED_BUCKET_TOKEN, deriveClientToken } from "./identity";
import { RATE_LIMITED_MESSAGE, rateLimitErrorResult } from "./response";
import { renderToolPages } from "@/tests/rendered-tool-pages";
import type { RateLimitDecision } from "./types";
import {
  NOT_A_SCOPE,
  SHIPPED_CONNECTION_SCOPE,
  SHIPPED_EVERYONE_SCOPE,
  scopeOf,
} from "@/tests/allowance-scope";

/** Everything per-client keying needs from the environment. */
const PER_CLIENT_ENV = {
  [RATE_LIMIT_ENV.provider]: "redis",
  [RATE_LIMIT_ENV.trustForwardedFor]: "true",
  [RATE_LIMIT_ENV.keySalt]: "keying-disclosure-test-salt",
  [RATE_LIMIT_ENV.clientIpHeader]: "cf-connecting-ip",
};

const CALLER = new Headers({ "cf-connecting-ip": "203.0.113.7" });

/** Does the full per-client environment, through the real chain, key by address? */
const keyedPerClient = () =>
  deriveClientToken(CALLER, resolveRateLimitConfig(PER_CLIENT_ENV)) !==
  SHARED_BUCKET_TOKEN;

/** Markup as the text a reader (or a crawler reading JSON-LD) receives. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

/** /privacy §4, as text. */
function collectSection(): string {
  const html = renderToStaticMarkup(<PrivacyPage />);
  const start = html.indexOf('id="what-we-collect"');
  expect(start, "/privacy lost its #what-we-collect section").toBeGreaterThan(
    0,
  );
  const end = html.indexOf("<section", start + 1);
  return textOf(html.slice(start, end === -1 ? undefined : end));
}

/** The page tells a reader their address is hashed and kept with a counter. */
const DISCLOSES_HASHED_ADDRESS =
  /\b(?:hash|hashed)\b[^.]*\b(?:IP\s+)?address\b|\baddress\b[^.]*\b(?:hash|hashed)\b/i;

/** The AI tools, from the catalogue — never listed. */
const AI_SLUGS = tools
  .filter((t) => capabilityForMode(t.processing) === "ai")
  .map((t) => t.slug);

/**
 * Every tool page as a reader and a crawler receive it — visible text plus the
 * FAQPage answers — rendered in a FRESH process (`render-tool-pages.ts` says
 * why: the page imports worker panels another test file mocks, and
 * `isolate: false` would hand this file that stub). Rendered once.
 */
let pages: ReturnType<typeof renderToolPages>;
beforeAll(() => {
  pages = renderToolPages();
}, 180_000);
function renderedToolPage(slug: string): string {
  const page = pages.get(slug);
  if (!page) throw new Error(`/tools/${slug} was not rendered`);
  return `${page.text} ${page.faq.map((q) => q.answer).join(" ")}`;
}

/** The 429 the job route serves when the allowance is spent. */
const ALLOWANCE_REFUSAL = rateLimitErrorResult({
  allowed: false,
  action: AI_ALLOWANCE_ACTION,
  policyId: "ai-characters",
  provider: "memory",
  enforced: true,
  retryAfterSeconds: 3600,
  retryAfterBucket: "15m+",
} as unknown as RateLimitDecision).body.error.message;

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
    expect(
      keyedPerClient(),
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

describe("who shares the AI allowance is said the way the limiter keys it", () => {
  it("positive control: each scope predicate catches every sentence shipped with that scope, and only those", () => {
    for (const s of SHIPPED_CONNECTION_SCOPE)
      expect(scopeOf(s), s).toBe("connection");
    for (const s of SHIPPED_EVERYONE_SCOPE)
      expect(scopeOf(s), s).toBe("everyone");
    // Spared: the other things a tool page calls a connection.
    for (const s of NOT_A_SCOPE) expect(scopeOf(s), s).toBe("neither");
  });

  it("health: the catalogue has AI tools to read (4 when written)", () => {
    expect(AI_SLUGS.length).toBeGreaterThanOrEqual(4);
  });

  it("every AI tool page, rendered, scopes the allowance the way the limiter keys", () => {
    const want = keyedPerClient() ? "connection" : "everyone";
    const wrong: string[] = [];
    for (const slug of AI_SLUGS) {
      const text = renderedToolPage(slug);
      // Health: the page under test carries its allowance at all.
      expect(text, `/tools/${slug} renders no allowance`).toMatch(
        /free characters of AI text/,
      );
      const got = scopeOf(text);
      if (got !== want) wrong.push(`/tools/${slug} says ${got}`);
    }
    expect(
      wrong,
      `the limiter keys ${want === "connection" ? "per connection" : "everyone together"}; these pages say otherwise`,
    ).toEqual([]);
  });

  it("the refusals a reader is served say the same, or say no scope at all", () => {
    const keyed = keyedPerClient();
    // The allowance refusal names its scope; the two generic ones must not
    // claim the connection while the count is shared.
    expect(scopeOf(ALLOWANCE_REFUSAL)).toBe(
      keyed ? "connection" : "everyone",
    );
    expect(ALLOWANCE_REFUSAL).toBe(AI_ALLOWANCE_USED_MESSAGE);
    for (const generic of [RATE_LIMITED_MESSAGE, AI_CEILING_REACHED_MESSAGE])
      expect(
        [keyed ? "connection" : "everyone", "neither"],
        generic,
      ).toContain(scopeOf(generic));
  });

  it("the copy module selects its words by the flag the limiter reads", () => {
    expect(ALLOWANCE_SCOPE).toBe(allowanceScopeFor(PER_CLIENT_KEYING_DISCLOSED));
  });

  it("positive control: in the disclosed counterfactual, the words a flipped flag selects scope to the connection", () => {
    // The limiter and the copy builder, both in the world where /privacy
    // discloses: the chain keys per client, and the builder's branch for that
    // state says "connection" on every AI page and in the refusal — never
    // "everyone". Without this, a builder whose disclosed branch still said
    // "shared" would pass the rendered check above until the day the flag
    // flipped, and then ship.
    discloseKeyingForTests(true);
    const keyed = keyedPerClient();
    expect(keyed).toBe(true);
    const copy = aiAllowanceCopy(allowanceScopeFor(keyed));
    for (const slug of AI_SLUGS)
      expect(scopeOf(copy.factFor(slug)), slug).toBe("connection");
    expect(scopeOf(copy.usedMessage)).toBe("connection");
    expect(scopeOf(copy.whoShares)).toBe("connection");
    expect(scopeOf(`spends from ${copy.pool}`)).toBe("connection");
  });

  it("control: in the shared world the same builder says everyone, everywhere", () => {
    discloseKeyingForTests(false);
    const keyed = keyedPerClient();
    expect(keyed).toBe(false);
    const copy = aiAllowanceCopy(allowanceScopeFor(keyed));
    for (const slug of AI_SLUGS)
      expect(scopeOf(copy.factFor(slug)), slug).toBe("everyone");
    expect(scopeOf(copy.usedMessage)).toBe("everyone");
    expect(scopeOf(copy.whoShares)).toBe("everyone");
    expect(scopeOf(`spends from ${copy.pool}`)).toBe("everyone");
  });

  /*
   * The words come from ONE builder, or a flipped flag flips some surfaces and
   * not others. The AI tools' FAQ answers wrote the scope by hand ("one pool
   * per connection", "allotted to your connection", "per connection", "on a
   * shared office or campus network") beside a builder that did not know
   * them. Walked over every copy file a visitor reads, comments stripped and
   * wraps flattened; the builder's own module is the one place allowed.
   */
  describe("no copy file states the allowance's scope by hand", () => {
    const BUILDER = "src/lib/jobs/ai-allowance.ts";
    const readable = (file: string) =>
      flattenForPhraseSearch(withoutComments(readFileSync(file, "utf8")));
    const files = copyFiles().map((f) => ({
      file: path.relative(process.cwd(), f).replace(/\\/g, "/"),
      full: f,
    }));

    it("health: the walk reaches the builder and every AI tool's content file", () => {
      const names = files.map((f) => f.file);
      expect(names).toContain(BUILDER);
      for (const slug of AI_SLUGS)
        expect(names).toContain(`src/lib/tools/content/${slug}.ts`);
      expect(files.length).toBeGreaterThan(200);
    });

    it("positive control: the FAQ sentence that shipped is caught in a real content file", () => {
      const file = files.find(
        (f) => f.file === "src/lib/tools/content/ai-extract.ts",
      )!;
      const planted = `${readable(file.full)} export const X = \`${SHIPPED_CONNECTION_SCOPE[1]}\`;`;
      expect(scopeOf(planted)).not.toBe("neither");
    });

    it("finds none outside the builder", () => {
      const offenders = files
        .filter((f) => f.file !== BUILDER)
        .filter((f) => scopeOf(readable(f.full)) !== "neither")
        .map((f) => `${f.file}: ${scopeOf(readable(f.full))}`);
      expect(
        offenders,
        "state who shares the allowance through @/lib/jobs/ai-allowance, which reads the keying flag",
      ).toEqual([]);
    });
  });
});

// @vitest-environment node
/**
 * The alertable status must be REACHABLE.
 *
 * `remote-error-fail-open` is documented in four places as the condition to alert
 * on — `docs/OBSERVABILITY.md` marks it "no (alert!)", `docs/RUNBOOK.md` tells an
 * operator what to do when they see it, and the Kubernetes example README repeats
 * it. It was produced by nothing: `statusForDecision` had zero callers outside its
 * own test, so an operator following the runbook was alerting on a string that
 * could not appear.
 *
 * That is a worse failure than a missing alert. A missing alert is a known gap; a
 * documented alert nobody can trigger is a gap that looks covered.
 *
 * These cases assert the two halves separately, because either alone reads as
 * working: the status layer can PRODUCE the code, and the operator endpoint
 * actually ASKS for it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RATE_LIMIT_ENV } from "./config";
import { RATE_LIMIT_REDIS_ENV } from "./redis-config";
import { resolveRateLimitStatus, statusForDecision } from "./status";
import type { RateLimitDecision } from "./types";

/**
 * A deployment enforcing PER CLIENT — which needs the trust flag, not just a
 * store. Until 2026-08-10 this fixture omitted it and called itself "exactly
 * what a correctly-configured production deployment has set": the same blind
 * spot as production, where a store was configured, the posture said
 * `remote-configured / enforced / distributed`, and every caller shared one
 * bucket.
 */
const CONFIGURED: Record<string, string> = {
  [RATE_LIMIT_ENV.provider]: "redis",
  [RATE_LIMIT_REDIS_ENV.restUrl]: "https://example-store.upstash.io",
  [RATE_LIMIT_REDIS_ENV.restToken]: "A".repeat(48),
  [RATE_LIMIT_ENV.trustForwardedFor]: "true",
  [RATE_LIMIT_ENV.clientIpHeader]: "cf-connecting-ip",
  [RATE_LIMIT_ENV.keySalt]: "test-shared-salt",
};

/** The same store, without trusted identity: enforcing into ONE bucket. */
const CONFIGURED_SHARED: Record<string, string> = {
  [RATE_LIMIT_ENV.provider]: "redis",
  [RATE_LIMIT_REDIS_ENV.restUrl]: "https://example-store.upstash.io",
  [RATE_LIMIT_REDIS_ENV.restToken]: "A".repeat(48),
};

function decision(overrides: Partial<RateLimitDecision>): RateLimitDecision {
  return {
    allowed: true,
    action: "uploads.create",
    policyId: "uploads.create",
    provider: "remote",
    enforced: true,
    retryAfterSeconds: 0,
    retryAfterBucket: "none",
    ...overrides,
  } as RateLimitDecision;
}

describe("the documented alert condition can actually occur", () => {
  it("a configured store that failed open produces remote-error-fail-open", () => {
    const base = resolveRateLimitStatus(CONFIGURED);
    expect(base.code, "a valid store must read as configured").toBe(
      "remote-configured",
    );

    const failing = statusForDecision(
      base,
      decision({ provider: "remote-error", enforced: false }),
    );

    expect(failing.code).toBe("remote-error-fail-open");
    expect(failing.enforced).toBe(false);
  });

  it("does NOT cry wolf while the limiter is enforcing", () => {
    const base = resolveRateLimitStatus(CONFIGURED);
    const healthy = statusForDecision(base, decision({ enforced: true }));
    expect(healthy.code).toBe("remote-configured");
  });

  it("a configured store reads as configured without a registered provider", () => {
    // The old default consulted the registry, which on Vercel belongs to a
    // different bundle than the route asking. It reported a working limiter as
    // "boot instrumentation did not run" — and `statusForDecision` only upgrades
    // from `remote-configured`, so that wrong base ALSO made the alert
    // unreachable. Two bugs, one line.
    expect(resolveRateLimitStatus(CONFIGURED).code).toBe("remote-configured");
  });

  it("an explicit providerRegistered:false is still honoured", () => {
    // The boot hook describes its own process deliberately; that must keep working.
    expect(
      resolveRateLimitStatus(CONFIGURED, { providerRegistered: false }).code,
    ).toBe("remote-missing-config");
  });

  it("the operator endpoint asks for it", () => {
    // The status layer producing the code is worth nothing if nothing calls it —
    // which was the situation for the entire life of this feature. Assert the
    // wiring, not just the capability.
    const route = readFileSync(
      path.join(
        process.cwd(),
        "src",
        "app",
        "api",
        "worker",
        "operations",
        "route.ts",
      ),
      "utf8",
    );
    expect(route).toContain("statusForDecision");
    expect(route).toContain("rateLimit");
  });

  it("the docs that promise this code still name it", () => {
    // If the code is ever renamed, the runbook an operator follows at 3am must not
    // be left pointing at a string that no longer exists.
    const observability = readFileSync(
      path.join(process.cwd(), "docs", "OBSERVABILITY.md"),
      "utf8",
    );
    expect(observability).toContain("remote-error-fail-open");
  });
});

describe("enforcing on one global bucket is its own reportable state", () => {
  it("reads as remote-configured-shared, not remote-configured", () => {
    // The defect this code exists for: a store IS configured and IS enforcing,
    // so the old vocabulary called it `remote-configured` and reported
    // `enforced: true, distributed: true` — the identical payload it emits when
    // the limiter genuinely works. A field that reads the same in a working
    // state and a broken one is not a status.
    const status = resolveRateLimitStatus(CONFIGURED_SHARED);
    expect(status.code).toBe("remote-configured-shared");
    expect(status.enforced, "it really does throttle").toBe(true);
    expect(status.distributed, "and really is shared across instances").toBe(
      true,
    );
    expect(status.detail).toMatch(/one shared bucket/i);
  });

  it("is distinguishable from a deployment that enforces per client", () => {
    expect(resolveRateLimitStatus(CONFIGURED).code).toBe("remote-configured");
    expect(resolveRateLimitStatus(CONFIGURED_SHARED).code).not.toBe(
      resolveRateLimitStatus(CONFIGURED).code,
    );
  });
});

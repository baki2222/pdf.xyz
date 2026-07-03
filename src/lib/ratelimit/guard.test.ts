// @vitest-environment node
// The registered *remote* provider seam (delegation, deny, fail-open, opaque
// token) is exercised in `provider.test.ts`; this file owns the disabled /
// local-memory / remote-unimplemented paths and the honesty/no-leak invariants.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RATE_LIMIT_ENV } from "./config";
import { policyFor } from "./policy";
import { enforceRateLimit, resetRateLimitGuardForTests } from "./guard";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/jobs", { method: "POST", headers });
}

function clear(): void {
  resetRateLimitGuardForTests();
  delete process.env[RATE_LIMIT_ENV.provider];
  delete process.env[RATE_LIMIT_ENV.trustForwardedFor];
}

beforeEach(clear);
afterEach(clear);

describe("enforceRateLimit — providers", () => {
  it("allows everything, unenforced, when disabled (the default)", async () => {
    const decision = await enforceRateLimit("jobs.create", req());
    expect(decision.allowed).toBe(true);
    expect(decision.enforced).toBe(false);
    expect(decision.provider).toBe("disabled");
    expect(decision.retryAfterSeconds).toBe(0);
    expect(decision.retryAfterBucket).toBe("none");
  });

  it("skips honestly (allow, unenforced) for a selected-but-unimplemented remote provider", async () => {
    process.env[RATE_LIMIT_ENV.provider] = "redis";
    const decision = await enforceRateLimit("jobs.create", req());
    expect(decision.allowed).toBe(true);
    expect(decision.enforced).toBe(false);
    expect(decision.provider).toBe("remote-unimplemented");
  });

  it("actually throttles on the local-memory provider, marking decisions enforced", async () => {
    process.env[RATE_LIMIT_ENV.provider] = "local-memory";
    const policy = policyFor("jobs.create");
    for (let i = 0; i < policy.limit; i++) {
      const ok = await enforceRateLimit("jobs.create", req());
      expect(ok.allowed).toBe(true);
      expect(ok.enforced).toBe(true);
    }
    const denied = await enforceRateLimit("jobs.create", req());
    expect(denied.allowed).toBe(false);
    expect(denied.enforced).toBe(true);
    expect(denied.provider).toBe("local-memory");
    expect(denied.policyId).toBe("jobs.create");
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps action budgets independent", async () => {
    process.env[RATE_LIMIT_ENV.provider] = "local-memory";
    const status = policyFor("jobs.status");
    for (let i = 0; i < status.limit; i++) await enforceRateLimit("jobs.status", req());
    expect((await enforceRateLimit("jobs.status", req())).allowed).toBe(false);
    // A different action has its own, untouched budget.
    expect((await enforceRateLimit("uploads.create", req())).allowed).toBe(true);
  });

  it("separates clients only when the forwarding header is trusted", async () => {
    process.env[RATE_LIMIT_ENV.provider] = "local-memory";
    process.env[RATE_LIMIT_ENV.trustForwardedFor] = "on";
    const policy = policyFor("jobs.create");
    const clientA = { "x-forwarded-for": "203.0.113.1" };
    const clientB = { "x-forwarded-for": "203.0.113.2" };
    for (let i = 0; i < policy.limit; i++) await enforceRateLimit("jobs.create", req(clientA));
    expect((await enforceRateLimit("jobs.create", req(clientA))).allowed).toBe(false);
    // A distinct trusted client is unaffected by A's spent budget.
    expect((await enforceRateLimit("jobs.create", req(clientB))).allowed).toBe(true);
  });
});

describe("enforceRateLimit — honesty & safety", () => {
  it("fails OPEN (never closed) if identity derivation throws", async () => {
    process.env[RATE_LIMIT_ENV.provider] = "local-memory";
    process.env[RATE_LIMIT_ENV.trustForwardedFor] = "on";
    // A request whose headers access throws — the guard must not break the route.
    const broken = {
      headers: {
        get() {
          throw new Error("boom");
        },
      },
    } as unknown as Request;
    const decision = await enforceRateLimit("jobs.create", broken);
    expect(decision.allowed).toBe(true);
    expect(decision.enforced).toBe(false);
  });

  it("never puts request identity into the decision, even with hostile headers", async () => {
    process.env[RATE_LIMIT_ENV.provider] = "local-memory";
    process.env[RATE_LIMIT_ENV.trustForwardedFor] = "on";
    const hostile = {
      "x-forwarded-for": "203.0.113.250",
      "user-agent": "EvilBot/6.6",
      cookie: "session=TOPSECRET",
      referer: "http://evil.example/invoice.pdf",
    };
    const policy = policyFor("jobs.create");
    let decision = await enforceRateLimit("jobs.create", req(hostile));
    for (let i = 0; i < policy.limit; i++) {
      decision = await enforceRateLimit("jobs.create", req(hostile));
    }
    expect(decision.allowed).toBe(false);
    const serialized = JSON.stringify(decision);
    for (const leak of [
      "203.0.113.250",
      "EvilBot",
      "TOPSECRET",
      "invoice.pdf",
      "x-forwarded-for",
      "cookie",
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });
});

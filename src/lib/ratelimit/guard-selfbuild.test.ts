// @vitest-environment node
/**
 * The guard must enforce from the ENVIRONMENT, not from a registration it cannot see.
 *
 * WHAT THIS PINS — a defect measured on production, 2026-08-09.
 * `instrumentation.ts` builds the distributed provider at boot and registers it.
 * The registry is a plain module-level `let` in `./provider`, and Vercel bundles the
 * instrumentation entry separately from each route handler, so
 * `@/lib/ratelimit/provider` exists TWICE in the deployment: the hook writes to one
 * copy, the guard reads the other. Registration was a dead write.
 *
 * Nothing looked wrong. The boot line logged `remote-configured` — truthfully, from
 * the instrumentation module's own view — every variable was set correctly, and 65
 * rapid uploads returned 201 while the Redis store recorded ZERO commands. A status
 * derived from the environment PARSING, not from the guard being able to act on it:
 * the same shape as a `ready: true` taken from a dependency being wired rather than
 * from it being able to run.
 *
 * The first two cases fail on the pre-fix guard, which returned
 * `remote-unimplemented` whenever nothing was registered in ITS module instance,
 * however complete the configuration was.
 *
 * A note on the fixture, because it cost real time to learn: the guard fails OPEN on
 * any exception and reports that as `provider: "disabled"` — indistinguishable from
 * genuinely being switched off. A test that lets the provider reach the network gets
 * a DNS failure and reads it as "the guard is disabled", which is a confident wrong
 * answer. Hence the stubbed transport below: the store must be reachable for these
 * assertions to mean what they say.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMIT_ENV } from "./config";
import { RATE_LIMIT_REDIS_ENV } from "./redis-config";
import {
  enforceRateLimit,
  resetFailOpenLogForTests,
  resetRateLimitGuardForTests,
  resetSelfBuiltProviderForTests,
} from "./guard";
import { clearRateLimitProviderForTests } from "./provider";

/** Records every request the limiter makes, and answers like the REST store. */
function stubStore(): { calls: number } {
  const state = { calls: 0 };
  vi.stubGlobal("fetch", async () => {
    state.calls += 1;
    // The EVAL reply must be an ARRAY — `[count, pttlMs]`. Returning a bare number
    // makes the client treat the reply as malformed, degrade per the fail mode, and
    // THROW; the guard then fails open and reports `provider: "disabled"`, which
    // reads exactly like the limiter being switched off. That is how the first
    // version of this fixture produced a confident wrong answer.
    return new Response(JSON.stringify({ result: [1, 3_600_000] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return state;
}

const ENV_KEYS = [
  RATE_LIMIT_ENV.provider,
  RATE_LIMIT_ENV.trustForwardedFor,
  RATE_LIMIT_REDIS_ENV.restUrl,
  RATE_LIMIT_REDIS_ENV.restToken,
  RATE_LIMIT_REDIS_ENV.keyPrefix,
  RATE_LIMIT_REDIS_ENV.failMode,
];

function clear(): void {
  resetRateLimitGuardForTests();
  resetSelfBuiltProviderForTests();
  resetFailOpenLogForTests();
  clearRateLimitProviderForTests();
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) delete process.env[key];
}

beforeEach(clear);
afterEach(clear);

/** Exactly what a correctly-configured production deployment has set. */
function configuredEnv(): void {
  process.env[RATE_LIMIT_ENV.provider] = "redis";
  process.env[RATE_LIMIT_REDIS_ENV.restUrl] = "https://example-store.upstash.io";
  process.env[RATE_LIMIT_REDIS_ENV.restToken] = "A".repeat(48);
}

function req(): Request {
  return new Request("http://localhost/api/uploads", { method: "POST" });
}

describe("the guard enforces from the environment, not from a registration", () => {
  it("throttles with a complete store config and NOTHING registered", async () => {
    // The production situation exactly: env correct, registry empty in this module.
    const store = stubStore();
    configuredEnv();

    const decision = await enforceRateLimit("uploads.create", req());

    expect(
      decision.provider,
      "a fully-configured store must not report remote-unimplemented just because the boot hook's write landed in another bundle",
    ).toBe("remote");
    expect(decision.enforced).toBe(true);
    // The tell from production was a store with ZERO recorded commands while every
    // request succeeded. Asserting the decision alone would have missed it.
    expect(store.calls, "the guard must actually reach the store").toBeGreaterThan(0);
  });

  it("builds its provider once, not per request", async () => {
    // Rebuilding per call would mint a client per request; memoising is the point.
    const store = stubStore();
    configuredEnv();

    await enforceRateLimit("uploads.create", req());
    const callsAfterFirst = store.calls;
    await enforceRateLimit("uploads.create", req());

    expect(callsAfterFirst).toBe(1);
    expect(store.calls).toBe(2); // one store round trip per request, not per build
  });

  it("still reports honestly when the store is NOT configured", async () => {
    // Only the provider name is set: there is genuinely nothing to build, and the
    // guard must say so rather than pretend.
    stubStore();
    process.env[RATE_LIMIT_ENV.provider] = "redis";

    const decision = await enforceRateLimit("uploads.create", req());

    expect(decision.provider).toBe("remote-unimplemented");
    expect(decision.enforced).toBe(false);
    expect(decision.allowed).toBe(true);
  });

  it("leaves the disabled default completely untouched", async () => {
    // A store may be configured while the provider stays off; off wins, and the
    // guard must not reach for a provider at all.
    const store = stubStore();
    process.env[RATE_LIMIT_REDIS_ENV.restUrl] = "https://example-store.upstash.io";
    process.env[RATE_LIMIT_REDIS_ENV.restToken] = "A".repeat(48);

    const decision = await enforceRateLimit("uploads.create", req());

    expect(decision.provider).toBe("disabled");
    expect(decision.enforced).toBe(false);
    expect(store.calls).toBe(0);
  });

  it("prefers a registered provider over building its own", async () => {
    // Single-process deployments and the existing tests register explicitly; that
    // path must keep working and must not be duplicated by a second client.
    const store = stubStore();
    configuredEnv();
    const { registerRateLimitProvider } = await import("./provider");
    let registeredCalls = 0;
    registerRateLimitProvider({
      check: async () => {
        registeredCalls += 1;
        return { allowed: true, retryAfterSeconds: 0 };
      },
    });

    const decision = await enforceRateLimit("uploads.create", req());

    expect(decision.provider).toBe("remote");
    expect(registeredCalls).toBe(1);
    expect(store.calls, "the registered provider must be used as-is").toBe(0);
  });
});

describe("a limiter that stops enforcing says which failure it is", () => {
  /**
   * `enforced: false` is one bit collapsing four operationally distinct states:
   * deliberately off, selected-but-unwired, a guard bug, and a store outage. The
   * first two need nobody; the last two are incidents. Before `remote-error`, a
   * live store outage reported `provider: "disabled"` — the value the default
   * off-state emits — so the endpoint, the log, and a human debugging all saw the
   * same answer for "switched off" and "silently broken".
   */
  it("reports a store outage as remote-error, not as disabled", async () => {
    configuredEnv();
    // A store that is reachable and answers with an error, which is what an
    // outage looks like from here.
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 503 }));

    const decision = await enforceRateLimit("uploads.create", req());

    expect(
      decision.provider,
      "an erroring store must be distinguishable from the limiter being switched off",
    ).toBe("remote-error");
    expect(decision.allowed, "fail OPEN — an outage must not take the API down").toBe(
      true,
    );
    expect(decision.enforced).toBe(false);
  });

  it("says out loud that it is failing open, on BOTH unenforced paths", async () => {
    // The log line is the channel that still works when the store — the only other
    // place a "the store is down" note could live — is the thing that is down.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Path 1: configured, but no provider could be produced. This is exactly the
    // state the 2026-08-09 incident sat in, and nothing threw during it — a line
    // emitted only from a catch would have stayed silent the whole time.
    resetFailOpenLogForTests();
    process.env[RATE_LIMIT_ENV.provider] = "redis";
    await enforceRateLimit("uploads.create", req());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/failing open/i);

    // Path 2: a provider exists and the store errors.
    warn.mockClear();
    resetFailOpenLogForTests();
    configuredEnv();
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 503 }));
    await enforceRateLimit("uploads.create", req());
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });

  it("throttles the fail-open line instead of one per request", async () => {
    // An outage must not turn every request into a log entry and bill for it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetFailOpenLogForTests();
    process.env[RATE_LIMIT_ENV.provider] = "redis";

    for (let i = 0; i < 5; i += 1) await enforceRateLimit("uploads.create", req());

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("stays silent when the limiter is deliberately off", async () => {
    // The quiet default must remain quiet: nobody set anything, nothing is wrong.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetFailOpenLogForTests();

    await enforceRateLimit("uploads.create", req());

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

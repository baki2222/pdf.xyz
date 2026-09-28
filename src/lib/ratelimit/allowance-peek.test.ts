// @vitest-environment node
/**
 * `peekAiCharacterAllowance` — the question the upload route asks before a
 * byte moves — must give the reservation's answer, about the reservation's
 * bucket, and cost nothing.
 *
 * The route-level agreement is pinned in
 * `app/api/uploads/ai-admission.chain.test.ts` over the in-process limiter.
 * Production runs the REMOTE path, which that chain does not reach, so this
 * file pins the same three properties there, plus fail-open:
 *
 *  1. agreement — on both sides of the boundary, peek(n) says what
 *     reserve(n) would decide;
 *  2. the same bucket — peek reads the token reserve charges, not another;
 *  3. free — peek never calls `spend`, and never creates a window.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AI_CHARACTER_ALLOWANCE } from "@/lib/jobs/ai-allowance";
import { RATE_LIMIT_ENV } from "./config";
import { policyFor } from "./policy";
import { createMemoryRateLimiter } from "./memory";
import {
  peekAiCharacterAllowance,
  reserveAiCharacterAllowance,
  resetRateLimitGuardForTests,
  resetSelfBuiltProviderForTests,
} from "./guard";
import {
  clearRateLimitProviderForTests,
  registerRateLimitProvider,
  type RateLimitProvider,
} from "./provider";

const T0 = 1_700_000_000_000;
const LOCAL = { [RATE_LIMIT_ENV.provider]: "local-memory" };
const REMOTE = { [RATE_LIMIT_ENV.provider]: "redis" };
const POLICY = policyFor("ai.characters");
const req = () =>
  new Request("http://localhost/api/uploads", { method: "POST" });

beforeEach(() => {
  resetRateLimitGuardForTests();
  resetSelfBuiltProviderForTests();
  clearRateLimitProviderForTests();
});
afterEach(() => {
  resetRateLimitGuardForTests();
  resetSelfBuiltProviderForTests();
  clearRateLimitProviderForTests();
});

/** A remote backend over the in-memory core that records every key it is asked about. */
function recordingRemote() {
  const core = createMemoryRateLimiter();
  const peeked: string[] = [];
  const spent: string[] = [];
  const provider: RateLimitProvider = {
    check: async (p, k, now) => core.check(p, k, now),
    peek: async (p, k, now) => {
      peeked.push(k);
      return core.peek(p, k, now);
    },
    spend: async (p, k, now, cost) => {
      spent.push(k);
      core.spend(p, k, now, cost);
    },
    refund: async (p, k, now, cost) => core.refund(p, k, now, cost),
  };
  registerRateLimitProvider(provider);
  return { core, peeked, spent };
}

describe.each([
  ["local-memory", LOCAL],
  ["remote", REMOTE],
] as const)("peekAiCharacterAllowance over %s", (backend, env) => {
  it("says what the reservation would decide, on both sides of the boundary", async () => {
    if (backend === "remote") recordingRemote();
    const first = await reserveAiCharacterAllowance(
      AI_CHARACTER_ALLOWANCE - 100,
      req(),
      env,
      T0,
    );
    expect(first.decision.allowed, "health: the setup spend").toBe(true);
    const seen = new Set<boolean>();
    for (const n of [1, 99, 100, 101, 5_000]) {
      const peek = await peekAiCharacterAllowance(n, req(), env, T0);
      expect(peek.enforced, `${n}`).toBe(true);
      expect(peek.provider).toBe(backend);
      const reserved = await reserveAiCharacterAllowance(n, req(), env, T0);
      expect(peek.allowed, `peek(${n}) vs reserve(${n})`).toBe(
        reserved.decision.allowed,
      );
      if (!peek.allowed) {
        // The refusal carries the window's real remaining life, as the
        // reservation's does — never the `Retry-After: 0` of an allowing peek.
        expect(peek.retryAfterSeconds).toBe(
          reserved.decision.retryAfterSeconds,
        );
        expect(peek.retryAfterSeconds).toBeGreaterThan(0);
      }
      await reserved.release(T0);
      seen.add(peek.allowed);
    }
    expect([...seen].sort(), "both verdicts occurred").toEqual([false, true]);
  });

  it("costs nothing: the whole day is reservable after any number of peeks", async () => {
    if (backend === "remote") recordingRemote();
    for (let i = 0; i < 10; i += 1)
      await peekAiCharacterAllowance(AI_CHARACTER_ALLOWANCE, req(), env, T0);
    const whole = await reserveAiCharacterAllowance(
      AI_CHARACTER_ALLOWANCE,
      req(),
      env,
      T0,
    );
    expect(whole.decision.allowed).toBe(true);
  });
});

describe("peekAiCharacterAllowance — the remote bucket", () => {
  it("reads the very token the reservation charges, and never spends", async () => {
    const { core, peeked, spent } = recordingRemote();
    await peekAiCharacterAllowance(1_000, req(), REMOTE, T0);
    expect(peeked).toHaveLength(1);
    expect(spent, "a peek called spend").toEqual([]);
    expect(core.size(), "a peek created a window").toBe(0);

    await reserveAiCharacterAllowance(1_000, req(), REMOTE, T0);
    expect(spent).toHaveLength(1);
    expect(peeked[0], "peek and reserve asked about different buckets").toBe(
      spent[0],
    );
  });

  it("fails OPEN on a store error, and says it was the store", async () => {
    registerRateLimitProvider({
      check: async () => {
        throw new Error("down");
      },
      peek: async () => {
        throw new Error("down");
      },
      spend: async () => {
        throw new Error("down");
      },
    });
    const peek = await peekAiCharacterAllowance(1_000, req(), REMOTE, T0);
    expect(peek.allowed).toBe(true);
    expect(peek.enforced).toBe(false);
    expect(peek.provider).toBe("remote-error");
  });

  it("is unenforced when the limiter is off, and refuses a claim that is not a count", async () => {
    const off = await peekAiCharacterAllowance(1_000, req(), {}, T0);
    expect(off.allowed).toBe(true);
    expect(off.enforced).toBe(false);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        (await peekAiCharacterAllowance(bad, req(), LOCAL, T0)).allowed,
        `${bad}`,
      ).toBe(false);
    }
    expect(POLICY.limit).toBe(AI_CHARACTER_ALLOWANCE);
  });
});

// @vitest-environment node
/**
 * The global AI spend ceiling, end to end through the real limiter.
 *
 * **The claim the whole piece rests on is that a FAILED call moves the counter.**
 * `incomplete_output` is non-retryable precisely because the model hit its
 * output ceiling — so it burned the maximum budget and is the most expensive
 * outcome in the system. Usage was discarded at THREE layers on the way here
 * (the adapter's failure shape, each engine's failure arm, `ProcessorResult`'s),
 * and a ceiling fed only by successes would have been blind to exactly its
 * largest expenses while appearing to work.
 *
 * These drive the real `peekAiSpendCeiling` / `recordAiSpend` against the real
 * in-memory limiter, with the env that selects it — not a stubbed counter.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  peekAiSpendCeiling,
  readSpendProbe,
  recordAiSpend,
  writeSpendProbe,
} from "./guard";
import { resetRateLimitGuardForTests } from "./guard";
import { AI_SPEND_DAILY_TOKEN_CEILING } from "@/lib/jobs/ai-spend-ceiling";

/** The env that selects the real per-process limiter rather than `disabled`. */
const LOCAL = {
  PDFXYZ_RATE_LIMIT_PROVIDER: "local-memory",
} as Record<string, string>;
const T0 = 1_700_000_000_000;

beforeEach(() => {
  resetRateLimitGuardForTests();
});

describe("the ceiling counts what was spent", () => {
  it("is affordable before anything is spent, and the peek spends nothing", async () => {
    // A hundred peeks must not exhaust the day. Asking whether AI is affordable
    // cannot be what makes it unaffordable.
    for (let i = 0; i < 100; i++) {
      const v = await peekAiSpendCeiling(LOCAL, T0);
      expect(v.affordable).toBe(true);
      expect(v.enforced).toBe(true);
    }
    expect((await peekAiSpendCeiling(LOCAL, T0)).used).toBe(0);
  });

  it("a recorded spend moves the counter", async () => {
    expect(await recordAiSpend(48_020, LOCAL, T0)).toBe(true);
    expect((await peekAiSpendCeiling(LOCAL, T0)).used).toBe(48_020);
  });

  it("trips once the day's tokens are gone, and says it is enforced", async () => {
    await recordAiSpend(AI_SPEND_DAILY_TOKEN_CEILING, LOCAL, T0);
    const verdict = await peekAiSpendCeiling(LOCAL, T0);
    expect(
      verdict.affordable,
      "the ceiling did not trip after its whole daily budget was recorded",
    ).toBe(false);
    // `enforced` is the honesty bit: a tripped-but-unenforced verdict would be
    // claiming a bound nothing applied.
    expect(verdict.enforced).toBe(true);
  });

  it("records an OVER-budget spend rather than dropping it", async () => {
    // The add phase runs after the money is gone. Refusing to record an amount
    // that overshoots would hide exactly the call that broke the ceiling.
    await recordAiSpend(AI_SPEND_DAILY_TOKEN_CEILING, LOCAL, T0);
    await recordAiSpend(5_000, LOCAL, T0);
    expect((await peekAiSpendCeiling(LOCAL, T0)).used).toBe(
      AI_SPEND_DAILY_TOKEN_CEILING + 5_000,
    );
  });

  it("records nothing for a cost that is not a positive number", async () => {
    // A provider that reported no usage must not take the ceiling down with it.
    for (const cost of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await recordAiSpend(cost, LOCAL, T0)).toBe(false);
    }
    expect((await peekAiSpendCeiling(LOCAL, T0)).used).toBe(0);
  });

  it("resets on its own daily clock", async () => {
    await recordAiSpend(AI_SPEND_DAILY_TOKEN_CEILING, LOCAL, T0);
    expect((await peekAiSpendCeiling(LOCAL, T0)).affordable).toBe(false);
    const tomorrow = T0 + 86_400_000 + 1;
    expect((await peekAiSpendCeiling(LOCAL, tomorrow)).affordable).toBe(true);
  });

  it("fails OPEN and says so when no limiter is configured", async () => {
    // A limiter outage must never take AI down. `enforced: false` is the honest
    // half — a caller reporting "ceiling healthy" on this would be claiming a
    // bound nothing applied.
    const verdict = await peekAiSpendCeiling({}, T0);
    expect(verdict.affordable).toBe(true);
    expect(verdict.enforced).toBe(false);
    expect(await recordAiSpend(1_000, {}, T0)).toBe(false);
  });
});

/**
 * The two-tier probe — the check that would have caught blocker 2.
 *
 * The ceiling is WRITTEN by the worker and READ by the web tier. They are
 * different processes with different environments, and the worker had never
 * carried the limiter's configuration: `recordAiSpend` resolved `disabled`,
 * returned false on every call, and the counter could never rise. Every test in
 * the repo was green because none of them runs in two tiers.
 *
 * These simulate the two tiers as two environments against the same limiter,
 * which is the only way to express the defect in-process.
 */
describe("the worker and the web tier share one bucket, proven not assumed", () => {
  it("a probe written by the worker is read back by the web tier", async () => {
    expect(await writeSpendProbe(LOCAL, T0)).toBe(true);
    const verdict = await readSpendProbe(LOCAL, T0);
    expect(verdict.shared).toBe(true);
  });

  it("says NOTHING VISIBLE rather than 'misconfigured' when the worker has not written", async () => {
    // The honest distinction. A worker that has simply not started yet looks
    // identical to a misconfigured one from here, and claiming the second would
    // be the confident-wrong answer — a red posture on a healthy deployment.
    const verdict = await readSpendProbe(LOCAL, T0);
    expect(verdict.shared).toBe(false);
    if (verdict.shared) return;
    expect(verdict.reason).toBe("no-probe-visible");
  });

  it("reports UNENFORCED when this tier has no limiter — blocker 2 exactly", async () => {
    // The worker's real state before the fix: Redis credentials present, the
    // limiter variable absent, so every write silently did nothing.
    expect(await writeSpendProbe({}, T0)).toBe(false);
    const verdict = await readSpendProbe({}, T0);
    expect(verdict.shared).toBe(false);
    if (verdict.shared) return;
    expect(verdict.reason).toBe("unenforced");
  });

  it("does not move the ceiling it is checking on", async () => {
    // A probe that spent from the real counter would make the measurement it
    // exists to verify slightly wrong every time it ran.
    await writeSpendProbe(LOCAL, T0);
    expect((await peekAiSpendCeiling(LOCAL, T0)).used).toBe(0);
  });
});

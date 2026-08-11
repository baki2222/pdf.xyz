// @vitest-environment node
/**
 * The AI spend ceiling's POSTURE — the surface that closes blocker 2.
 *
 * The ceiling is written by the worker (only it knows what a call cost) and read
 * by the web tier (only it can refuse a job). They are different processes with
 * different environments, and for the whole of the feature's life the worker had
 * never carried the limiter's configuration: `recordAiSpend` resolved `disabled`,
 * returned `false` on every call, and the counter could never rise. The
 * configuration was fixed on 2026-08-11 and the counter now accumulates in
 * production — but **nothing could still say so from the reading side**, because
 * `writeSpendProbe`/`readSpendProbe` were built, deployed, and invoked by nothing
 * except their own unit tests. A capability that exists everywhere except where
 * it would be exercised.
 *
 * So these tests drive the COMPOSED CHAIN, not the units: a worker-side write,
 * through the real limiter, into the real posture derivation, into the real
 * operations snapshot, into the real alert fold. Every one of those seams passed
 * its own tests while the path through them carried nothing.
 *
 * WHAT EACH ARM CAN AND CANNOT CATCH is stated at the arm, because the whole
 * point of a posture is that it cannot lie about its own state.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  recordAiSpend,
  resetRateLimitGuardForTests,
  writeSpendProbe,
} from "@/lib/ratelimit/guard";
import { readAiSpendStatus } from "@/lib/ratelimit/spend-status";
import { AI_SPEND_DAILY_TOKEN_CEILING } from "@/lib/jobs/ai-spend-ceiling";
import {
  SNAPSHOT_AI_SPEND_CODES,
  aiSpendHealth,
  aiSpendPostureForCode,
  collectWebOperationsSnapshot,
  type SnapshotAiSpendCode,
} from "./snapshot";
import { evaluateOperationsAlerts } from "./alerts";

/**
 * A deployment whose every OTHER subsystem is healthy, so the spend posture is
 * the only variable. Borrowed wholesale from `headline-consistency.test.ts`,
 * including its `precondition()` discipline — a fixture whose premise only a
 * comment asserts is the defect that file exists to record.
 */
const DRAINABLE_ENV = {
  PDFXYZ_STORAGE_PROVIDER: "s3",
  PDFXYZ_S3_ENDPOINT: "https://s3.example.com",
  PDFXYZ_S3_REGION: "auto",
  PDFXYZ_S3_BUCKET: "pdfxyz-store",
  PDFXYZ_S3_ACCESS_KEY_ID: "AKIAEXAMPLE123",
  PDFXYZ_S3_SECRET_ACCESS_KEY: "s3-secret-value-1234567890",
  PDFXYZ_QUEUE_PROVIDER: "redis",
  PDFXYZ_REDIS_REST_URL: "https://redis.example.com",
  PDFXYZ_REDIS_REST_TOKEN: "redis-rest-token-1234",
  PDFXYZ_LIFECYCLE_PROVIDER: "aws-s3",
  PDFXYZ_LIFECYCLE_VALIDATED: "true",
  PDFXYZ_RATE_LIMIT_PROVIDER: "local-memory",
} as const;

/** The env that selects a real limiter. The two tiers get their own copies. */
const WORKER_WITH_LIMITER = { PDFXYZ_RATE_LIMIT_PROVIDER: "local-memory" };
const WEB_WITH_LIMITER = { PDFXYZ_RATE_LIMIT_PROVIDER: "local-memory" };
/** Production's exact state before 2026-08-11: no limiter variable at all. */
const NO_LIMITER = {};

const T0 = 1_700_000_000_000;

beforeEach(() => {
  resetRateLimitGuardForTests();
});

const snapshotFor = (code: SnapshotAiSpendCode) =>
  collectWebOperationsSnapshot(DRAINABLE_ENV, {
    aiSpend: aiSpendPostureForCode(code),
  });

/**
 * Assert what a comment would otherwise merely claim: every subsystem except
 * `ai-spend` is healthy, so an arm below is measuring the spend posture and not
 * somebody else's warn.
 */
function precondition(snap: ReturnType<typeof snapshotFor>): void {
  const degraded = snap.subsystems
    .filter((s) => s.id !== "ai-spend")
    .filter((s) => s.health !== "ok" && s.health !== "unknown");
  expect(
    degraded.map((s) => `${s.id}=${s.health}`),
    "the fixture is no longer 'all else healthy', so these arms would be " +
      "measuring some other subsystem instead of the AI spend ceiling",
  ).toEqual([]);
}

/* ------------------------------------------------------------------ *
 *  1. The composed chain: a worker write becomes a web-tier reading.
 * ------------------------------------------------------------------ */

describe("the two tiers are proven to share one bucket, through the whole chain", () => {
  it("a worker-side probe write reads back on the web tier as `shared`", async () => {
    // THE ARM THAT COULD NOT PASS BEFORE THIS COMMIT — not because the
    // derivation was wrong, but because no caller existed to connect the two
    // sides. It fails on an implementation where the probe is a module nobody
    // invokes, which is exactly the state production was in.
    expect(await writeSpendProbe(WORKER_WITH_LIMITER, T0)).toBe(true);
    const status = await readAiSpendStatus(WEB_WITH_LIMITER, T0);
    expect(status.code).toBe("shared");
    expect(status.probe).toBe("shared");
  });

  it("carries `shared` into the snapshot as an ok row that does not degrade the headline", async () => {
    await writeSpendProbe(WORKER_WITH_LIMITER, T0);
    const status = await readAiSpendStatus(WEB_WITH_LIMITER, T0);
    const snap = collectWebOperationsSnapshot(DRAINABLE_ENV, {
      aiSpend: aiSpendPostureForCode(status.code),
    });
    precondition(snap);
    const row = snap.subsystems.find((s) => s.id === "ai-spend");
    expect(row?.health).toBe("ok");
    expect(snap.health).toBe("ok");
  });
});

/* ------------------------------------------------------------------ *
 *  2. Absent must not read as agreement — in BOTH directions.
 * ------------------------------------------------------------------ */

describe("a missing limiter on either tier is red, never agreement", () => {
  it("is NOT ok when only the WRITER lacks a limiter — production's exact state", async () => {
    // The asymmetric case, and the one that actually shipped. The reading tier
    // is configured and looks perfectly healthy; every worker-side write
    // silently does nothing. A posture that showed green here would be
    // certifying the broken deployment as working.
    expect(await writeSpendProbe(NO_LIMITER, T0)).toBe(false);
    const status = await readAiSpendStatus(WEB_WITH_LIMITER, T0);
    expect(
      status.code,
      "the web tier reported a proven shared bucket while the worker had no " +
        "limiter at all — this is blocker 2, and it must never read as agreement",
    ).not.toBe("shared");
    expect(status.code).toBe("tiers-unproven");
    expect(aiSpendHealth(status.code)).not.toBe("ok");
  });

  it("is NOT ok when only the READER lacks a limiter", async () => {
    // The mirror: a worker counting into a real store while the tier that must
    // refuse jobs cannot see the counter is equally decorative.
    expect(await writeSpendProbe(WORKER_WITH_LIMITER, T0)).toBe(true);
    const status = await readAiSpendStatus(NO_LIMITER, T0);
    expect(status.code).toBe("unenforced");
    expect(status.probe).toBe("unenforced");
    expect(aiSpendHealth(status.code)).not.toBe("ok");
  });

  it("escalates the HEADLINE, not just a row, when the tiers are unproven", async () => {
    const snap = snapshotFor("tiers-unproven");
    precondition(snap);
    expect(snap.subsystems.find((s) => s.id === "ai-spend")?.health).toBe(
      "warn",
    );
    expect(
      snap.health,
      "a warn row under an ok headline is a footnote, not an alert — the same " +
        "defect the rate-limit fold was built to close",
    ).toBe("warn");
  });

  it("raises a bounded alert reason a watcher can key on", () => {
    const report = evaluateOperationsAlerts(snapshotFor("tiers-unproven"));
    const reasons = report.alerts.map((a) => a.reason);
    expect(reasons).toContain("ai-spend-tiers-unproven");
  });
});

/* ------------------------------------------------------------------ *
 *  3. Tripped is its own code — "it worked" is not "it broke".
 * ------------------------------------------------------------------ */

describe("a reached ceiling is its own state", () => {
  it("reports `ceiling-reached` rather than a generic warn", async () => {
    await recordAiSpend(AI_SPEND_DAILY_TOKEN_CEILING, WORKER_WITH_LIMITER, T0);
    await writeSpendProbe(WORKER_WITH_LIMITER, T0);
    const status = await readAiSpendStatus(WEB_WITH_LIMITER, T0);
    expect(status.code).toBe("ceiling-reached");
  });

  it("keeps the probe observation beside it rather than collapsing the two", async () => {
    // The ceiling tripping and the tiers sharing a bucket are INDEPENDENT
    // observations. Folding them into one field would mean a tripped ceiling
    // could hide an unproven pair, or vice versa — and the reason this posture
    // exists at all is that two true statements about different axes had never
    // been put side by side.
    await recordAiSpend(AI_SPEND_DAILY_TOKEN_CEILING, WORKER_WITH_LIMITER, T0);
    await writeSpendProbe(WORKER_WITH_LIMITER, T0);
    const shared = await readAiSpendStatus(WEB_WITH_LIMITER, T0);
    expect(shared.code).toBe("ceiling-reached");
    expect(shared.probe).toBe("shared");

    resetRateLimitGuardForTests();
    await recordAiSpend(AI_SPEND_DAILY_TOKEN_CEILING, WORKER_WITH_LIMITER, T0);
    const unproven = await readAiSpendStatus(WEB_WITH_LIMITER, T0);
    expect(unproven.code).toBe("ceiling-reached");
    expect(
      unproven.probe,
      "a tripped ceiling erased the fact that the two tiers were never proven " +
        "to share a bucket",
    ).toBe("no-probe-visible");
  });

  it("gives the reached ceiling a distinct alert reason from the broken states", () => {
    const reached = evaluateOperationsAlerts(snapshotFor("ceiling-reached"))
      .alerts.map((a) => a.reason)
      .filter((r) => r.startsWith("ai-spend"));
    const unproven = evaluateOperationsAlerts(snapshotFor("tiers-unproven"))
      .alerts.map((a) => a.reason)
      .filter((r) => r.startsWith("ai-spend"));
    expect(reached).toContain("ai-spend-ceiling-reached");
    expect(
      reached,
      "the hourly watcher cannot tell 'the ceiling did its job' from " +
        "'something is broken' if both produce the same reason",
    ).not.toEqual(unproven);
  });
});

/* ------------------------------------------------------------------ *
 *  4. The endpoint is unauthenticated: no figure, no headroom, ever.
 * ------------------------------------------------------------------ */

describe("the posture publishes neither the figure nor the headroom", () => {
  it("carries no token count anywhere in the serialized payload", async () => {
    // `/api/worker/operations` is UNAUTHENTICATED. The spent total tells an
    // abuser exactly how much room is left before AI degrades, and the ceiling
    // itself is a number nobody outside can act on. Both are therefore absent
    // from the type, not merely omitted by the current caller — this asserts
    // the payload, which is the only thing an attacker can read.
    const spent = 48_020;
    await recordAiSpend(spent, WORKER_WITH_LIMITER, T0);
    await writeSpendProbe(WORKER_WITH_LIMITER, T0);
    const status = await readAiSpendStatus(WEB_WITH_LIMITER, T0);
    const snap = collectWebOperationsSnapshot(DRAINABLE_ENV, {
      aiSpend: aiSpendPostureForCode(status.code),
    });
    const wire = JSON.stringify({
      ...snap,
      alerts: evaluateOperationsAlerts(snap),
    });
    const headroom = AI_SPEND_DAILY_TOKEN_CEILING - spent;
    for (const forbidden of [
      String(spent),
      String(AI_SPEND_DAILY_TOKEN_CEILING),
      String(headroom),
    ]) {
      expect(
        wire.includes(forbidden),
        `the unauthenticated operations payload contains ${forbidden}, which ` +
          "publishes the spend figure or the remaining headroom",
      ).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 *  5. Health checks on the guard itself.
 * ------------------------------------------------------------------ */

describe("the posture vocabulary is exhaustive and exercised", () => {
  it("classifies every declared code, with no unreachable arm", () => {
    // A positive control against a health map that quietly returns one class:
    // the codes must not all land in the same bucket, and every one of them
    // must be classified.
    const classes = SNAPSHOT_AI_SPEND_CODES.map((c) => aiSpendHealth(c));
    expect(classes).toHaveLength(SNAPSHOT_AI_SPEND_CODES.length);
    expect(classes.every((c) => c !== undefined)).toBe(true);
    expect(new Set(classes).size).toBeGreaterThan(1);
  });

  it("gives every code its own detail sentence", () => {
    const details = SNAPSHOT_AI_SPEND_CODES.map(
      (c) => aiSpendPostureForCode(c).detail,
    );
    expect(new Set(details).size).toBe(SNAPSHOT_AI_SPEND_CODES.length);
    for (const d of details) expect(d.length).toBeGreaterThan(40);
  });

  it("never names an environment variable in a published detail", () => {
    // The snapshot's standing promise. The runbook is where variable names live.
    for (const code of SNAPSHOT_AI_SPEND_CODES) {
      expect(aiSpendPostureForCode(code).detail).not.toMatch(/PDFXYZ_/);
    }
  });

  it("reports `enforced: false` on exactly the states where nothing bounds spend", () => {
    expect(aiSpendPostureForCode("unenforced").enforced).toBe(false);
    expect(aiSpendPostureForCode("unknown").enforced).toBe(false);
    expect(aiSpendPostureForCode("shared").enforced).toBe(true);
    expect(aiSpendPostureForCode("ceiling-reached").enforced).toBe(true);
    // Enforcing here and unproven across tiers are different failures: the
    // limiter really is applying a bound in this process, we simply cannot say
    // it is the same bound the worker writes into.
    expect(aiSpendPostureForCode("tiers-unproven").enforced).toBe(true);
  });
});

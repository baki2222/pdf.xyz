// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETENTION,
  type Job,
  type JobArtifact,
  type JobStatus,
} from "@/lib/jobs";
import { createFakeRedis, type FakeRedis } from "./redis-fake";
import {
  parseRedisQueueConfig,
  REDIS_QUEUE_ENV,
  type RedisQueueConfig,
} from "./redis-config";
import { createRedisQueue } from "./redis";
import {
  NO_ATTEMPT,
  runTransition,
  statusCsv,
  TRANSITION_SCRIPTS,
  type TransitionKeys,
} from "./redis-scripts";

const TOKEN = "AX_tokenEXAMPLEvalue000000000000000000000";
const HOUR_MS = 60 * 60_000;
const JOB_ID = "job_test000001";

function config(overrides: Record<string, string | undefined> = {}): RedisQueueConfig {
  const parsed = parseRedisQueueConfig({
    [REDIS_QUEUE_ENV.provider]: "redis",
    [REDIS_QUEUE_ENV.restUrl]: "https://example.upstash.io",
    [REDIS_QUEUE_ENV.restToken]: TOKEN,
    ...overrides,
  });
  if (!parsed.ok) throw new Error("invalid test config");
  return parsed.config;
}

const ARTIFACT: JobArtifact = {
  artifactId: "art_test000001",
  filename: "out.pdf",
  contentType: "application/pdf",
  bytes: 3,
  url: "https://cdn.example/art",
  expiresAt: new Date(HOUR_MS).toISOString(),
};

function jobAt(status: JobStatus, jobId = JOB_ID): Job {
  return {
    jobId,
    tool: "compress-pdf",
    capability: "secure-worker",
    status,
    progress: status === "completed" ? 100 : 0,
    ...(status === "completed" ? { artifacts: [ARTIFACT] } : {}),
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    expiresAt: new Date(HOUR_MS).toISOString(),
    retention: DEFAULT_RETENTION,
  };
}

function make(cfgOverrides: Record<string, string | undefined> = {}) {
  const fake = createFakeRedis();
  const clock = { ms: 1000 };
  const q = createRedisQueue(config(cfgOverrides), {
    client: fake,
    now: () => clock.ms,
  });
  return { fake, q, clock };
}

const KEYS: TransitionKeys = {
  job: "pdfxyz:job:job_1",
  spec: "pdfxyz:spec:job_1",
  lease: "pdfxyz:lease:job_1",
  ready: "pdfxyz:ready",
  active: "pdfxyz:active",
};

/** Seed a minimal job/lease into the fake, as the scripts read only these fields. */
async function seed(
  fake: FakeRedis,
  opts: { status?: JobStatus; attempts?: number } = {},
) {
  if (opts.status) {
    await fake.command(["SET", KEYS.job, JSON.stringify({ status: opts.status })]);
  }
  await fake.command(["SET", KEYS.spec, "{}"]);
  if (opts.attempts !== undefined) {
    await fake.command([
      "SET",
      KEYS.lease,
      JSON.stringify({ attempts: opts.attempts, leaseExpiresAt: 1 }),
    ]);
  }
  await fake.command(["ZADD", KEYS.active, "1", "job_1"]);
}

// ── Direct script guards — the compare-and-set every transition rests on ────────

describe("atomic transition scripts (executed against the faithful fake)", () => {
  it("claimCommit applies only from `queued`, else invalid_state", async () => {
    const ok = createFakeRedis();
    await seed(ok, { status: "queued" });
    expect(
      await runTransition(ok, "claimCommit", KEYS, [
        JSON.stringify({ status: "scanning" }),
        "3600",
        JSON.stringify({ attempts: 1, leaseExpiresAt: 99 }),
        "99",
        "job_1",
      ]),
    ).toBe("applied");
    expect(ok.keys()).toContain(KEYS.lease);

    const bad = createFakeRedis();
    await seed(bad, { status: "canceled" });
    expect(
      await runTransition(bad, "claimCommit", KEYS, [
        JSON.stringify({ status: "scanning" }),
        "3600",
        JSON.stringify({ attempts: 1, leaseExpiresAt: 99 }),
        "99",
        "job_1",
      ]),
    ).toBe("invalid_state");
  });

  it("finalize rejects invalid_state, stale_lease, and missing_job", async () => {
    const allowed = statusCsv(["processing"]);
    const finalizeArgv = (attempt: string) => [
      JSON.stringify({ status: "completed" }),
      "3600",
      attempt,
      allowed,
      "job_1",
    ];

    // Happy path: allowed status + matching attempt → applied, execution state gone.
    const ok = createFakeRedis();
    await seed(ok, { status: "processing", attempts: 2 });
    expect(await runTransition(ok, "finalize", KEYS, finalizeArgv("2"))).toBe(
      "applied",
    );
    expect(ok.keys()).not.toContain(KEYS.spec);
    expect(ok.keys()).not.toContain(KEYS.lease);

    // Wrong status → invalid_state.
    const wrong = createFakeRedis();
    await seed(wrong, { status: "scanning", attempts: 2 });
    expect(await runTransition(wrong, "finalize", KEYS, finalizeArgv("2"))).toBe(
      "invalid_state",
    );

    // Right status, wrong attempt → stale_lease (a stolen lease).
    const stale = createFakeRedis();
    await seed(stale, { status: "processing", attempts: 3 });
    expect(await runTransition(stale, "finalize", KEYS, finalizeArgv("2"))).toBe(
      "stale_lease",
    );

    // No job record → missing_job.
    const gone = createFakeRedis();
    expect(await runTransition(gone, "finalize", KEYS, finalizeArgv("2"))).toBe(
      "missing_job",
    );
  });

  it("finalize with NO_ATTEMPT (cancel/expire) guards on status only, never ownership", async () => {
    const fake = createFakeRedis();
    await seed(fake, { status: "queued", attempts: 7 }); // any attempt
    expect(
      await runTransition(fake, "finalize", KEYS, [
        JSON.stringify({ status: "canceled" }),
        "3600",
        NO_ATTEMPT,
        statusCsv(["queued", "scanning", "processing"]),
        "job_1",
      ]),
    ).toBe("applied");
  });

  it("heartbeat rejects a stolen lease and preserves the attempt count", async () => {
    const fake = createFakeRedis();
    await seed(fake, { status: "scanning", attempts: 2 });
    // A stale fingerprint (attempt 1) is rejected without touching the lease.
    expect(
      await runTransition(fake, "heartbeat", KEYS, ["5000", "1", "3600", "job_1"]),
    ).toBe("stale_lease");
    // The owner (attempt 2) succeeds and only the deadline moves; attempts unchanged.
    expect(
      await runTransition(fake, "heartbeat", KEYS, ["5000", "2", "3600", "job_1"]),
    ).toBe("applied");
    const leaseRes = await fake.command(["GET", KEYS.lease]);
    expect(leaseRes.ok).toBe(true);
    if (leaseRes.ok) {
      expect(JSON.parse(String(leaseRes.value))).toEqual({
        attempts: 2,
        leaseExpiresAt: 5000,
      });
    }
  });

  it("redeliver requeues only an actively-leased job, never a terminal one", async () => {
    const live = createFakeRedis();
    await seed(live, { status: "processing" });
    expect(
      await runTransition(live, "redeliver", KEYS, [
        JSON.stringify({ status: "queued" }),
        "3600",
        "job_1",
      ]),
    ).toBe("applied");

    const done = createFakeRedis();
    await seed(done, { status: "completed" });
    expect(
      await runTransition(done, "redeliver", KEYS, [
        JSON.stringify({ status: "queued" }),
        "3600",
        "job_1",
      ]),
    ).toBe("invalid_state");
  });
});

// ── Race semantics through the provider ────────────────────────────────────────

describe("createRedisQueue — race semantics (Phase 21)", () => {
  it("two workers claiming one queued job: exactly one wins", async () => {
    const { q } = make();
    await q.submit({ job: jobAt("queued"), inputs: ["f_x00000000001"], options: {} });
    const a = await q.claim({ leaseMs: 30_000 });
    const b = await q.claim({ leaseMs: 30_000 });
    const winners = [a, b].filter((r) => r.ok && r.value).length;
    expect(winners).toBe(1);
  });

  it("rejects a heartbeat after the lease was stolen (no resurrection)", async () => {
    const { q, clock } = make();
    await q.submit({ job: jobAt("queued"), inputs: ["f_x00000000001"], options: {} });
    const first = await q.claim({ leaseMs: 30_000 }); // attempt 1, expires 31_000
    expect(first.ok && first.value?.attempt).toBe(1);
    clock.ms = 31_000; // lease expires; a fresh claim reclaims it as attempt 2
    const second = await q.claim({ leaseMs: 30_000 });
    expect(second.ok && second.value?.attempt).toBe(2);

    const beat = await q.heartbeat(JOB_ID, 30_000, 1); // zombie attempt-1 heartbeat
    expect(beat.ok).toBe(false);
    if (!beat.ok) expect(beat.error.reason).toBe("conflict");
    // Not resurrected: still the attempt-2 claim's live state.
    const status = await q.status(JOB_ID);
    expect(status.ok && status.value.status).toBe("scanning");
  });

  it("rejects complete/fail from a worker whose lease was stolen — no corruption", async () => {
    const { q, clock } = make();
    await q.submit({ job: jobAt("queued"), inputs: ["f_x00000000001"], options: {} });
    await q.claim({ leaseMs: 30_000 }); // attempt 1
    clock.ms = 31_000;
    await q.claim({ leaseMs: 30_000 }); // attempt 2 reclaims it
    await q.advance(JOB_ID, { status: "processing" }, 2);

    const done = await q.complete(JOB_ID, [ARTIFACT], 1); // zombie attempt-1 complete
    expect(done.ok).toBe(false);
    if (!done.ok) expect(done.error.reason).toBe("conflict");
    const failed = await q.fail(
      JOB_ID,
      { code: "internal_error", message: "x", retryable: false },
      { requeue: false },
      1,
    );
    expect(failed.ok).toBe(false);

    // The job is untouched: attempt-2 still owns it, no artifacts, not failed.
    const status = await q.status(JOB_ID);
    expect(status.ok && status.value.status).toBe("processing");
    expect(status.ok && status.value.artifacts).toBeUndefined();
  });

  it("cancel racing a running complete is deterministic — cancel first wins", async () => {
    const { q } = make();
    await q.submit({ job: jobAt("queued"), inputs: ["f_x00000000001"], options: {} });
    const claim = await q.claim({ leaseMs: 30_000 });
    const attempt = claim.ok && claim.value ? claim.value.attempt : 0;
    await q.advance(JOB_ID, { status: "processing" }, attempt);

    const canceled = await q.cancel(JOB_ID);
    expect(canceled.ok && canceled.value.status).toBe("canceled");
    // The worker's completion now loses deterministically.
    const done = await q.complete(JOB_ID, [ARTIFACT], attempt);
    expect(done.ok).toBe(false);
    if (!done.ok) expect(done.error.reason).toBe("conflict");
    const status = await q.status(JOB_ID);
    expect(status.ok && status.value.status).toBe("canceled");
    expect(status.ok && status.value.artifacts).toBeUndefined();
  });

  it("cancel racing a running complete is deterministic — complete first wins", async () => {
    const { q } = make();
    await q.submit({ job: jobAt("queued"), inputs: ["f_x00000000001"], options: {} });
    const claim = await q.claim({ leaseMs: 30_000 });
    const attempt = claim.ok && claim.value ? claim.value.attempt : 0;
    await q.advance(JOB_ID, { status: "processing" }, attempt);

    const done = await q.complete(JOB_ID, [ARTIFACT], attempt);
    expect(done.ok && done.value.status).toBe("completed");
    // The user's cancel now loses deterministically (already finished).
    const canceled = await q.cancel(JOB_ID);
    expect(canceled.ok).toBe(false);
    if (!canceled.ok) expect(canceled.error.reason).toBe("conflict");
    const status = await q.status(JOB_ID);
    expect(status.ok && status.value.status).toBe("completed");
  });

  it("does not expire an actively-leased job (only completed outputs expire)", async () => {
    const { q } = make();
    await q.submit({ job: jobAt("queued"), inputs: ["f_x00000000001"], options: {} });
    await q.claim({ leaseMs: 30_000 }); // scanning, leased
    const res = await q.expire(JOB_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.reason).toBe("conflict");
    const status = await q.status(JOB_ID);
    expect(status.ok && status.value.status).toBe("scanning");
  });

  it("redelivery is bounded — a job cannot be redelivered past the dead-letter cap", async () => {
    const { q, clock } = make({ [REDIS_QUEUE_ENV.maxAttempts]: "2" });
    await q.submit({ job: jobAt("queued"), inputs: ["f_x00000000001"], options: {} });
    await q.claim({ leaseMs: 10_000 }); // attempt 1
    clock.ms += 10_001;
    await q.claim({ leaseMs: 10_000 }); // attempt 2 (redelivered)
    clock.ms += 10_001;
    const capped = await q.claim({ leaseMs: 10_000 }); // attempt 3 > max(2) → dead-letter
    expect(capped.ok && capped.value).toBeNull();
    const status = await q.status(JOB_ID);
    expect(status.ok && status.value.status).toBe("failed");
  });
});

// ── No secret / payload leakage into the atomic transition path ─────────────────

describe("createRedisQueue — no leakage into EVAL payloads", () => {
  it("never puts the token, endpoint, raw idempotency key, or display filename into a script", async () => {
    const { fake, q } = make();
    await q.submit(
      {
        job: jobAt("queued"),
        inputs: ["f_x00000000001"],
        inputNames: ["Secret Client Report.pdf"],
        options: { level: "high" },
      },
      "user:secret-idem-key",
    );
    const claim = await q.claim({ leaseMs: 30_000 });
    const attempt = claim.ok && claim.value ? claim.value.attempt : 0;
    await q.advance(JOB_ID, { status: "processing" }, attempt);
    await q.complete(JOB_ID, [ARTIFACT], attempt);

    const evalCalls = fake.calls.filter((call) => call[0] === "EVAL");
    expect(evalCalls.length).toBeGreaterThan(0);
    const scriptTexts = Object.values(TRANSITION_SCRIPTS);
    for (const call of evalCalls) {
      // The program text is always a frozen constant — never dynamically built.
      expect(scriptTexts).toContain(call[1]);
      for (const arg of call) {
        // Secrets and the raw client idempotency key must never touch a transition.
        expect(arg).not.toContain(TOKEN);
        expect(arg).not.toContain("upstash.io");
        expect(arg).not.toContain("secret-idem-key");
        // The display filename rides the spec value, never a transition's record.
        expect(arg).not.toContain("Secret Client Report");
      }
    }
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETENTION,
  type Job,
  type JobArtifact,
  type JobStatus,
} from "@/lib/jobs";
import { createFakeRedis } from "./redis-fake";
import {
  parseRedisQueueConfig,
  REDIS_QUEUE_ENV,
  type RedisQueueConfig,
} from "./redis-config";
import { createRedisQueue } from "./redis";

const TOKEN = "AX_tokenEXAMPLEvalue000000000000000000000";
const HOUR_MS = 60 * 60_000;

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

function jobAt(status: JobStatus, jobId = "job_test000001"): Job {
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

describe("createRedisQueue — readiness", () => {
  it("identifies as redis, probes ready, and advertises every capability", () => {
    const { q } = make();
    expect(q.id).toBe("redis");
    expect(q.probe().ok).toBe(true);
    expect(q.capability()).toMatchObject({
      provider: "redis",
      ready: true,
      configured: true,
      enqueue: true,
      status: true,
      cancel: true,
    });
  });
});

describe("createRedisQueue — enqueue / status / idempotency", () => {
  it("enqueues a terminal job (no spec, not claimable) and reports it", async () => {
    const { q } = make();
    const job = jobAt("completed");
    expect((await q.enqueue(job, "key-1")).ok).toBe(true);
    const status = await q.status(job.jobId);
    expect(status.ok && status.value.status).toBe("completed");
    // enqueue does not make the job claimable (no spec, not on the ready list).
    const claim = await q.claim({ leaseMs: 30_000 });
    expect(claim.ok && claim.value).toBeNull();
  });

  it("resolves and misses idempotency keys honestly", async () => {
    const { q } = make();
    await q.enqueue(jobAt("completed"), "key-1");
    const hit = await q.lookupIdempotent("key-1");
    expect(hit.ok && hit.value?.jobId).toBe("job_test000001");
    const miss = await q.lookupIdempotent("absent");
    expect(miss.ok && miss.value).toBeNull();
  });

  it("status of an unknown job is an honest not_found", async () => {
    const { q } = make();
    const res = await q.status("job_absent00001");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.reason).toBe("not_found");
  });

  it("applies a retention TTL (EX) to every stored key", async () => {
    const { fake, q } = make({ [REDIS_QUEUE_ENV.jobTtlSeconds]: "3600" });
    await q.enqueue(jobAt("queued"), "key-1");
    // The job and the idempotency mapping are both written with EX 3600.
    const setCalls = fake.calls.filter((c) => c[0] === "SET");
    expect(setCalls.length).toBeGreaterThan(0);
    for (const call of setCalls) {
      expect(call).toContain("EX");
      expect(call[call.indexOf("EX") + 1]).toBe("3600");
    }
  });
});

describe("createRedisQueue — keys are namespaced and never user-controlled", () => {
  it("prefixes every key and hashes the client idempotency key", async () => {
    const { fake, q } = make();
    await q.submit(
      { job: jobAt("queued"), inputs: ["f_input0000001"], options: { level: "high" } },
      "user:secret-idem-key",
    );
    const keys = fake.keys();
    // Every key lives under the default namespace.
    expect(keys.every((k) => k.startsWith("pdfxyz:"))).toBe(true);
    expect(keys).toContain("pdfxyz:job:job_test000001");
    expect(keys).toContain("pdfxyz:spec:job_test000001");
    expect(keys).toContain("pdfxyz:ready");
    // The raw client key never becomes a broker key; it is stored as a SHA-256.
    expect(keys.some((k) => k.includes("secret-idem-key"))).toBe(false);
    const idemKey = keys.find((k) => k.startsWith("pdfxyz:idem:"));
    expect(idemKey).toMatch(/^pdfxyz:idem:[0-9a-f]{64}$/);
    // ...and it still resolves the job by the original client key.
    const hit = await q.lookupIdempotent("user:secret-idem-key");
    expect(hit.ok && hit.value?.jobId).toBe("job_test000001");
  });

  it("honors a custom, sanitized key prefix", async () => {
    const { fake, q } = make({ [REDIS_QUEUE_ENV.keyPrefix]: "tenant-a" });
    await q.submit({ job: jobAt("queued"), inputs: ["f_input0000001"], options: {} });
    expect(fake.keys().every((k) => k.startsWith("tenant-a:"))).toBe(true);
  });
});

describe("createRedisQueue — submit / claim / execution loop", () => {
  it("submits a queued job and claims it with its inputs, options, and lease", async () => {
    const { q, clock } = make();
    await q.submit({
      job: jobAt("queued"),
      inputs: ["f_input0000001"],
      options: { level: "balanced" },
    });
    const claim = await q.claim({ leaseMs: 30_000 });
    expect(claim.ok).toBe(true);
    if (!claim.ok || !claim.value) throw new Error("expected a claim");
    expect(claim.value.job.status).toBe("scanning");
    expect(claim.value.inputs).toEqual(["f_input0000001"]);
    expect(claim.value.options).toEqual({ level: "balanced" });
    expect(claim.value.attempt).toBe(1);
    expect(claim.value.leaseExpiresAt).toBe(clock.ms + 30_000);
    // The job record now reflects the claimed (scanning) state.
    const status = await q.status("job_test000001");
    expect(status.ok && status.value.status).toBe("scanning");
  });

  it("round-trips display inputNames through submit → claim as a spec value only", async () => {
    const { fake, q } = make();
    await q.submit({
      job: jobAt("queued"),
      inputs: ["f_input0000001"],
      inputNames: ["Secret Client Report.pdf"],
      options: {},
    });
    // The filename rides the spec VALUE — it must never appear in any broker KEY.
    for (const key of fake.keys()) {
      expect(key).not.toContain("Secret");
      expect(key).not.toContain("Report");
      expect(key).not.toContain(".pdf");
    }
    const claim = await q.claim({ leaseMs: 30_000 });
    if (!claim.ok || !claim.value) throw new Error("expected a claim");
    expect(claim.value.inputNames).toEqual(["Secret Client Report.pdf"]);
  });

  it("claims nothing when the ready list is empty", async () => {
    const { q } = make();
    const claim = await q.claim({ leaseMs: 30_000 });
    expect(claim.ok && claim.value).toBeNull();
  });

  it("clamps the lease to the configured ceiling", async () => {
    const { q, clock } = make({ [REDIS_QUEUE_ENV.leaseSeconds]: "60" });
    await q.submit({ job: jobAt("queued"), inputs: ["f_input0000001"], options: {} });
    const claim = await q.claim({ leaseMs: 10 * 60_000 }); // ask for 10 min
    if (!claim.ok || !claim.value) throw new Error("expected a claim");
    expect(claim.value.leaseExpiresAt).toBe(clock.ms + 60_000); // clamped to 60s
  });

  it("advances scanning → processing → completed and clears execution state", async () => {
    const { q } = make();
    await q.submit({ job: jobAt("queued"), inputs: ["f_input0000001"], options: {} });
    await q.claim({ leaseMs: 30_000 });
    expect((await q.advance("job_test000001", { status: "processing", progress: 40 })).ok).toBe(
      true,
    );
    const done = await q.complete("job_test000001", [ARTIFACT]);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.status).toBe("completed");
    expect(done.value.progress).toBe(100);
    expect(done.value.artifacts).toHaveLength(1);
    // Completion clears the spec + lease, so there is nothing left to claim.
    expect((await q.claim({ leaseMs: 30_000 })).ok).toBe(true);
    const empty = await q.claim({ leaseMs: 30_000 });
    expect(empty.ok && empty.value).toBeNull();
  });

  it("rejects an illegal advance with a conflict", async () => {
    const { q } = make();
    // completed is terminal; advancing it back to processing is illegal.
    await q.enqueue(jobAt("completed"));
    const bad = await q.advance("job_test000001", { status: "processing" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.reason).toBe("conflict");
  });

  it("extends a lease on heartbeat so the job is not redelivered", async () => {
    const { q, clock } = make();
    await q.submit({ job: jobAt("queued"), inputs: ["f_input0000001"], options: {} });
    await q.claim({ leaseMs: 30_000 }); // clock 1000 → lease expires 31_000
    clock.ms = 20_000;
    expect((await q.heartbeat("job_test000001", 30_000)).ok).toBe(true); // → 50_000
    clock.ms = 40_000; // past the original 31_000, before the extended 50_000
    const claim = await q.claim({ leaseMs: 30_000 });
    // Nothing is redelivered because the lease is still live.
    expect(claim.ok && claim.value).toBeNull();
  });

  it("heartbeating a job with no live lease is a conflict", async () => {
    const { q } = make();
    await q.enqueue(jobAt("queued"));
    const res = await q.heartbeat("job_test000001", 30_000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.reason).toBe("conflict");
  });
});

describe("createRedisQueue — retries, redelivery, and the dead-letter cap", () => {
  it("requeues a retryable failure, carrying the attempt count forward", async () => {
    const { q } = make();
    await q.submit({ job: jobAt("queued"), inputs: ["f_input0000001"], options: {} });
    const first = await q.claim({ leaseMs: 30_000 });
    expect(first.ok && first.value?.attempt).toBe(1);
    const failed = await q.fail(
      "job_test000001",
      { code: "timeout", message: "slow", retryable: true },
      { requeue: true },
    );
    expect(failed.ok && failed.value.status).toBe("queued");
    const second = await q.claim({ leaseMs: 30_000 });
    expect(second.ok && second.value?.attempt).toBe(2);
  });

  it("redelivers a job whose lease expired and bumps its attempt", async () => {
    const { q, clock } = make();
    await q.submit({ job: jobAt("queued"), inputs: ["f_input0000001"], options: {} });
    await q.claim({ leaseMs: 30_000 }); // clock 1000 → expires 31_000
    clock.ms = 31_000; // lease now expired
    const redelivered = await q.claim({ leaseMs: 30_000 });
    expect(redelivered.ok).toBe(true);
    if (!redelivered.ok || !redelivered.value) throw new Error("expected redelivery");
    expect(redelivered.value.attempt).toBe(2);
    expect(redelivered.value.job.status).toBe("scanning");
  });

  it("dead-letters a job that exceeds the max attempts instead of re-claiming", async () => {
    const { q } = make({ [REDIS_QUEUE_ENV.maxAttempts]: "1" });
    await q.submit({ job: jobAt("queued"), inputs: ["f_input0000001"], options: {} });
    await q.claim({ leaseMs: 30_000 }); // attempt 1
    await q.fail(
      "job_test000001",
      { code: "timeout", message: "slow", retryable: true },
      { requeue: true },
    );
    // The next claim would be attempt 2 > max(1): the broker fails it terminally.
    const capped = await q.claim({ leaseMs: 30_000 });
    expect(capped.ok && capped.value).toBeNull();
    const status = await q.status("job_test000001");
    expect(status.ok && status.value.status).toBe("failed");
    expect(status.ok && status.value.error?.code).toBe("internal_error");
  });

  it("fails a job terminally with its typed error when not requeued", async () => {
    const { q } = make();
    await q.submit({ job: jobAt("queued"), inputs: ["f_input0000001"], options: {} });
    await q.claim({ leaseMs: 30_000 });
    const res = await q.fail(
      "job_test000001",
      { code: "unprocessable", message: "bad pdf", retryable: false },
      { requeue: false },
    );
    expect(res.ok && res.value.status).toBe("failed");
    if (res.ok) expect(res.value.error?.code).toBe("unprocessable");
  });
});

describe("createRedisQueue — cancel / expire state machine", () => {
  it("cancels an in-flight job, stamps updatedAt, and removes it from the queue", async () => {
    const { q, clock } = make();
    clock.ms = 5_000;
    await q.submit({ job: jobAt("queued"), inputs: ["f_input0000001"], options: {} });
    const res = await q.cancel("job_test000001");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.status).toBe("canceled");
    expect(res.value.updatedAt).toBe(new Date(5_000).toISOString());
    // Removed from the ready list: nothing is claimable.
    expect((await q.claim({ leaseMs: 30_000 })).ok).toBe(true);
    const empty = await q.claim({ leaseMs: 30_000 });
    expect(empty.ok && empty.value).toBeNull();
  });

  it("refuses to cancel a completed job (conflict)", async () => {
    const { q } = make();
    await q.enqueue(jobAt("completed"));
    const res = await q.cancel("job_test000001");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.reason).toBe("conflict");
  });

  it("expires a completed job's outputs and drops its artifacts", async () => {
    const { q } = make();
    await q.enqueue(jobAt("completed"));
    const res = await q.expire("job_test000001");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.status).toBe("expired");
    expect(res.value.artifacts).toBeUndefined();
  });

  it("refuses to expire a job that never completed (conflict)", async () => {
    const { q } = make();
    await q.enqueue(jobAt("processing"));
    const res = await q.expire("job_test000001");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.reason).toBe("conflict");
  });
});

describe("createRedisQueue — honest unavailable on transport failure", () => {
  it("maps a broker outage to a typed unavailable on every operation", async () => {
    const { fake, q } = make();
    await q.submit({ job: jobAt("queued"), inputs: ["f_input0000001"], options: {} });
    fake.failing = true;
    for (const res of [
      await q.status("job_test000001"),
      await q.enqueue(jobAt("queued", "job_other00001")),
      await q.submit({ job: jobAt("queued"), inputs: ["f_x00000000001"], options: {} }),
      await q.lookupIdempotent("k"),
      await q.claim({ leaseMs: 30_000 }),
      await q.cancel("job_test000001"),
    ]) {
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.reason).toBe("unavailable");
    }
  });
});

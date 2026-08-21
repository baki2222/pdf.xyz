// @vitest-environment node
/**
 * The delivery cap survives the whole path from the route that charges for it
 * to the input the processor is handed — the seams, not the two ends.
 *
 * The cap is the only thing that makes the character reservation true. If it
 * stops arriving — a queue that persists `options` and forgets `delivery`, a
 * claim that rebuilds a `ClaimedJob` field by field, a new queue provider
 * written from the old one — **every job silently becomes uncapped again.** The
 * product keeps working. Translations get longer, not shorter. Nothing errors,
 * no unit test notices: the route still computes a cap and the engine still
 * enforces one, and only the path between them is dead.
 *
 * That is the exact shape measured on a different feature in this codebase,
 * where two boundaries each passed their own tests (185/186) and the composed
 * chain dropped to 174/186.
 *
 * ── HOW THE SET OF QUEUES IS DECIDED ────────────────────────────────────────
 *
 * The static half DISCOVERS its subjects: it reads the queue directory from
 * `git ls-files` and derives which modules persist a submission from the fact
 * that they mention `submission.options` — a relationship, not a list. A queue
 * added tomorrow is in the corpus the moment it stores a submission, because a
 * queue that does not store options is not storing jobs.
 *
 * The behavioural half names the two real providers, because their constructors
 * genuinely differ (one takes a Redis config and client, the other a store) and
 * nothing can instantiate an unknown one. That is the honest split: discovery
 * catches a queue that forgets the field, execution proves the two that exist
 * actually carry it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Job, JobDeliveryCap } from "@/lib/jobs";
import { DEFAULT_RETENTION } from "@/lib/jobs";
import {
  TRANSLATE_EXTRACTOR_HEADROOM,
  TRANSLATE_MAX_INPUT_CHARS,
} from "@/lib/jobs/translate-limits";
import { createFakeRedis } from "./queue/redis-fake";
import { createRedisQueue } from "./queue/redis";
import { parseRedisQueueConfig, REDIS_QUEUE_ENV } from "./queue/redis-config";
import { createLocalDevQueue } from "./queue/local-dev";
import { DevWorkerStore } from "./store";
import type { ClaimableQueue } from "./queue/claim";

const CAP: JobDeliveryCap = { characters: 56_816, pages: 9 };

function queuedJob(jobId = "job_test000001"): Job {
  return {
    jobId,
    tool: "translate-pdf",
    capability: "secure-worker",
    status: "queued",
    progress: 0,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    /**
     * Far future, and not an offset from the injected clock.
     *
     * The first version used `new Date(3_600_000)` — an hour past the epoch,
     * matching the fake clock — and `DevWorkerStore.getJob` drops expired jobs
     * against the REAL wall clock, so the local-dev queue claimed nothing and
     * the round-trip failed for the fixture's own bug rather than for the
     * property it exists to hold. A control that fails for its own bug is not a
     * control.
     */
    expiresAt: "2100-01-01T00:00:00.000Z",
    retention: DEFAULT_RETENTION,
  };
}

// ---------------------------------------------------------------------------
// 1. The route computes the cap and hands it to the adapter
// ---------------------------------------------------------------------------

const createJobCalls: { request: unknown; delivery: unknown }[] = [];

vi.mock("@/lib/workers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workers")>();
  return {
    ...actual,
    getWorkerAdapter: async () => ({
      mode: "local-dev" as const,
      createUploadSession: async () => {
        throw new Error("unused");
      },
      createJob: async (request: unknown, delivery: unknown) => {
        createJobCalls.push({ request, delivery });
        return {
          ok: true as const,
          status: 202 as const,
          value: queuedJob(),
        };
      },
      getJob: async () => {
        throw new Error("unused");
      },
      cancelJob: async () => {
        throw new Error("unused");
      },
    }),
  };
});

async function postJob(body: Record<string, unknown>): Promise<unknown> {
  const { POST } = await import("@/app/api/jobs/route");
  createJobCalls.length = 0;
  const res = await POST(
    new Request("http://localhost/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  expect(
    res.status,
    `the route refused the request instead of reaching the adapter: ${await res.clone().text()}`,
  ).toBe(202);
  expect(
    createJobCalls,
    "the route never reached the adapter, so this test measured nothing",
  ).toHaveLength(1);
  return createJobCalls[0]!.delivery;
}

describe("the route hands the adapter the cap it charged for", () => {
  it("derives the character bound from the declaration and the headroom", async () => {
    const delivery = await postJob({
      tool: "translate-pdf",
      inputs: ["f_abc123def456"],
      options: { targetLanguage: "fr", sourceLanguage: "auto" },
      declaredCharacters: 14_204,
      declaredTextPages: 9,
    });
    expect(
      delivery,
      "the cap the worker will enforce is not the reservation the client was charged",
    ).toEqual({
      characters: 14_204 * TRANSLATE_EXTRACTOR_HEADROOM,
      pages: 9,
    });
  });

  it("falls back to a whole call's worth when nothing was declared", async () => {
    // The direct-API path: it has bytes, not extracted text. It pays the
    // maximum and is capped at the maximum — the same number in both roles, so
    // "you get what you reserved" holds for a caller that cannot count.
    const delivery = await postJob({
      tool: "translate-pdf",
      inputs: ["f_abc123def456"],
      options: { targetLanguage: "fr", sourceLanguage: "auto" },
    });
    expect(delivery).toEqual({
      characters: Math.ceil(
        TRANSLATE_MAX_INPUT_CHARS * TRANSLATE_EXTRACTOR_HEADROOM,
      ),
    });
  });

  it("CONTROL: a non-AI job gets no cap at all", async () => {
    // A cap that leaked onto every tool would bound compression by a character
    // count, which is meaningless — and it would do so invisibly, because
    // nothing else in the system reads the field.
    const delivery = await postJob({
      tool: "ocr-pdf",
      inputs: ["f_abc123def456"],
    });
    expect(delivery).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Every real queue carries it from submit to claim
// ---------------------------------------------------------------------------

function redisQueue(): ClaimableQueue {
  const parsed = parseRedisQueueConfig({
    [REDIS_QUEUE_ENV.provider]: "redis",
    [REDIS_QUEUE_ENV.restUrl]: "https://example.upstash.io",
    [REDIS_QUEUE_ENV.restToken]: "AX_tokenEXAMPLEvalue000000000000000000000",
  });
  if (!parsed.ok) throw new Error("invalid test config");
  return createRedisQueue(parsed.config, {
    client: createFakeRedis(),
    now: () => 1_000,
  }) as ClaimableQueue;
}

function localDevQueue(): ClaimableQueue {
  return createLocalDevQueue({
    store: new DevWorkerStore(),
    now: () => 1_000,
  }) as ClaimableQueue;
}

describe.each([
  ["redis", redisQueue],
  ["local-dev", localDevQueue],
])("the %s queue round-trips the cap", (_name, build) => {
  it("submit → claim returns the same cap", async () => {
    const queue = build();
    const submitted = await queue.submit({
      job: queuedJob(),
      inputs: ["f_abc123def456"],
      options: { targetLanguage: "fr" },
      delivery: CAP,
    });
    expect(submitted.ok, "the submission was rejected").toBe(true);

    const claim = await queue.claim({ leaseMs: 30_000 });
    expect(claim.ok && claim.value, "nothing was claimable").toBeTruthy();
    if (!claim.ok || !claim.value) return;
    expect(
      claim.value.delivery,
      "the queue stored a job's spec and dropped its delivery cap, so every " +
        "job it serves is uncapped while the route still charges for one",
    ).toEqual(CAP);
  });

  it("CONTROL: a submission with no cap claims back with no cap", async () => {
    // Absent must stay absent rather than becoming a zero, an empty object, or
    // an inherited value from a previous job. An absent cap means unbounded;
    // a `{characters: 0}` would mean the tool delivers nothing, for everyone.
    const queue = build();
    await queue.submit({
      job: queuedJob("job_test000002"),
      inputs: ["f_abc123def456"],
      options: {},
    });
    const claim = await queue.claim({ leaseMs: 30_000 });
    expect(claim.ok && claim.value).toBeTruthy();
    if (!claim.ok || !claim.value) return;
    expect(claim.value.delivery).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Any queue that persists a submission must persist the cap
// ---------------------------------------------------------------------------

describe("every queue that stores a submission stores its cap", () => {
  it("is derived from the tree, not from a list of files", () => {
    const tracked = execFileSync("git", ["ls-files", "src/lib/workers/queue"], {
      encoding: "utf8",
    })
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".ts") && !line.includes(".test."));

    // BOUND THE CORPUS. An empty or collapsed file list makes every assertion
    // below vacuously true and reports the strongest possible pass — and a
    // corpus that silently shrank is invisible to any assertion about its
    // members.
    expect(
      tracked.length,
      "the queue directory listing is implausibly small — the corpus, not the code, is what failed",
    ).toBeGreaterThanOrEqual(8);

    const persisting = tracked.filter((file) =>
      readFileSync(file, "utf8").includes("submission.options"),
    );
    expect(
      persisting.length,
      "no queue module appears to persist a submission, so the check below asks nothing",
    ).toBeGreaterThanOrEqual(2);

    for (const file of persisting) {
      const source = readFileSync(file, "utf8");
      expect(
        source.includes("submission.delivery"),
        `${file} stores a submission's options and not its delivery cap — every job it queues would be uncapped`,
      ).toBe(true);
    }
  });
});

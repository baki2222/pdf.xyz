// @vitest-environment jsdom
/**
 * The worker batch's adapter (batch plan P3, "Worker design"), driven over
 * the REAL job client (`runSecurityJob`, `resumeSecurityJob`) and the REAL
 * batch driver, with only `fetch` injected — every request recorded in the
 * order it was made:
 *
 *   - one in flight: file k+1's upload starts only after job k is terminal,
 *     and its output downloaded;
 *   - a 429 from one of the two HOURLY limits (reserving the upload,
 *     creating the job) PAUSES with the typed `retryAfterSeconds`: the file
 *     goes back to the queue, never into error, and no later file reaches
 *     the network while the batch waits. A 429 from storage fails the row
 *     with the storage sentence; a 429 on the download of a finished job is
 *     waited out and fetched again BY ITS ID, never as a new job;
 *   - ONE telemetry outcome per file, however many attempts it took, and
 *     none for a pause or a cancel;
 *   - a job the client stopped waiting for is resumed BY ITS ID, a bounded
 *     number of times, never uploaded again; then its row fails honestly
 *     and the job is stopped;
 *   - a file over the tool's ceiling never reaches `/api/uploads`;
 *   - Cancel sends DELETE exactly once, and only for a job that exists;
 *   - nothing is written to `useWorkerJob`'s sessionStorage resume key.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import {
  configureTelemetry,
  resetTelemetry,
  type RedactedEvent,
} from "@/lib/telemetry/track";
import { enterToolPage } from "@/lib/telemetry/tool-outcome";
import { toolErrorReason } from "@/lib/telemetry/events";
import { RATE_LIMIT_POLICIES } from "@/lib/ratelimit/policy";
import { WORKER_JOB_STORAGE_PREFIX } from "@/lib/workers/job-resume-key";
import { act, renderHook, waitFor } from "@testing-library/react";
import { observeFor } from "@/tests/time-bound";
import { RATE_LIMITS } from "@/lib/jobs/types";
import { jobPollFor } from "@/lib/jobs/client-wait";
import {
  runSecurityJob,
  resumeSecurityJob,
  type FetchLike,
  type PdfSecurityWorkerOptions,
} from "@/lib/workers/pdf-security-client";
import { workerFileCeilingBytes } from "@/lib/workers/engine-file-ceilings";
import { loadJobRun } from "@/lib/workers/job-run-lazy";
import { useBatchRunner, type BatchUnit } from "../use-batch-runner";
import { warmEnding } from "../runner-kit";
import {
  BatchItemError,
  WORKER_BATCH_DOWNLOAD_RETRIES,
  WORKER_BATCH_DOWNLOAD_WAIT_CAP_SECONDS,
  WORKER_BATCH_MAX_RESUMES,
  workerBatchPause,
  workerDownloadRefusedMessage,
  workerOutcomeReporter,
  workerProcess,
  workerStageOf,
  workerStillRunningMessage,
} from "./worker-batch";

const TOOL = "optimize-web";

interface Script {
  /** Answer `POST /api/uploads` for the n-th reservation (0-based) with a 429. */
  limitUploadAt?: number;
  /** The statuses each job's polls read, in order; the last repeats. */
  statuses?: string[];
  /** Hold every PUT until this resolves. */
  holdPut?: Promise<void>;
  /** Hold every job creation's ANSWER until this resolves. */
  holdCreate?: Promise<void>;
  /** Answer the n-th PUT (0-based) with a 429 storage asks 30 s for. */
  limitPutAt?: number;
  /** Answer the n-th `POST /api/jobs` (0-based) with a 429. */
  limitCreateAt?: number;
  /** Refuse this many downloads with a 429 (Retry-After 1) before serving. */
  limitDownloads?: number;
  /** The Retry-After, in seconds, of the hourly limits' 429s (default "1"). */
  retryAfter?: string;
}

function respond(status: number, body: unknown, headers = {}) {
  const h = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => new TextEncoder().encode("%PDF-out").buffer,
    headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null },
  };
}

/** The worker API, at the wire, recording every request in order. */
function wire(script: Script = {}) {
  const log: string[] = [];
  // When each reservation arrived (Date.now()), by its index.
  const reservedAt: number[] = [];
  let reservations = 0;
  let jobs = 0;
  let puts = 0;
  let creates = 0;
  let refusedDownloads = 0;
  // Jobs created and not yet seen terminal: the most at any one moment.
  const live = new Set<string>();
  let maxLive = 0;
  const polls = new Map<string, number>();
  const statuses = script.statuses ?? ["completed"];
  const jobBody = (id: string, status: string) => ({
    jobId: id,
    status,
    ...(status === "completed"
      ? {
          artifacts: [
            {
              artifactId: `art_${id}`,
              filename: `${id}-out.pdf`,
              contentType: "application/pdf",
              bytes: 8,
              url: `/__art/${id}`,
              expiresAt: "2099-01-01T00:00:00Z",
            },
          ],
        }
      : {}),
  });
  // A real fetch rejects once its signal is aborted; so does this one.
  const abortable = (init?: { signal?: AbortSignal }) => {
    if (init?.signal?.aborted)
      throw new DOMException("The operation was aborted.", "AbortError");
  };
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    if (method !== "DELETE") abortable(init);
    if (url === "/api/uploads") {
      const n = reservations++;
      log.push(`reserve ${n}`);
      reservedAt[n] = Date.now();
      if (script.limitUploadAt === n)
        return respond(
          429,
          { error: { code: "rate_limited", message: "Too many requests." } },
          { "Retry-After": script.retryAfter ?? "1" },
        );
      return respond(200, {
        slots: [
          {
            fileId: `file_${n}`,
            url: `/__put/${n}`,
            method: "PUT",
            headers: {},
          },
        ],
      });
    }
    if (url.startsWith("/__put/")) {
      log.push(`put ${url.slice(7)}`);
      if (script.limitPutAt === puts++)
        return respond(429, "<Error>SlowDown</Error>", { "Retry-After": "30" });
      if (script.holdPut) await script.holdPut;
      abortable(init);
      return respond(200, {});
    }
    if (url === "/api/jobs" && method === "POST") {
      if (script.holdCreate) {
        log.push("create requested");
        await script.holdCreate;
      }
      if (script.limitCreateAt === creates++) {
        log.push("create refused");
        return respond(
          429,
          { error: { code: "rate_limited", message: "Too many jobs." } },
          { "Retry-After": script.retryAfter ?? "1" },
        );
      }
      const id = `job_${jobs++}`;
      log.push(`create ${id}`);
      polls.set(id, 0);
      live.add(id);
      maxLive = Math.max(maxLive, live.size);
      return respond(200, jobBody(id, "queued"));
    }
    const m = /^\/api\/jobs\/(job_\d+)$/.exec(url);
    if (m && method === "DELETE") {
      log.push(`delete ${m[1]}`);
      live.delete(m[1]!);
      return respond(200, jobBody(m[1]!, "canceled"));
    }
    if (m) {
      const n = (polls.get(m[1]!) ?? 0) + 1;
      polls.set(m[1]!, n);
      const status = statuses[Math.min(n - 1, statuses.length - 1)]!;
      log.push(`poll ${m[1]} ${status}`);
      if (["completed", "failed", "canceled"].includes(status))
        live.delete(m[1]!);
      return respond(200, jobBody(m[1]!, status));
    }
    if (url.startsWith("/__art/")) {
      if (refusedDownloads < (script.limitDownloads ?? 0)) {
        refusedDownloads += 1;
        log.push(`download refused ${url.slice(7)}`);
        return respond(
          429,
          { error: { code: "rate_limited", message: "Too many downloads." } },
          { "Retry-After": "1" },
        );
      }
      log.push(`download ${url.slice(7)}`);
      return respond(200, {});
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { log, reservedAt, fetchImpl, maxLive: () => maxLive };
}

const pdf = (name: string, size = 64) =>
  new File([new Uint8Array(size).fill(0x25)], name, {
    type: "application/pdf",
  });
const unitsOf = (...files: File[]): BatchUnit[] =>
  files.map((file) => ({ id: file.name, name: file.name, file }));

const run = (
  input: { filename: string; bytes: Uint8Array },
  controls: PdfSecurityWorkerOptions,
) => runSecurityJob(TOOL, input.filename, input.bytes, {}, controls);
const resume = (jobId: string, controls: PdfSecurityWorkerOptions) =>
  resumeSecurityJob(jobId, { ...controls, tool: TOOL });

/** Instant polling: every wait in the client resolves at once. */
const FAST = { sleep: async () => {}, pollIntervalMs: 0 } as const;

// Three lazy imports sit on this file's paths: job-run (uncapped), the
// result ending (raced against ENDING_WAIT_MS, 800 ms, before the LAST
// file settles) and recents (fire-and-forget from the completion report:
// the only storage write here). Cold, they put up to 800 ms under a 1 s
// default wait, depending on test order and what the isolate:false module
// cache held. Loaded once here, the waits below cover in-memory work.
beforeAll(async () => {
  await loadJobRun();
  await warmEnding();
  await import("@/lib/intent/recents");
});

let storageWrites: string[] = [];
let events: RedactedEvent[] = [];
let leave: () => void = () => {};
/** Every telemetry outcome, in order: `tool_completed` or `tool_failed:<reason>`. */
const outcomes = () =>
  events
    .filter((e) => e.name === "tool_completed" || e.name === "tool_failed")
    .map((e) =>
      e.name === "tool_failed" ? `tool_failed:${String(e.reason)}` : e.name,
    );
beforeEach(() => {
  events = [];
  configureTelemetry((e) => events.push(e));
  leave = enterToolPage({ toolSlug: TOOL, capability: "secure-worker" });
  storageWrites = [];
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key: string, value: string) {
    storageWrites.push(key);
    return original.call(this, key, value);
  };
  (globalThis as { __restoreSetItem?: () => void }).__restoreSetItem = () => {
    Storage.prototype.setItem = original;
  };
});
afterEach(() => {
  (globalThis as { __restoreSetItem?: () => void }).__restoreSetItem?.();
  leave();
  resetTelemetry();
});

function batch(
  w: ReturnType<typeof wire>,
  units: BatchUnit[],
  extra: {
    maxPollAttempts?: number;
    pollIntervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  // As the runner builds it: the real reporter, and one map of finished
  // jobs for every run of this batch.
  const process = workerProcess(run, resume, {
    fetchImpl: w.fetchImpl,
    report: workerOutcomeReporter(TOOL),
    finished: new WeakMap(),
    ...FAST,
    ...extra,
  });
  return renderHook(() =>
    useBatchRunner(units, process, {
      reportsOutcome: false,
      pauseOn: workerBatchPause,
    }),
  );
}

describe("one in flight: file k+1 uploads only after job k is terminal", () => {
  it("records upload(k) → job(k) → terminal(k) → download(k) → upload(k+1)", async () => {
    const w = wire({ statuses: ["processing", "completed"] });
    const units = unitsOf(pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf"));
    const { result } = batch(w, units);
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("done"));
    expect(result.current.state.items.map((i) => i.status)).toEqual([
      "done",
      "done",
      "done",
    ]);
    // The whole wire, in order: each file's life ends before the next begins.
    expect(w.log).toEqual(
      [0, 1, 2].flatMap((k) => [
        `reserve ${k}`,
        `put ${k}`,
        `create job_${k}`,
        `poll job_${k} processing`,
        `poll job_${k} completed`,
        `download job_${k}`,
      ]),
    );
    // Positive control for the setItem patch: the one writer on this path is
    // the fire-and-forget recents record of a finished run, which nothing
    // here awaits. A bare check raced it (0-50 ms against an import); this
    // waits for it, so the absence check below runs after it has written.
    await waitFor(() => expect(storageWrites.length).toBeGreaterThan(0));
    // useWorkerJob's resume key, never written (the recents a finished run
    // records are not a job).
    expect(
      storageWrites.filter((k) => k.startsWith(WORKER_JOB_STORAGE_PREFIX)),
    ).toEqual([]);
    // One outcome per file, and the client's own reporting stayed off.
    expect(outcomes()).toEqual([
      "tool_completed",
      "tool_completed",
      "tool_completed",
    ]);
  });

  it("at no moment is more than one job alive on the wire", async () => {
    const w = wire({ statuses: ["queued", "processing", "completed"] });
    const units = unitsOf(pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf"));
    const { result } = batch(w, units);
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("done"));
    // Health: three jobs did exist, so a 1 is a measurement, not a blind 0.
    expect(w.log.filter((l) => l.startsWith("create job_"))).toHaveLength(3);
    expect(w.maxLive()).toBe(1);
  });

  it("POSITIVE CONTROL: the same instrument sees two jobs alive when two files run at once", async () => {
    const w = wire({ statuses: ["queued", "processing", "completed"] });
    const process = workerProcess(run, resume, {
      fetchImpl: w.fetchImpl,
      ...FAST,
    });
    const signal = new AbortController().signal;
    // Not the driver: two files started together, as a concurrent batch would.
    await Promise.all([
      process(pdf("a.pdf"), signal),
      process(pdf("b.pdf"), signal),
    ]);
    expect(w.maxLive()).toBe(2);
  });

  it("why one at a time: two jobs polled at once would need more status requests than a minute allows", () => {
    // The REASON, not the behaviour (the two tests above pin that): a job is
    // polled every `intervalMs`, and every visitor on an address shares one
    // per-minute status allowance.
    const perJobPerMinute = Math.ceil(60_000 / jobPollFor(TOOL).intervalMs);
    expect(perJobPerMinute).toBeLessThanOrEqual(
      RATE_LIMITS.statusRequestsPerMinutePerClient,
    );
    expect(2 * perJobPerMinute).toBeGreaterThan(
      RATE_LIMITS.statusRequestsPerMinutePerClient,
    );
  });
});

describe("a 429 pauses the batch: typed wait, never an error, nothing after it runs", () => {
  it("puts the limited file back in the queue and no later file reaches the network", async () => {
    // Retry-After 30 s: the runner's own resume timer is then 30 s away, so
    // nothing legitimate can happen in the window below. At "1" the whole
    // pause-to-cancel stretch, a fixed 300 ms included, had to beat a real
    // 1 s timer, and losing read exactly like the leak this test is for.
    const w = wire({ limitUploadAt: 1, retryAfter: "30" });
    const units = unitsOf(pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf"));
    const { result } = batch(w, units);
    // Only Date is faked (timers stay real), so the clock the pause is
    // computed from stands still and resumeAt can be checked EXACTLY.
    vi.useFakeTimers({ toFake: ["Date"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const now = Date.now();
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("paused"));
    expect(result.current.state.items.map((i) => i.status)).toEqual([
      "done",
      "queued",
      "queued",
    ]);
    // resumeAt is exactly the limit's own Retry-After (30 s): not a guess,
    // not padded, not read as milliseconds. Exact on a clock that stands
    // still, so no runner speed is in it (it replaced a 2 s slack on
    // 2026-11-21).
    expect(result.current.resumeAt).toBe(now + 30_000);
    const atPause = [...w.log];
    expect(atPause[atPause.length - 1]).toBe("reserve 1");
    // While paused, nothing — a window, kept: a pause timer that read the
    // wait as milliseconds would land inside it.
    await act(() =>
      observeFor(
        "worker-batch.paused-no-network",
        300,
        "no later file may reach the network while the batch is paused",
      ),
    );
    expect(w.log).toEqual(atPause);
    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.state.phase).toBe("canceled"));
    expect(w.log).toEqual(atPause);
    // The file that finished, once; nothing for the pause or the cancel.
    expect(outcomes()).toEqual(["tool_completed"]);
  });

  it("a 429 creating the job pauses too, and the paused file counts once when it finishes", async () => {
    const w = wire({ limitCreateAt: 1 });
    const { result } = batch(w, unitsOf(pdf("a.pdf"), pdf("b.pdf")));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("paused"));
    expect(result.current.state.items.map((i) => i.status)).toEqual([
      "done",
      "queued",
    ]);
    const resumeAt = result.current.resumeAt!;
    // 4000 ms over a real 1 s Retry-After: this whole test took at most
    // 1075 ms on CI (failed run 44164715213, the max over 33 CI runs of
    // 11-09..11-21; 1058 ms among the 12 passing runs of 11-18, run
    // 44272458560), so > 3.7x, and it stays under the 5 s test
    // timeout, so this wait's own message wins.
    await waitFor(() => expect(result.current.state.phase).toBe("done"), {
      timeout: 4000,
    });
    // The paused file is uploaded again (its first input is left behind:
    // the P3 report's r2_orphan_check), and ONE job is made for it.
    expect(w.log.filter((l) => l.startsWith("reserve"))).toHaveLength(3);
    expect(w.log.filter((l) => l.startsWith("create job_"))).toEqual([
      "create job_0",
      "create job_1",
    ]);
    // Never early: the paused file's new reservation comes at resumeAt. A
    // Node timer can fire ~1 ms early against Date.now(); 50 ms of slack
    // still sees a resume at half the wait (500 ms early). One-directional:
    // a slower runner only makes it later.
    expect(w.reservedAt[2]! - resumeAt).toBeGreaterThanOrEqual(-50);
    expect(outcomes()).toEqual(["tool_completed", "tool_completed"]);
  });

  it("a 429 from STORAGE is not the hourly limit: the row fails with the storage sentence and the batch goes on", async () => {
    const w = wire({ limitPutAt: 0 });
    const { result } = batch(w, unitsOf(pdf("a.pdf"), pdf("b.pdf")));
    const phases: string[] = [];
    act(() => result.current.start());
    await waitFor(() => {
      phases.push(result.current.state.phase);
      expect(result.current.state.phase).toBe("done");
    });
    expect(phases).not.toContain("paused");
    const [a, b] = result.current.state.items;
    expect(a!.status).toBe("error");
    expect(a!.error).toMatch(/the storage service answered 429/);
    expect(b!.status).toBe("done");
    // No job for the refused upload; one for the next file.
    expect(w.log.filter((l) => l.startsWith("create"))).toEqual([
      "create job_0",
    ]);
    expect(outcomes()).toEqual([
      `tool_failed:${toolErrorReason("rate_limited")}`,
      "tool_completed",
    ]);
  });

  it("a 429 on the DOWNLOAD of a finished job is waited out and fetched by its id: no pause, no second upload, no second job", async () => {
    const w = wire({ limitDownloads: 1 });
    const { result } = batch(w, unitsOf(pdf("a.pdf"), pdf("b.pdf")));
    const phases: string[] = [];
    act(() => result.current.start());
    await waitFor(() => {
      phases.push(result.current.state.phase);
      expect(result.current.state.phase).toBe("done");
    });
    expect(phases).not.toContain("paused");
    expect(result.current.state.items.map((i) => i.status)).toEqual([
      "done",
      "done",
    ]);
    const first = w.log.slice(0, w.log.indexOf("reserve 1"));
    expect(first).toEqual([
      "reserve 0",
      "put 0",
      "create job_0",
      "poll job_0 completed",
      "download refused job_0",
      "poll job_0 completed",
      "download job_0",
    ]);
    expect(outcomes()).toEqual(["tool_completed", "tool_completed"]);
  });

  it("a download still refused after every wait fails its row, and Retry failed fetches that job's result, never a new job", async () => {
    const w = wire({ limitDownloads: 1 + WORKER_BATCH_DOWNLOAD_RETRIES });
    const { result } = batch(w, unitsOf(pdf("a.pdf")));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("done"));
    const [a] = result.current.state.items;
    expect(a!.status).toBe("error");
    expect(a!.error).toBe(
      workerDownloadRefusedMessage(
        "Too many downloads. Try again in about 1 second.",
      ),
    );
    act(() => result.current.retryFailed());
    await waitFor(() =>
      expect(result.current.state.items[0]!.status).toBe("done"),
    );
    expect(w.log.filter((l) => l.startsWith("reserve"))).toEqual(["reserve 0"]);
    expect(w.log.filter((l) => l.startsWith("create"))).toEqual([
      "create job_0",
    ]);
    expect(w.log[w.log.length - 1]).toBe("download job_0");
    // The failed row, then the retry the visitor asked for.
    expect(outcomes()).toEqual([
      `tool_failed:${toolErrorReason("rate_limited")}`,
      "tool_completed",
    ]);
  });

  it("the in-place download wait is the download limit's own window", () => {
    expect(WORKER_BATCH_DOWNLOAD_WAIT_CAP_SECONDS).toBe(
      RATE_LIMIT_POLICIES["artifacts.fetch"].windowSeconds,
    );
  });

  it("each request is known by its stage", () => {
    expect(workerStageOf("/api/uploads", "POST")).toBe("reserve");
    expect(workerStageOf("https://r2.example/b/k?sig=1", "PUT")).toBe("put");
    expect(workerStageOf("/api/jobs", "POST")).toBe("create");
    expect(workerStageOf("/api/jobs/job_1")).toBe("poll");
    expect(workerStageOf("/api/artifacts/local/a1")).toBe("download");
    expect(workerStageOf("https://pdf.xyz/api/jobs", "POST")).toBe("create");
    expect(workerStageOf("/api/jobs/job_1", "DELETE")).toBeNull();
  });

  it("the adapter throws the typed wait; workerBatchPause turns only an HOURLY limit into a moment", () => {
    // Date stands still (timers are not touched), so the wait is checked
    // exactly: it replaced a bracket with a 1 s slack on 2026-11-21.
    vi.useFakeTimers({ toFake: ["Date"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const now = Date.now();
    for (const stage of ["reserve", "create"] as const) {
      const limited = new BatchItemError(
        "Too many.",
        "rate_limited",
        30,
        stage,
      );
      expect(workerBatchPause(limited)).toBe(now + 30_000);
    }
    // A 429 from storage, the download or a poll is not the hourly limit.
    for (const stage of ["put", "download", "poll", undefined] as const)
      expect(
        workerBatchPause(
          new BatchItemError("Too many.", "rate_limited", 30, stage),
        ),
      ).toBeNull();
    // Controls: another code, or a rate limit with no readable wait, is not
    // a pause (no wait to keep).
    expect(
      workerBatchPause(
        new BatchItemError("x", "internal_error", 30, "reserve"),
      ),
    ).toBeNull();
    expect(
      workerBatchPause(
        new BatchItemError("x", "rate_limited", undefined, "reserve"),
      ),
    ).toBeNull();
    expect(workerBatchPause(new Error("x"))).toBeNull();
  });
});

describe("a job still running is resumed by its id, a bounded number of times", () => {
  it("resumes the SAME job (no new upload, no new job) and finishes", async () => {
    // Two polls per wait; the job completes on the third wait.
    const w = wire({
      statuses: [
        "processing",
        "processing",
        "processing",
        "processing",
        "completed",
      ],
    });
    const { result } = batch(w, unitsOf(pdf("a.pdf"), pdf("b.pdf")), {
      maxPollAttempts: 2,
    });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("done"));
    expect(result.current.state.items[0]!.status).toBe("done");
    const first = w.log.slice(0, w.log.indexOf("reserve 1"));
    expect(first.filter((l) => l.startsWith("reserve"))).toEqual(["reserve 0"]);
    expect(first.filter((l) => l.startsWith("create"))).toEqual([
      "create job_0",
    ]);
    expect(first.filter((l) => l.startsWith("poll job_0")).length).toBe(5);
    // Three waits for one file: one outcome, not a timeout per wait.
    expect(outcomes()).toEqual(["tool_completed", "tool_completed"]);
  });

  it("past the bound, the row fails in words, and the job is stopped once", async () => {
    const w = wire({ statuses: ["processing"] });
    const { result } = batch(w, unitsOf(pdf("a.pdf"), pdf("b.pdf")), {
      maxPollAttempts: 1,
    });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("done"));
    const [a] = result.current.state.items;
    expect(a!.status).toBe("error");
    expect(a!.error).toBe(workerStillRunningMessage());
    const first = w.log.slice(0, w.log.indexOf("reserve 1"));
    // The first wait plus WORKER_BATCH_MAX_RESUMES resumed waits, one poll each.
    expect(first.filter((l) => l.startsWith("poll job_0")).length).toBe(
      1 + WORKER_BATCH_MAX_RESUMES,
    );
    expect(first.filter((l) => l === "delete job_0")).toEqual(["delete job_0"]);
    expect(first.filter((l) => l.startsWith("reserve"))).toEqual(["reserve 0"]);
    expect(outcomes()).toEqual([
      `tool_failed:${toolErrorReason("timeout")}`,
      `tool_failed:${toolErrorReason("timeout")}`,
    ]);
  });
});

describe("refusals before the network, and Cancel", () => {
  it("a file over the tool's ceiling never calls /api/uploads", async () => {
    const w = wire();
    const big = pdf("big.pdf", workerFileCeilingBytes(TOOL) + 1);
    const { result } = batch(w, unitsOf(big, pdf("small.pdf")));
    act(() => result.current.start());
    // 4500 ms: the client reads every byte of the 100 MiB + 1 file before it
    // can refuse it, and ~300 MB of dead copies invite a GC inside the wait.
    // The whole test took at most 423 ms on CI (failed run 43636213581, the
    // max over 33 CI runs of 11-09..11-21; 380 ms among the 12 passing runs
    // of 11-18, run 44321190257), so > 10x; and it stays under
    // the 5 s test timeout, so this wait's own message wins.
    await waitFor(() => expect(result.current.state.phase).toBe("done"), {
      timeout: 4_500,
    });
    expect(result.current.state.items[0]!.status).toBe("error");
    expect(result.current.state.items[0]!.error).toMatch(
      /Nothing was uploaded/,
    );
    // Only the small file's reservation.
    expect(w.log.filter((l) => l.startsWith("reserve"))).toEqual(["reserve 0"]);
  });

  it("Cancel while a job exists sends DELETE once, for that job, and nothing after", async () => {
    const w = wire({ statuses: ["processing"] });
    const units = unitsOf(pdf("a.pdf"), pdf("b.pdf"));
    // Real waits here: the job must still be polling when Cancel lands.
    const { result } = batch(w, units, {
      maxPollAttempts: 10_000,
      pollIntervalMs: 10,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    });
    act(() => result.current.start());
    await waitFor(() => expect(w.log).toContain("create job_0"));
    act(() => result.current.cancel());
    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.running).toBe(false));
    // The row settles only once process() has returned: after this, the
    // file can send nothing more, which a 50 ms sleep could not show.
    await waitFor(() =>
      expect(result.current.state.items[0]!.status).not.toBe("running"),
    );
    expect(w.log.filter((l) => l.startsWith("delete"))).toEqual([
      "delete job_0",
    ]);
    expect(w.log.filter((l) => l.startsWith("reserve"))).toEqual(["reserve 0"]);
    expect(result.current.state.items.map((i) => i.status)).toEqual([
      "error",
      "canceled",
    ]);
    // Stopping is the visitor's choice, not the tool failing.
    expect(outcomes()).toEqual([]);
  });

  it("Cancel after the upload, before the job exists, waits for its id and stops that job", async () => {
    let release: () => void = () => {};
    const holdCreate = new Promise<void>((r) => (release = r));
    const w = wire({ holdCreate, statuses: ["processing"] });
    const { result } = batch(w, unitsOf(pdf("a.pdf"), pdf("b.pdf")));
    act(() => result.current.start());
    await waitFor(() => expect(w.log).toContain("create requested"));
    act(() => result.current.cancel());
    // The server answers the request the page already sent: a job exists.
    release();
    await waitFor(() => expect(result.current.running).toBe(false));
    // The row settles only once process() has returned: after this, the
    // file can send nothing more, which a 50 ms sleep could not show.
    await waitFor(() =>
      expect(result.current.state.items[0]!.status).not.toBe("running"),
    );
    expect(w.log.filter((l) => l.startsWith("delete"))).toEqual([
      "delete job_0",
    ]);
    expect(w.log.filter((l) => l.startsWith("reserve"))).toEqual(["reserve 0"]);
  });

  it("Cancel during the upload sends no DELETE: there is no job to stop", async () => {
    let release: () => void = () => {};
    const holdPut = new Promise<void>((r) => (release = r));
    const w = wire({ holdPut });
    const { result } = batch(w, unitsOf(pdf("a.pdf"), pdf("b.pdf")));
    act(() => result.current.start());
    await waitFor(() => expect(w.log).toContain("put 0"));
    act(() => result.current.cancel());
    release();
    await waitFor(() => expect(result.current.running).toBe(false));
    // The row settles only once process() has returned: after this, the
    // file can send nothing more, which a 50 ms sleep could not show.
    await waitFor(() =>
      expect(result.current.state.items[0]!.status).not.toBe("running"),
    );
    expect(w.log.filter((l) => l.startsWith("delete"))).toEqual([]);
    expect(w.log.filter((l) => l.startsWith("create"))).toEqual([]);
  });
});

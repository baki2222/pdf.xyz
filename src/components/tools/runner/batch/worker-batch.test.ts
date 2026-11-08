// @vitest-environment jsdom
/**
 * The worker batch's adapter (batch plan P3, "Worker design"), driven over
 * the REAL job client (`runSecurityJob`, `resumeSecurityJob`) and the REAL
 * batch driver, with only `fetch` injected — every request recorded in the
 * order it was made:
 *
 *   - one in flight: file k+1's upload starts only after job k is terminal,
 *     and its output downloaded;
 *   - a 429 PAUSES with the typed `retryAfterSeconds`: the file goes back to
 *     the queue, never into error, and no later file reaches the network
 *     while the batch waits;
 *   - a job the client stopped waiting for is resumed BY ITS ID, a bounded
 *     number of times, never uploaded again; then its row fails honestly
 *     and the job is stopped;
 *   - a file over the tool's ceiling never reaches `/api/uploads`;
 *   - Cancel sends DELETE exactly once, and only for a job that exists;
 *   - nothing is written to `useWorkerJob`'s sessionStorage resume key.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { RATE_LIMITS } from "@/lib/jobs/types";
import { jobPollFor } from "@/lib/jobs/client-wait";
import {
  runSecurityJob,
  resumeSecurityJob,
  type FetchLike,
  type PdfSecurityWorkerOptions,
} from "@/lib/workers/pdf-security-client";
import { workerFileCeilingBytes } from "@/lib/workers/engine-file-ceilings";
import { useBatchRunner, type BatchUnit } from "../use-batch-runner";
import {
  BatchItemError,
  WORKER_BATCH_MAX_RESUMES,
  workerBatchPause,
  workerProcess,
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
  let reservations = 0;
  let jobs = 0;
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
      if (script.limitUploadAt === n)
        return respond(
          429,
          { error: { code: "rate_limited", message: "Too many requests." } },
          { "Retry-After": "1" },
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
      if (script.holdPut) await script.holdPut;
      abortable(init);
      return respond(200, {});
    }
    if (url === "/api/jobs" && method === "POST") {
      if (script.holdCreate) {
        log.push("create requested");
        await script.holdCreate;
      }
      const id = `job_${jobs++}`;
      log.push(`create ${id}`);
      polls.set(id, 0);
      return respond(200, jobBody(id, "queued"));
    }
    const m = /^\/api\/jobs\/(job_\d+)$/.exec(url);
    if (m && method === "DELETE") {
      log.push(`delete ${m[1]}`);
      return respond(200, jobBody(m[1]!, "canceled"));
    }
    if (m) {
      const n = (polls.get(m[1]!) ?? 0) + 1;
      polls.set(m[1]!, n);
      const status = statuses[Math.min(n - 1, statuses.length - 1)]!;
      log.push(`poll ${m[1]} ${status}`);
      return respond(200, jobBody(m[1]!, status));
    }
    if (url.startsWith("/__art/")) {
      log.push(`download ${url.slice(7)}`);
      return respond(200, {});
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { log, fetchImpl };
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

let storageWrites: string[] = [];
beforeEach(() => {
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
  const process = workerProcess(run, resume, {
    fetchImpl: w.fetchImpl,
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
    expect(storageWrites).toEqual([]);
  });

  it("pins concurrency at 1: two jobs polled at once would need more status requests than a minute allows", () => {
    // Why one: a job is polled every `intervalMs`, and every visitor on an
    // address shares one per-minute status allowance.
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
    const w = wire({ limitUploadAt: 1 });
    const units = unitsOf(pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf"));
    const { result } = batch(w, units);
    const before = Date.now();
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("paused"));
    expect(result.current.state.items.map((i) => i.status)).toEqual([
      "done",
      "queued",
      "queued",
    ]);
    // resumeAt is the limit's own Retry-After (1 s), not a guess.
    expect(result.current.resumeAt).toBeGreaterThanOrEqual(before + 1000);
    expect(result.current.resumeAt).toBeLessThan(before + 1000 + 2000);
    const atPause = [...w.log];
    expect(atPause[atPause.length - 1]).toBe("reserve 1");
    // While paused, nothing.
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(w.log).toEqual(atPause);
    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.state.phase).toBe("canceled"));
    expect(w.log).toEqual(atPause);
  });

  it("the adapter throws the typed wait; workerBatchPause turns only a rate limit into a moment", () => {
    const now = Date.now();
    const limited = new BatchItemError("Too many.", "rate_limited", 30);
    const at = workerBatchPause(limited)!;
    expect(at).toBeGreaterThanOrEqual(now + 30_000);
    expect(at).toBeLessThan(now + 31_000);
    // Controls: another code, or a rate limit with no readable wait, is not
    // a pause (no wait to keep).
    expect(
      workerBatchPause(new BatchItemError("x", "internal_error", 30)),
    ).toBeNull();
    expect(
      workerBatchPause(new BatchItemError("x", "rate_limited")),
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
  });
});

describe("refusals before the network, and Cancel", () => {
  it("a file over the tool's ceiling never calls /api/uploads", async () => {
    const w = wire();
    const big = pdf("big.pdf", workerFileCeilingBytes(TOOL) + 1);
    const { result } = batch(w, unitsOf(big, pdf("small.pdf")));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.phase).toBe("done"));
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
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(w.log.filter((l) => l.startsWith("delete"))).toEqual([
      "delete job_0",
    ]);
    expect(w.log.filter((l) => l.startsWith("reserve"))).toEqual(["reserve 0"]);
    expect(result.current.state.items.map((i) => i.status)).toEqual([
      "error",
      "canceled",
    ]);
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
    await act(() => new Promise((r) => setTimeout(r, 50)));
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
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(w.log.filter((l) => l.startsWith("delete"))).toEqual([]);
    expect(w.log.filter((l) => l.startsWith("create"))).toEqual([]);
  });
});

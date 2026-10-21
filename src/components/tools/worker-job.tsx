"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Hourglass, RotateCw, X } from "lucide-react";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { WORKER_JOB_STORAGE_PREFIX } from "@/lib/workers/job-resume-key";
import type { WorkerJobPhase } from "@/lib/workers/job-polling";
import type { PhaseEvent } from "@/lib/workers/phases";
import { ErrorNote, warmEnding } from "./runner/runner-kit";

/**
 * What a worker panel hands its job client: a way to stop, a way to learn the
 * job id as soon as the job exists, and a way to report where the run is.
 */
export interface WorkerJobControls {
  signal: AbortSignal;
  onJobCreated: (jobId: string) => void;
  onPhase: (phase: WorkerJobPhase) => void;
}

/** The failure every job client returns. */
export interface WorkerJobFailure {
  ok: false;
  message: string;
  code?: string;
  jobId?: string;
  stillRunning?: boolean;
}

type Outcome<R> = R | WorkerJobFailure;

export interface WorkerJob<R extends { ok: boolean }> {
  busy: boolean;
  /** Where the run is, or null before it starts reporting. */
  phase: WorkerJobPhase | null;
  /**
   * Every phase the last run reported, in order, with when (`performance.now()`)
   * — what the docket (`LiveStages`) stamps its stages from. Kept after the
   * run ends, so a finished or failed job still shows how far it got.
   */
  events: readonly PhaseEvent[];
  outcome: Outcome<R> | null;
  setOutcome: (outcome: Outcome<R> | null) => void;
  /**
   * Run `work`, which receives the controls to pass to the client. Resolves to
   * the outcome it recorded, or null when the run was canceled or superseded.
   */
  run: (
    work: (controls: WorkerJobControls) => Promise<Outcome<R>>,
  ) => Promise<Outcome<R> | null>;
  /** Keep waiting on the job the last outcome says is still running. */
  resume: () => void;
  /** Stop the run, and cancel its job on the worker when one exists. */
  cancel: () => void;
}

export const LOST_CONNECTION: WorkerJobFailure = {
  ok: false,
  message:
    "Lost the connection before the job finished. Check your network and try again.",
};

export const CANCELED: WorkerJobFailure = {
  ok: false,
  message: "Canceled. The job was stopped and nothing more will be processed.",
};

const STORAGE_PREFIX = WORKER_JOB_STORAGE_PREFIX;

interface Saved {
  jobId: string;
  expiresAt: number;
}

/**
 * The job id only — never the file, the options or a password (Protect and
 * Unlock run through here). sessionStorage, so it is this tab's and ends with
 * it; every access is guarded, since storage can be blocked or throw.
 */
function readSaved(tool: string): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + tool);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<Saved>;
    if (
      typeof saved.jobId !== "string" ||
      !/^job_[A-Za-z0-9_-]+$/.test(saved.jobId) ||
      typeof saved.expiresAt !== "number" ||
      saved.expiresAt <= Date.now()
    ) {
      sessionStorage.removeItem(STORAGE_PREFIX + tool);
      return null;
    }
    return { jobId: saved.jobId, expiresAt: saved.expiresAt };
  } catch {
    return null;
  }
}

function writeSaved(tool: string, jobId: string): void {
  try {
    sessionStorage.setItem(
      STORAGE_PREFIX + tool,
      JSON.stringify({
        jobId,
        // A job's output lives for the retention window after it finishes;
        // past that there is nothing to come back to.
        expiresAt: Date.now() + DEFAULT_RETENTION.outputTtlMinutes * 60_000,
      }),
    );
  } catch {
    // Storage unavailable: resuming after a reload is a convenience.
  }
}

function clearSaved(tool: string): void {
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + tool);
  } catch {
    // As above.
  }
}

/**
 * One job at a time for a worker panel, with the three things the panels
 * lacked:
 *
 * 1. **Keep waiting.** A client that stops polling returns `stillRunning` and
 *    the job id. The panels rendered that as an error with the id folded into
 *    the text, so a job that finished a minute later — already charged to the
 *    AI allowance — could only be reached by uploading again and paying again.
 *    `resume()` polls the SAME job and downloads its result.
 * 2. **Cancel.** Nothing aborted a run and nothing told the worker to stop. The
 *    job's own DELETE route cancels queued or running work.
 * 3. **Honest progress.** `phase` says uploading / waiting / working /
 *    downloading, where one label used to cover all four.
 *
 * The job id is kept in this tab's sessionStorage while a job may still be
 * running, so a reload offers "Keep waiting" instead of forgetting the job.
 */
export function useWorkerJob<R extends { ok: boolean }>(config: {
  /** The tool slug: keys the saved job, and picks the resume's wait. */
  tool: string;
  resume: (jobId: string, controls: WorkerJobControls) => Promise<Outcome<R>>;
}): WorkerJob<R> {
  const { tool } = config;
  const resumeRef = useRef(config.resume);
  useEffect(() => {
    resumeRef.current = config.resume;
  });
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<WorkerJobPhase | null>(null);
  const [events, setEvents] = useState<readonly PhaseEvent[]>([]);
  const [outcome, setOutcome] = useState<Outcome<R> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const jobId = useRef<string | null>(null);
  // A job this tab started and stopped waiting for — before a reload, say —
  // is offered back, not forgotten. Read after mount, NOT in a state
  // initialiser: since WP-10 the run area renders on the server (its drop
  // zone works before the status check answers), and a saved job read
  // during hydration would draw a box the server's HTML does not have.
  useEffect(() => {
    const restored = readSaved(tool);
    if (!restored || controller.current) return;
    jobId.current = restored.jobId;
    setOutcome({
      ok: false,
      message: "A job you started here may still be running on the worker.",
      jobId: restored.jobId,
      stillRunning: true,
    });
  }, [tool]);

  const execute = useCallback(
    async (
      work: (controls: WorkerJobControls) => Promise<Outcome<R>>,
    ): Promise<Outcome<R> | null> => {
      controller.current?.abort();
      const ctl = new AbortController();
      controller.current = ctl;
      setBusy(true);
      setPhase(null);
      setEvents([]);
      setOutcome(null);
      // The result card's receipt and "Continue with" load on demand; asked
      // for now, they are in hand when the job ends minutes later.
      void warmEnding().catch(() => {});
      try {
        let result: Outcome<R>;
        try {
          result = await work({
            signal: ctl.signal,
            onJobCreated: (id) => {
              jobId.current = id;
              writeSaved(tool, id);
            },
            onPhase: (next) => {
              if (ctl.signal.aborted) return;
              setPhase(next);
              const at = performance.now();
              setEvents((prev) => [...prev, { phase: next, at }]);
            },
          });
        } catch {
          // A rejected fetch — offline, DNS, a reset connection — or a file
          // that could not be read. Nothing to inspect; say what happened.
          result = LOST_CONNECTION;
        }
        if (ctl.signal.aborted) {
          // Canceled from here — or superseded by a newer run, which then
          // owns the state and this one leaves it alone.
          if (controller.current === ctl) setOutcome(CANCELED);
          return null;
        }
        const stillRunning =
          result.ok === false &&
          (result as WorkerJobFailure).stillRunning === true;
        if (!stillRunning) {
          jobId.current = null;
          clearSaved(tool);
        }
        if (result.ok === false && !stillRunning) {
          const at = performance.now();
          setEvents((prev) => [...prev, { phase: "failed", at }]);
        }
        setOutcome(result);
        return result;
      } finally {
        // A run that starts always stops: whatever happened above, the busy
        // state this run set is cleared — unless a newer run owns it now.
        if (controller.current === ctl) {
          setBusy(false);
          setPhase(null);
          controller.current = null;
        }
      }
    },
    [tool],
  );

  const run = useCallback<WorkerJob<R>["run"]>(
    (work) => {
      jobId.current = null;
      return execute(work);
    },
    [execute],
  );

  const resume = useCallback(() => {
    const id = jobId.current;
    if (!id) return;
    void execute((controls) => resumeRef.current(id, controls));
  }, [execute]);

  const cancel = useCallback(() => {
    const id = jobId.current;
    const running = controller.current;
    jobId.current = null;
    clearSaved(tool);
    if (id) void fetch(`/api/jobs/${id}`, { method: "DELETE" }).catch(() => {});
    if (running) running.abort();
    else setOutcome(CANCELED);
  }, [tool]);

  return { busy, phase, events, outcome, setOutcome, run, resume, cancel };
}

/** A busy label that says where the run actually is. */
export function jobBusyLabel(
  phase: WorkerJobPhase | null,
  working: string,
): string {
  switch (phase) {
    case "uploading":
      return "Uploading your file…";
    case "queued":
      return "Waiting for the worker…";
    case "downloading":
      return "Downloading the result…";
    default:
      return working;
  }
}

/**
 * Everything a worker panel shows about its job apart from the run button and
 * the result: a Cancel button while it runs, a "still running" note with
 * Keep waiting when the browser stopped waiting, and the error otherwise.
 *
 * `action` is a panel's own next step for a failure it recognises (Translate
 * sends a scan to OCR PDF). It renders inside the error's alert, as
 * {@link ErrorNote} places it, so it is announced with the error.
 */
export function WorkerJobStatus<R extends { ok: boolean }>({
  job,
  action,
}: {
  job: WorkerJob<R>;
  action?: (failure: WorkerJobFailure) => ReactNode;
}) {
  const { busy, outcome } = job;
  if (busy)
    return (
      <button
        type="button"
        onClick={job.cancel}
        className="text-muted hover:text-fg inline-flex items-center gap-1.5 self-start text-sm font-medium underline-offset-4 transition hover:underline"
      >
        <X className="size-3.5" aria-hidden />
        Cancel
      </button>
    );
  if (!outcome || outcome.ok !== false) return null;
  const failure = outcome as WorkerJobFailure;
  if (failure.stillRunning && failure.jobId)
    return (
      <div
        role="status"
        className="border-info/40 bg-info/10 flex flex-col gap-3 rounded-[4px] border px-4 py-3"
      >
        <p className="text-fg flex items-start gap-2 text-sm leading-relaxed">
          <Hourglass className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            The worker is still on this job — the browser stopped waiting, not
            the job. Keep waiting to get the result here: that does not upload
            the file again or start a new job. A finished result stays available
            for {DEFAULT_RETENTION.outputTtlMinutes} minutes.
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={job.resume}
            className="border-line text-fg hover:bg-panel inline-flex items-center gap-1.5 rounded-[3px] border px-3 py-1.5 text-sm font-medium transition"
          >
            <RotateCw className="size-3.5" aria-hidden />
            Keep waiting
          </button>
          <button
            type="button"
            onClick={job.cancel}
            className="text-muted hover:text-fg text-sm font-medium underline-offset-4 transition hover:underline"
          >
            Cancel the job
          </button>
        </div>
      </div>
    );
  return <ErrorNote message={failure.message} action={action?.(failure)} />;
}

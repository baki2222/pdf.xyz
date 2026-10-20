"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { RotateCw } from "lucide-react";
import {
  workerPipelineStages,
  type PipelineStage,
} from "@/lib/jobs/capabilities";
import type { Tool } from "@/lib/tools/types";
import type { WorkerStatus } from "@/lib/workers/status";
import { cn } from "@/lib/utils";
import { outputFile, type OutputFile } from "@/lib/intent/run-output";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
import { LiveStages } from "./live-stages";
import { useWorkerStatus, type WorkerPhase } from "./use-worker-status";
import type { WorkerJob } from "./worker-job";
import {
  WorkerStatusPending,
  WorkerStatusSlot,
  workerSlotState,
} from "./worker-status";

/** What every part of a worker panel reads about the page's one check. */
export interface WorkerPanelState {
  readonly tool: Tool;
  readonly phase: WorkerPhase;
  readonly status: WorkerStatus | null;
  /** The last check was answered with a 429: Try again, after the wait. */
  readonly limited: boolean;
  readonly retry: () => void;
  /** The status is known AND says this panel can run. Only Run waits on it. */
  readonly available: boolean;
  /** This tool's stages, with the scan stage as the live status says. */
  readonly stages: readonly PipelineStage[];
}

const PanelContext = createContext<WorkerPanelState | null>(null);

/** The panel's state, for the run area inside a {@link WorkerPanelShell}. */
export function useWorkerPanel(): WorkerPanelState {
  const state = useContext(PanelContext);
  if (!state) throw new Error("useWorkerPanel outside a WorkerPanelShell");
  return state;
}

export interface SpecRowData {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly value: string;
}

/** The badge: what the check said, in four words or fewer. */
function badgeFor(
  phase: WorkerPhase,
  status: WorkerStatus | null,
  available: boolean,
  readyLabel: string,
): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading")
    return { tone: "info", label: "Checking…", pulse: true };
  if (phase === "error" || !status)
    return { tone: "muted", label: "Status unknown", pulse: false };
  if (!available) return { tone: "muted", label: "Not enabled", pulse: false };
  return status.mode === "local-dev"
    ? { tone: "warn", label: "Local-dev worker", pulse: true }
    : { tone: "ok", label: readyLabel, pulse: false };
}

const PILL: Record<"info" | "accent", string> = {
  info: "border-info/40 bg-info/10 text-info",
  accent: "border-accent/40 bg-accent/10 text-accent",
};

/**
 * Every worker and AI panel's frame (spec C.2, D.7): the engine pill and the
 * live status badge, the panel's `h2` and description, the run area, and the
 * spec rows — with the page's ONE status check (`useWorkerStatus`) and the
 * tool's ONE stage list (`workerPipelineStages`) computed here, for every
 * panel, instead of in thirteen copies.
 *
 * The run area (`children`) renders at once — on the server too — so its
 * drop zone takes a file before the check answers. Only Run waits:
 * {@link WorkerGate} holds it, and the status-dependent box, in the reserved
 * slot. `worker-status-wiring.test.ts` holds every panel to this shell.
 */
export function WorkerPanelShell({
  tool,
  engine,
  tone = "info",
  heading,
  description,
  canRun,
  readyLabel = "Secure worker",
  specRows,
  footer,
  children,
}: {
  tool: Tool;
  engine: { label: string; icon: LucideIcon };
  tone?: "info" | "accent";
  /** The `h2`; "{tool} runs on a secure worker" when not given. */
  heading?: ReactNode;
  description: ReactNode;
  /** Whether a status lets this panel run. Read once the status is known. */
  canRun: (status: WorkerStatus) => boolean;
  /** The ready badge's words ("Secure worker"; OCR says "Available"). */
  readyLabel?: string;
  specRows: readonly SpecRowData[];
  /** A note under the spec rows (Protect's password lifetime, say). */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { phase, status, limited, retry } = useWorkerStatus();
  const available = phase === "ready" && status !== null && canRun(status);
  // `null` until a heartbeat is heard — never `?? false`, which is the
  // under-claim `workerPipelineStages` documents.
  const scanActive = status ? status.scan.active : null;
  const stages = useMemo(
    () => workerPipelineStages(scanActive, tool),
    [scanActive, tool],
  );
  const state = useMemo<WorkerPanelState>(
    () => ({ tool, phase, status, limited, retry, available, stages }),
    [tool, phase, status, limited, retry, available, stages],
  );
  const badge = badgeFor(phase, status, available, readyLabel);
  const Icon = engine.icon;

  return (
    <PanelContext.Provider value={state}>
      <div className="border-line bg-panel flex flex-col gap-6 rounded-[4px] border p-5 sm:p-7">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                PILL[tone],
              )}
            >
              <Icon className="size-3" aria-hidden />
              {engine.label}
            </span>
            <StatusBadge
              tone={badge.tone}
              label={badge.label}
              pulse={badge.pulse}
            />
          </div>
          <h2 className="text-fg text-lg font-semibold">
            {heading ?? `${tool.name} runs on a secure worker`}
          </h2>
          <div className="text-muted text-sm leading-relaxed">
            {description}
          </div>
        </div>

        {children}

        <div className="bg-panel border-line divide-line divide-y rounded-[4px] border px-4 py-1">
          {specRows.map((row) => (
            <SpecRow key={row.label} {...row} />
          ))}
        </div>
        {footer}
      </div>
    </PanelContext.Provider>
  );
}

function SpecRow({ icon: Icon, label, value }: SpecRowData) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-muted inline-flex items-center gap-2 text-sm">
        <Icon className="text-muted size-4" aria-hidden />
        {label}
      </span>
      <span className="text-fg text-right text-sm font-medium">{value}</span>
    </div>
  );
}

/**
 * The status-dependent part of a run area, as ONE reserved box
 * ({@link WorkerStatusSlot}): the Run control and the job's own status, the
 * docket, and last — the only part whose height depends on the check — what
 * the check said: "Checking the secure worker…", a failed check's retry, the
 * not-enabled reason with Try again and Notify me, or, ready, the panel's
 * note on what pressing Run sends.
 *
 * Run is drawn in every state and is live only when the status is ready and
 * the panel says it has what it needs (`blocked`); everything above the
 * slot — the drop zone, the options — works from the first paint. Because
 * the varying box comes LAST, nothing in the slot moves when the answer
 * arrives: the run button and the docket keep their places.
 */
export function WorkerGate({
  reserve,
  job,
  run,
  off,
  note,
  bytes,
  jobStatus,
}: {
  /** The slot's min-heights, per breakpoint (see `STATUS_SLOT` in each panel). */
  reserve: string;
  /** The run whose phases stamp the docket. */
  job: Pick<WorkerJob<{ ok: boolean }>, "events">;
  /** The Run control: `(available) => <WorkerRunButton disabled={!available || …}>`. */
  run: (available: boolean) => ReactNode;
  /** Why this panel cannot run, once the check says so (the box's reason and Notify me). */
  off: ReactNode;
  /** Ready: what pressing Run sends, and where. */
  note?: ReactNode;
  /** The chosen file's size, for the upload row. */
  bytes?: number;
  /** Cancel, Keep waiting, and the error — under Run, where the eye is. */
  jobStatus?: ReactNode;
}) {
  const { phase, available, stages, retry, limited } = useWorkerPanel();
  const state = workerSlotState(phase, available);
  return (
    <WorkerStatusSlot state={state} reserve={reserve}>
      <div className="flex flex-col gap-4">
        {run(available)}
        {jobStatus}
        <LiveStages stages={stages} events={job.events} bytes={bytes} />
        {available ? (
          note
        ) : phase === "ready" ? (
          <div className="border-warn/40 bg-warn/10 flex flex-col gap-3 rounded-[4px] border p-4">
            {off}
            <p className="text-muted text-xs leading-relaxed">
              Nothing is uploaded while the worker is unavailable. A file you
              add stays here, and Run turns on once the worker is ready.
            </p>
            <TryAgain onRetry={retry} />
          </div>
        ) : (
          <WorkerStatusPending
            phase={phase}
            onRetry={retry}
            limited={limited}
          />
        )}
      </div>
    </WorkerStatusSlot>
  );
}

function TryAgain({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="border-line text-fg hover:bg-panel inline-flex items-center gap-1.5 self-start rounded-[3px] border px-3 py-1.5 text-sm font-medium transition"
    >
      <RotateCw className="size-3.5" aria-hidden />
      Try again
    </button>
  );
}

/**
 * A worker result as the result card's receipt and "Continue with" read it:
 * the downloaded bytes, saved under the artifact's own name and type.
 */
export function workerOutput(
  output: Uint8Array,
  artifact: { filename: string; contentType: string },
): OutputFile {
  return outputFile(output, artifact.filename, artifact.contentType);
}

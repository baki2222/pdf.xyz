"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Info, PauseCircle, Play, X } from "lucide-react";
import { BatchSkip, withNote, type NotedResult } from "@/lib/batch";
import {
  BATCH_LIMITS,
  capBatchFiles,
  type BatchRejection,
} from "@/lib/batch/limits";
import {
  WORKER_BATCH_TOOLS,
  isWorkerBatchSlug,
  type WorkerBatchSlug,
} from "@/lib/batch/tools";
import {
  WORKER_BATCH_PAUSED,
  workerBatchJobsSentence,
  workerBatchUploadSentence,
} from "@/lib/batch/worker-copy";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import type { Tool } from "@/lib/tools/types";
import { pickRefusal } from "@/lib/uploads/pick-check";
import {
  resumeSecurityJob,
  type PdfSecurityWorkerSuccess,
} from "@/lib/workers/pdf-security-client";
import type { WorkerJobPhase } from "@/lib/workers/job-polling";
import { describeWait } from "@/lib/workers/read-error";
import { formatBytes } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { jobBusyLabel } from "../../worker-job";
import { useWorkerPanel } from "../../worker-panel-shell";
import { useBatchRunner, type BatchUnit } from "../use-batch-runner";
import { useUnsavedGuard } from "../use-unsaved-guard";
import { BatchView } from "./batch-view";
import {
  workerBatchPause,
  workerProcess,
  type WorkerRun,
} from "./worker-batch";

/** A finished row: the job's output as a Blob, and what the receipt reads. */
export interface WorkerBatchRow {
  name: string;
  blob: Blob;
  inputBytes: number;
}

export interface WorkerBatchRunnerProps {
  /** The catalogue tool whose page this is. */
  tool: Tool;
  files: File[];
  onReset: () => void;
  /** A Remove left one file: it goes back to the panel's single-file flow. */
  onSingle?: (file: File) => void;
  /** One file's job, through the tool's own client, with the panel's options. */
  run: WorkerRun;
  /** The panel's own options, shown above the list before Run. */
  settings?: ReactNode;
  /** Why Run cannot be pressed for a reason of the panel's own. */
  runBlocked?: string | null;
}

/**
 * The tools whose single-file panel asks before it rewrites a signed PDF,
 * and what the rewrite is called. In a batch a signed file is left out,
 * never uploaded, with a reason that sends it to the panel that asks.
 */
const SIGNED_REWRITE: Partial<Record<WorkerBatchSlug, string>> = {
  "optimize-web": "Optimizing",
  "pdf-to-pdfa": "Converting to PDF/A",
};

/**
 * What qpdf worked around, on a finished row of the two qpdf tools — the
 * single-file panel's `RepairWarnings`, as a sentence on the row: a repair
 * that hands back a file and says nothing has said the least useful thing.
 */
export function qpdfRowNote(
  slug: string,
  result: PdfSecurityWorkerSuccess,
): string | undefined {
  if (slug !== "repair-pdf" && slug !== "optimize-web") return undefined;
  const repair = result.job.results?.repair;
  if (!repair?.recoveredWithWarnings) return undefined;
  const lead =
    slug === "repair-pdf"
      ? "This PDF was damaged and has been rebuilt."
      : "qpdf found problems in this PDF's structure and worked around them.";
  const found =
    repair.warnings.length > 0
      ? `qpdf reported: ${repair.warnings.join("; ")}.`
      : "The details could not be shown safely.";
  return `${lead} ${found} Check those parts against your original.`;
}

/** The row a signed file gets when the batch leaves it alone. */
export function signedSkipReason(count: number, verb: string): string {
  const noun = count === 1 ? "digital signature" : "digital signatures";
  return `This PDF has ${count} ${noun}. ${verb} rewrites the whole file, so ${count === 1 ? "it" : "they"} would show as invalid; the batch left it alone, unsent. Open it on its own to confirm and run it.`;
}

const rowOutputs = (row: WorkerBatchRow) => [
  { name: row.name, blob: row.blob },
];

/**
 * The batch for a worker tool (batch plan P3): each file is one of today's
 * single jobs on our secure server, strictly one after another — the next
 * file is read and uploaded only once the job before it has ended
 * (`./worker-batch`). A rate limit pauses the batch instead of failing the
 * file, and it carries on by itself when the limit lifts, while the page
 * is open; leaving the page while it runs asks first.
 *
 * Run waits on the panel's own check (`useWorkerPanel().available`), as the
 * single-file Run does. The list is drawn here, in place of the panel's
 * picker and its reserved status slot, so the slot's heights are untouched.
 */
export function WorkerBatchRunner({
  tool,
  files,
  onReset,
  onSingle,
  run,
  settings,
  runBlocked = null,
}: WorkerBatchRunnerProps) {
  // A page that mounts this for a tool with no registration is a bug in
  // the page, said loudly (below, after every hook).
  const slug = tool.slug as WorkerBatchSlug;
  const registered = isWorkerBatchSlug(tool.slug);
  const { zipName, verb, noun } = registered
    ? WORKER_BATCH_TOOLS[slug]
    : WORKER_BATCH_TOOLS["optimize-web"];
  const { available, phase: checkPhase } = useWorkerPanel();

  const { accepted, rejected } = useMemo(() => {
    const taken: File[] = [];
    const refused: BatchRejection<File>[] = [];
    for (const file of files) {
      const why = pickRefusal(tool, file);
      if (why === null) taken.push(file);
      else refused.push({ file, reason: why });
    }
    const capped = capBatchFiles(taken, {
      maxFiles: BATCH_LIMITS.workerMaxFiles,
      maxTotalBytes: BATCH_LIMITS.clientMaxTotalBytes,
    });
    return {
      accepted: capped.accepted,
      rejected: [...refused, ...capped.rejected],
    };
  }, [files, tool]);
  const units = useMemo<BatchUnit[]>(
    () =>
      accepted.map((file, i) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${i}`,
        name: file.name,
        file,
      })),
    [accepted],
  );

  // Where the file in flight is: one at a time, so one phase.
  const [jobPhase, setJobPhase] = useState<WorkerJobPhase | null>(null);
  const signedVerb = SIGNED_REWRITE[slug];
  const process = useMemo(() => {
    const one = workerProcess(
      run,
      (jobId, controls) =>
        resumeSecurityJob(jobId, { ...controls, tool: slug }),
      {
        onPhase: setJobPhase,
        ...(signedVerb
          ? {
              preflight: (_file: File, bytes: Uint8Array) => {
                const count = countDigitalSignatures(bytes);
                if (count > 0)
                  throw new BatchSkip(signedSkipReason(count, signedVerb));
              },
            }
          : {}),
      },
    );
    return async (
      file: File,
      signal: AbortSignal,
    ): Promise<WorkerBatchRow | NotedResult<WorkerBatchRow>> => {
      setJobPhase(null);
      const result = await one(file, signal);
      const row: WorkerBatchRow = {
        name: result.artifact.filename,
        blob: new Blob([result.output as BlobPart], {
          type: result.artifact.contentType,
        }),
        inputBytes: file.size,
      };
      const note = qpdfRowNote(slug, result);
      return note ? withNote(row, note) : row;
    };
  }, [run, slug, signedVerb]);

  const runner = useBatchRunner<WorkerBatchRow>(units, process, {
    // Every job already reports its own outcome (`withToolOutcome`).
    reportsOutcome: false,
    pauseOn: workerBatchPause,
  });
  const count = runner.state.items.length;
  const paused = runner.state.phase === "paused";
  useUnsavedGuard(runner.running || paused, "your batch");

  const label = (n: number) => `${n} ${noun[n === 1 ? 0 : 1]}`;
  const blocked =
    runBlocked ??
    (available
      ? null
      : checkPhase === "loading"
        ? "Checking our secure server…"
        : "Our secure server is not available right now, so nothing can be sent.");

  if (!registered) throw new Error(`${tool.slug} has no worker batch`);

  const banner = (
    <div className="bg-panel border-line rounded-panel flex items-start gap-2.5 border p-4">
      <Info className="text-accent mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="text-muted text-sm leading-relaxed">
        <span className="text-fg">{tool.name}</span> runs each file in turn on
        our secure server. {workerBatchUploadSentence()}{" "}
        {workerBatchJobsSentence(count)}
      </p>
    </div>
  );

  return (
    <BatchView<WorkerBatchRow>
      runner={runner}
      arrivedCount={files.length}
      rejected={rejected}
      banner={banner}
      settings={
        settings ? (
          <fieldset className="flex flex-col gap-4">
            <legend className="text-muted mb-1 text-[11px] font-medium tracking-wide uppercase">
              Applied to all {label(count)}
            </legend>
            {settings}
          </fieldset>
        ) : undefined
      }
      runBlocked={blocked}
      countLabel={label}
      runLabel={(n) => `${verb} ${label(n)}`}
      runningLabel={jobBusyLabel(jobPhase, "Working on our secure server…")}
      errorFallback={`Couldn’t ${verb.toLowerCase()} this file`}
      progressLabel={`${tool.name} batch progress`}
      footnote="Files go to our server one at a time; keep this page open until the batch ends."
      outputs={rowOutputs}
      describe={(row) => `${row.name} · ${formatBytes(row.blob.size)}`}
      downloadLabel={(_item, row) => `Download ${row.name}`}
      doneSentence={(p) =>
        `Batch complete. ${p.done} done, ${p.error} failed${p.skipped > 0 ? `, ${p.skipped} skipped` : ""}.`
      }
      inputBytes={(row) => row.inputBytes}
      zipName={zipName}
      zipFallback="If it keeps failing, download the files one at a time above."
      paused={
        runner.resumeAt !== null ? (
          <PausedBanner
            resumeAt={runner.resumeAt}
            onContinue={runner.continueNow}
            onCancel={runner.cancel}
          />
        ) : null
      }
      onReset={onReset}
      {...(onSingle
        ? {
            onOneLeft: (id: string) => {
              const unit = units.find((u) => u.id === id);
              if (unit) onSingle(unit.file);
            },
          }
        : {})}
    />
  );
}

const CONTROL = "min-h-11 sm:min-h-0";

/**
 * A rate limit paused the batch: what happened, when it carries on, and
 * the two things to do. The first sentence is spoken once, as the pause
 * begins; the countdown under it is not a live region, or a screen reader
 * would read it every second.
 */
function PausedBanner({
  resumeAt,
  onContinue,
  onCancel,
}: {
  resumeAt: number;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((resumeAt - now) / 1000));
  const ready = left === 0;
  return (
    <div
      data-batch-paused
      className="border-warn/40 bg-warn/10 text-warn rounded-panel flex flex-col gap-3 border px-4 py-3 text-sm"
    >
      <p role="status" className="flex items-start gap-2 font-medium">
        <PauseCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {WORKER_BATCH_PAUSED}
      </p>
      <p className="text-fg text-sm leading-relaxed">
        {ready
          ? "Continuing now."
          : `Continuing in ${describeWait(left)}, as long as this page stays open.`}{" "}
        The finished files can be downloaded from their rows now.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-disabled={ready ? undefined : true}
          onClick={() => {
            if (ready) onContinue();
          }}
          className={buttonVariants({
            variant: "primary",
            size: "sm",
            className: CONTROL,
          })}
        >
          <Play className="size-4" aria-hidden />
          Continue now
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={buttonVariants({
            variant: "outline",
            size: "sm",
            className: CONTROL,
          })}
        >
          <X className="size-4" aria-hidden />
          Cancel
        </button>
      </div>
    </div>
  );
}

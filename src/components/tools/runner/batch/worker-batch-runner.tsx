"use client";

import { usePickRefusal } from "@/components/tools/use-pick";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Info, PauseCircle, Play, X } from "lucide-react";
import { BatchSkip, withNote, type NotedResult } from "@/lib/batch";
import {
  BATCH_LIMITS,
  capBatchFiles,
  type BatchRejection,
} from "@/lib/batch/limits";
import {
  WORKER_BATCH_TOOLS,
  batchMaxFilesFor,
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
import {
  resumeSecurityJob,
  type PdfSecurityWorkerSuccess,
} from "@/lib/workers/pdf-security-client";
import type { WorkerJobPhase } from "@/lib/workers/job-polling";
import { describeWait } from "@/lib/workers/read-error";
import { formatBytes } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { announceOutcome } from "@/components/a11y/live-region";
import { jobBusyLabel } from "../../worker-job";
import { useWorkerPanel } from "../../worker-panel-shell";
import { useBatchRunner, type BatchUnit } from "../use-batch-runner";
import { useUnsavedGuard } from "../use-unsaved-guard";
import { BatchView } from "./batch-view";
import {
  workerBatchPause,
  workerOutcomeReporter,
  workerProcess,
  type WorkerBatchSuccess,
  type WorkerResume,
  type WorkerRun,
} from "./worker-batch";

/** A finished row: the job's output as a Blob, and what the receipt reads. */
export interface WorkerBatchRow {
  name: string;
  blob: Blob;
  inputBytes: number;
  /** The input's own name: a row's folder when rows are bundled. */
  input: string;
  /** Any further outputs of the same job (OCR PDF's "PDF + text"). */
  more?: { name: string; blob: Blob }[];
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
  /**
   * The panel's own look at a file's bytes before it is uploaded (batch
   * plan P4: Unlock leaves out a PDF that is not locked, Protect one that
   * is already encrypted): throw or reject with a `BatchSkip`.
   */
  preflight?: (file: File, bytes: Uint8Array) => void | Promise<void>;
  /** Run was pressed: the panel freezes what `run` will send. */
  onRun?: () => void;
  /**
   * The batch ended (done or canceled), or "Run again" put it back before
   * Run: whatever the panel froze for it is no longer needed.
   */
  onEnd?: () => void;
  /** In place of "Retry failed": the panel's own retry form (`BatchView`). */
  retry?: (failed: number, retry: () => void) => ReactNode;
  /**
   * Wait again for a job by its id, through the tool's own client (batch
   * plan P5: OCR PDF's `resumeWorkerOcr`). The security client's resume,
   * for this tool, when absent.
   */
  resume?: WorkerResume;
  /** A sentence of the tool's own about a finished file, on its row. */
  rowNote?: (result: WorkerBatchSuccess) => string | undefined;
  /**
   * Each job makes several files (OCR PDF's "PDF + text"): every row's
   * files sit in a folder of "Download all" named after its input, and a
   * row downloads its own as one ZIP.
   */
  bundleRows?: boolean;
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
  ...(row.more ?? []),
];

/** An input's name without its extension: a bundled row's folder. */
const stem = (name: string) => name.replace(/\.[^./]+$/, "") || name;

const rowBundle = (row: WorkerBatchRow) => ({
  folder: stem(row.input),
  zipName: `${stem(row.input)}.zip`,
});

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
  preflight,
  onRun,
  onEnd,
  retry,
  resume,
  rowNote,
  bundleRows = false,
}: WorkerBatchRunnerProps) {
  const pickRefuse = usePickRefusal(tool);
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
      const why = pickRefuse(file);
      if (why === null) taken.push(file);
      else refused.push({ file, reason: why });
    }
    const capped = capBatchFiles(taken, {
      // OCR PDF's batch takes fewer (`BATCH_LIMITS.ocrMaxFiles`).
      maxFiles: batchMaxFilesFor(tool.slug),
      maxTotalBytes: BATCH_LIMITS.clientMaxTotalBytes,
    });
    return {
      accepted: capped.accepted,
      rejected: [...refused, ...capped.rejected],
    };
  }, [files, tool, pickRefuse]);
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
  // Finished jobs whose download was refused, kept across runs of this
  // batch so "Retry failed" fetches the result instead of a new job.
  const [finished] = useState(() => new WeakMap<File, string>());
  const process = useMemo(() => {
    const one = workerProcess(
      run,
      resume ??
        ((jobId, controls) =>
          resumeSecurityJob(jobId, { ...controls, tool: slug })),
      {
        onPhase: setJobPhase,
        finished,
        report: workerOutcomeReporter(slug),
        ...(signedVerb || preflight
          ? {
              preflight: async (file: File, bytes: Uint8Array) => {
                if (signedVerb) {
                  const count = countDigitalSignatures(bytes);
                  if (count > 0)
                    throw new BatchSkip(signedSkipReason(count, signedVerb));
                }
                await preflight?.(file, bytes);
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
        input: file.name,
        ...(result.more && result.more.length > 0
          ? {
              more: result.more.map(({ artifact, output }) => ({
                name: artifact.filename,
                blob: new Blob([output as BlobPart], {
                  type: artifact.contentType,
                }),
              })),
            }
          : {}),
      };
      const note = qpdfRowNote(slug, result) ?? rowNote?.(result);
      return note ? withNote(row, note) : row;
    };
  }, [run, resume, rowNote, slug, signedVerb, finished, preflight]);

  const runner = useBatchRunner<WorkerBatchRow>(units, process, {
    // One outcome per FILE is reported by the adapter (`report` above): a
    // file can take several attempts, and the driver sees only the last.
    reportsOutcome: false,
    pauseOn: workerBatchPause,
  });
  const count = runner.state.items.length;
  const paused = runner.state.phase === "paused";
  useUnsavedGuard(runner.running || paused, "your batch");

  // The batch's end, as the panel needs to hear it: once, when the phase
  // reaches done or canceled (a pause is not an end — the paused file runs
  // again with what was frozen).
  const phase = runner.state.phase;
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);
  useEffect(() => {
    if (phase === "done" || phase === "canceled") onEndRef.current?.();
  }, [phase]);
  const { start, reset } = runner;
  const driven = useMemo(
    () => ({
      ...runner,
      start: () => {
        onRun?.();
        start();
      },
      reset: () => {
        reset();
        onEndRef.current?.();
      },
    }),
    [runner, start, reset, onRun],
  );

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
      runner={driven}
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
      describe={(row) =>
        rowOutputs(row)
          .map((out) => `${out.name} · ${formatBytes(out.blob.size)}`)
          .join(", ")
      }
      downloadLabel={(_item, row) =>
        row.more?.length
          ? `Download ${rowBundle(row).zipName}`
          : `Download ${row.name}`
      }
      {...(bundleRows ? { bundle: rowBundle } : {})}
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
            done={runner.progress.done}
            onContinue={runner.continueNow}
            onCancel={runner.cancel}
          />
        ) : null
      }
      {...(retry ? { retry } : {})}
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
 * the two things to do.
 *
 * The batch's own Cancel goes away as the pause begins, and focus with it,
 * so focus moves to Continue now, which the sentences describe. When focus
 * is somewhere else on the page it is left there, and the first sentence
 * is spoken through the app's live region instead — a region drawn
 * together with its words is not announced by several screen readers. The
 * countdown is not a live region either, or it would be read every second.
 */
function PausedBanner({
  resumeAt,
  done,
  onContinue,
  onCancel,
}: {
  resumeAt: number;
  /** Files already finished: only then can any be downloaded. */
  done: number;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const continueRef = useRef<HTMLButtonElement>(null);
  const headId = useId();
  const waitId = useId();
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body)
      continueRef.current?.focus({ preventScroll: true });
    else announceOutcome(WORKER_BATCH_PAUSED);
  }, []);
  const left = Math.max(0, Math.ceil((resumeAt - now) / 1000));
  const ready = left === 0;
  return (
    <div
      data-batch-paused
      className="border-warn/40 bg-warn/10 text-warn rounded-panel flex flex-col gap-3 border px-4 py-3 text-sm"
    >
      <p id={headId} className="flex items-start gap-2 font-medium">
        <PauseCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {WORKER_BATCH_PAUSED}
      </p>
      <p id={waitId} className="text-fg text-sm leading-relaxed">
        {ready
          ? "Continuing now."
          : `Continuing in ${describeWait(left)}, as long as this page stays open.`}
        {done > 0
          ? " The finished files can be downloaded from their rows now."
          : null}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          ref={continueRef}
          type="button"
          aria-disabled={ready ? undefined : true}
          aria-describedby={`${headId} ${waitId}`}
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

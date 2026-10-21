"use client";

import { useCallback, useState } from "react";
import {
  FileDown,
  FileUp,
  ShieldCheck,
  Timer,
  Wrench,
  Zap,
} from "lucide-react";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import {
  canRunPdfStructure,
  runWorkerOptimizeWeb,
  runWorkerRepairPdf,
  type PdfStructureWorkerResult,
} from "@/lib/workers/pdf-structure-client";
import { downloadBytes } from "@/lib/pdf/browser";
import type { Tool } from "@/lib/tools/types";
import { pickRefusal, type PickRefusal } from "@/lib/uploads/pick-check";
import { formatBytes } from "@/lib/utils";
import {
  DownloadCta,
  Dropzone,
  ResultCard,
  WorkerRunButton,
} from "./runner/runner-kit";
import { ChosenFileTarget } from "./chosen-file-target";
import { NotifyMe } from "./notify-me";
import { jobBusyLabel, useWorkerJob, WorkerJobStatus } from "./worker-job";
import { resumeSecurityJob } from "@/lib/workers/pdf-security-client";
import { useStagedHandoff } from "./use-staged-handoff";
import {
  useWorkerPanel,
  WorkerGate,
  WorkerPanelShell,
  workerOutput,
} from "./worker-panel-shell";
import { RepairOutcome, repairDoneSentence } from "./repair-warnings";
import { OptimizeOutcome, optimizeDoneSentence } from "./optimize-outcome";
import { OfficeExportNextStep } from "./office-export-notices";

/**
 * The status slot's reserved height (see `WorkerStatusSlot` and
 * `WorkerGate`): the tallest state it shows — checking, a failed check,
 * not enabled, ready — at the narrowest width of each breakpoint.
 *
 * Refitted 2026-10-21 (WP-10), when the slot came to hold Run, the docket
 * and what the check said, the drop zone having moved out of it: the
 * tallest state, the larger of Windows and Linux (CI's SLOT_NATURAL lines
 * on 507b6383), is 638px at 360, 439.5px at 640, 491.8px at 1024;
 * x1.035, to the half rem, then up to a value another panel's slot already
 * uses, so the thirteen share a handful of classes. A first fit from
 * Windows alone (x1.06) left PowerPoint to PDF and PDF to PowerPoint
 * short on Linux at 360. The check: `e2e/tool-layout.mobile.spec.ts`.
 */
const STATUS_SLOT = "min-h-[43rem] sm:min-h-[29.5rem] lg:min-h-[33rem]";

type Mode = "repair" | "optimize";

const COPY: Record<
  Mode,
  {
    icon: typeof Wrench;
    badge: string;
    blurb: string;
    cta: string;
    running: string;
  }
> = {
  repair: {
    icon: Wrench,
    badge: "Secure-worker repair",
    blurb:
      "Repair rewrites the PDF through qpdf's parser/writer on an isolated secure worker, recovering readable structure when possible. It never fabricates pages or content: if qpdf cannot produce a valid PDF, the job fails honestly.",
    cta: "Repair on the worker",
    running: "Repairing on the worker…",
  },
  optimize: {
    icon: Zap,
    badge: "Fast-web optimization",
    blurb:
      "Optimize PDF for Web linearizes the PDF with qpdf so browsers can start rendering before the whole file downloads. The worker produces a real fast-web-view PDF or fails honestly.",
    cta: "Optimize on the worker",
    running: "Optimizing on the worker…",
  },
};

export function PdfStructureWorkerPanel({ tool }: { tool: Tool }) {
  const mode: Mode = tool.slug === "repair-pdf" ? "repair" : "optimize";
  const copy = COPY[mode];
  return (
    <WorkerPanelShell
      tool={tool}
      engine={{ label: copy.badge, icon: copy.icon }}
      description={copy.blurb}
      canRun={canRunPdfStructure}
      specRows={[
        { icon: FileUp, label: "Input", value: "One PDF" },
        { icon: FileDown, label: "Output", value: "PDF" },
        {
          icon: Timer,
          label: "Retention",
          value: `Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`,
        },
        {
          icon: ShieldCheck,
          label: "Limit",
          value: `${formatBytes(JOB_LIMITS.maxFileBytes)}/file`,
        },
      ]}
    >
      <StructureRunArea
        mode={mode}
        tool={tool}
        refuse={(file) => pickRefusal(tool, file)}
      />
    </WorkerPanelShell>
  );
}

function StructureRunArea({
  mode,
  tool,
  refuse,
}: {
  mode: Mode;
  tool: Tool;
  refuse: PickRefusal;
}) {
  const { available, status } = useWorkerPanel();
  const [file, setFile] = useState<File | null>(null);
  // The size of the file the CURRENT outcome came from — recorded when the run
  // starts, so a job resumed after a reload (no file in hand) reports none
  // rather than 0, and a file picked afterwards is never compared with it.
  const [ranBytes, setRanBytes] = useState<number | undefined>(undefined);
  const job = useWorkerJob<PdfStructureWorkerResult>({
    tool: mode === "repair" ? "repair-pdf" : "optimize-web",
    resume: (id, controls) =>
      resumeSecurityJob(id, {
        ...controls,
        tool: mode === "repair" ? "repair-pdf" : "optimize-web",
      }),
  });
  const { busy, outcome, setOutcome, run } = job;
  const copy = COPY[mode];
  const staged = useStagedHandoff(tool.slug, copy.cta, (files) => {
    setOutcome(null);
    setRanBytes(undefined);
    setFile(files[0] ?? null);
  });

  const start = useCallback(async () => {
    if (!file || !available) return;
    setRanBytes(file.size);
    await run(async (controls) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result =
        mode === "repair"
          ? await runWorkerRepairPdf({ filename: file.name, bytes }, controls)
          : await runWorkerOptimizeWeb(
              { filename: file.name, bytes },
              controls,
            );
      return result;
    });
  }, [file, mode, run, available]);

  const detail =
    status?.security.detail ??
    "This qpdf-backed worker path is not enabled here.";

  return (
    <div className="flex flex-col gap-4">
      {staged}
      {file ? (
        <ChosenFileTarget
          file={file}
          accept="application/pdf"
          busy={busy}
          refuse={refuse}
          onReplace={(files) => {
            setOutcome(null);
            setRanBytes(undefined);
            setFile(files[0] ?? null);
          }}
        >
          <div className="border-line bg-wash text-fg rounded-ctl flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-sm">
            <span className="truncate">{file.name}</span>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setOutcome(null);
                setRanBytes(undefined);
              }}
              className="text-muted hover:text-fg shrink-0 text-xs font-medium transition"
            >
              Remove
            </button>
          </div>
        </ChosenFileTarget>
      ) : (
        <Dropzone
          pageTarget
          refuse={refuse}
          onFiles={(files) => setFile(files[0] ?? null)}
          accept="application/pdf"
          multiple={false}
          compact
          title="Add a PDF, or"
          hint="PDF"
        />
      )}

      <WorkerGate
        reserve={STATUS_SLOT}
        job={job}
        bytes={file?.size}
        run={(ready) => (
          <WorkerRunButton
            onClick={start}
            busy={busy}
            disabled={!ready || !file}
            busyLabel={jobBusyLabel(job.phase, copy.running)}
            icon={copy.icon}
          >
            {copy.cta}
          </WorkerRunButton>
        )}
        jobStatus={
          <>
            <WorkerJobStatus job={job} />
            {outcome?.ok === false && !outcome.stillRunning && (
              <OfficeExportNextStep
                code={outcome.code}
                from={mode === "repair" ? "repair-pdf" : "optimize-web"}
                message={outcome.message}
              />
            )}
          </>
        }
        note={
          <p className="text-info flex items-start gap-1.5 text-xs leading-relaxed">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {status?.localDevOnly
              ? `This runs on your local-dev worker on this machine when you press ${copy.cta}.`
              : `Pressing ${copy.cta} uploads your file to the secure worker, processes it with qpdf, and wipes the input after processing.`}
          </p>
        }
        off={
          <>
            <p className="text-muted text-sm leading-relaxed">{detail}</p>
            <p className="text-muted text-xs leading-relaxed">
              {copy.cta} stays off until the worker is ready, so {tool.name}{" "}
              never pretends to process a file it cannot actually run.
            </p>
            <NotifyMe
              toolName={tool.name}
              toolSlug={tool.slug}
              checking={false}
            />
          </>
        }
      />
      {outcome?.ok === true && (
        <ResultCard
          announce={
            mode === "repair"
              ? repairDoneSentence(outcome.job)
              : optimizeDoneSentence(outcome.output)
          }
          output={workerOutput(outcome.output, outcome.artifact)}
          inputBytes={ranBytes}
        >
          {/* Before the download button: a user who clicks and leaves is
              exactly the user this is for. */}
          {mode === "repair" ? (
            <RepairOutcome job={outcome.job} />
          ) : (
            <OptimizeOutcome
              job={outcome.job}
              inputBytes={ranBytes}
              output={outcome.output}
            />
          )}
          <DownloadCta
            onClick={() =>
              downloadBytes(outcome.output, outcome.artifact.filename)
            }
          >
            Download {outcome.artifact.filename}
          </DownloadCta>
        </ResultCard>
      )}
    </div>
  );
}

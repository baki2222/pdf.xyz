"use client";

import { useCallback, useEffect, useId, useState } from "react";
import dynamic from "next/dynamic";
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
import {
  AlreadyLinearizedNote,
  inspectWebInput,
  WebSignatureWarning,
  type WebInputFacts,
} from "./web-input-notices";

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
 *
 * Refitted 2026-10-23, when the stage list stopped being drawn before a
 * job (one "What happens to your file" press stands in for it): the
 * tallest state is now not-enabled, off 618.5/638px at 360 (Windows/Linux;
 * Linux from CI's SLOT_NATURAL lines on 0504da27, a state this change
 * did not touch), x1.035 to the half rem, then up to a value another
 * panel already uses.
 *
 * Refitted 2026-10-24, when the not-enabled box became one sentence,
 * Why?, Try again and Notify me (the reason one press away): the
 * tallest state, Windows / Linux (CI's SLOT_NATURAL lines on
 * 28af68e1), is 338/357.5px at 360-390, 225.5/225.5px at 640,
 * 230.5/230.5px at 1024; the larger x1.035, to the half rem.
 */
const STATUS_SLOT = "min-h-[23.5rem] sm:min-h-[15rem] lg:min-h-[15rem]";

/**
 * Two or more PDFs: the worker batch (batch plan P3), its own chunk,
 * fetched only when they arrive.
 */
const WorkerBatch = dynamic(
  () =>
    import("./runner/batch/worker-batch-runner").then(
      (m) => m.WorkerBatchRunner,
    ),
  {
    loading: () => (
      <div
        aria-hidden
        className="border-line bg-wash rounded-panel h-40 w-full border"
      />
    ),
  },
);

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
    badge: "Structure repair",
    blurb:
      "Repair rewrites the PDF through qpdf's parser/writer on an isolated secure server, recovering readable structure when possible. It never fabricates pages or content: if qpdf cannot produce a valid PDF, the job fails honestly.",
    cta: "Repair on our secure server",
    running: "Repairing on our secure server…",
  },
  optimize: {
    icon: Zap,
    badge: "Fast-web optimization",
    blurb:
      "Optimize PDF for Web linearizes the PDF with qpdf so browsers can start rendering before the whole file downloads. Our server produces a real fast-web-view PDF or fails honestly.",
    cta: "Optimize on our secure server",
    running: "Optimizing on our secure server…",
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
        { icon: FileUp, label: "You add", value: "One or more PDFs" },
        { icon: FileDown, label: "You get", value: "PDF" },
        {
          icon: Timer,
          label: "Your files",
          value: `Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`,
        },
        {
          icon: ShieldCheck,
          label: "Largest file",
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
  const [batch, setBatch] = useState<File[] | null>(null);
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
  // Optimize for Web only: what the picked file already is, read in the
  // browser before any upload (audit optimize-web#2). Keyed by the file, so
  // facts and a confirmation given for one file never carry to the next.
  const [facts, setFacts] = useState<WebInputFacts | null>(null);
  const [confirmedFor, setConfirmedFor] = useState<File | null>(null);
  useEffect(() => {
    if (mode !== "optimize" || !file) return;
    let live = true;
    file
      .arrayBuffer()
      .then((buf) => {
        if (live) setFacts(inspectWebInput(file, new Uint8Array(buf)));
      })
      // An unreadable file is the upload's problem to report, not this note's.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [file, mode]);
  const current = facts?.file === file ? facts : null;
  const signatureWarningId = useId();
  const signaturesConfirmed = confirmedFor !== null && confirmedFor === file;
  const heldBySignatures =
    (current?.signatures ?? 0) > 0 && !signaturesConfirmed;
  const staged = useStagedHandoff(tool.slug, copy.cta, (files) => {
    setOutcome(null);
    setRanBytes(undefined);
    // Two or more carried files open the batch, as a drop of them does
    // (batch plan P6) — never while a job runs, as the drop zone says.
    if (files.length > 1 && !busy) setBatch(files);
    else setFile(files[0] ?? null);
  });

  const start = useCallback(async () => {
    if (!file || !available) return;
    if (mode === "optimize" && !signaturesConfirmed) {
      // The gate reads the file it is about to upload, so a press that lands
      // before the pick-time read finished cannot send a signed file unasked.
      // A File's bytes cannot change under it: a later read returns these
      // same bytes or fails, and a failed read here is left to run() below,
      // whose own read then fails into the job's error outcome.
      const read = await file.arrayBuffer().then(
        (buf) => inspectWebInput(file, new Uint8Array(buf)),
        () => null,
      );
      if (read && read.signatures > 0) {
        setFacts(read);
        return;
      }
    }
    setRanBytes(file.size);
    await run(async (controls) => {
      // Read inside run(): an unreadable file (moved or deleted after the
      // pick) is the job's failure, not an unhandled rejection.
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
  }, [file, mode, run, available, signaturesConfirmed]);

  const detail =
    status?.security.detail ??
    "This qpdf-backed server path is not enabled here.";

  if (batch)
    return (
      <div className="flex flex-col gap-4">
        {staged}
        <WorkerBatch
          tool={tool}
          files={batch}
          onReset={() => setBatch(null)}
          onSingle={(one) => {
            setBatch(null);
            setFile(one);
          }}
          run={mode === "repair" ? runWorkerRepairPdf : runWorkerOptimizeWeb}
        />
      </div>
    );

  return (
    <div
      className="flex flex-col gap-4"
      data-web-input={mode === "optimize" && current ? "read" : undefined}
    >
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
              className="text-muted hover:text-fg tap-y shrink-0 text-sm font-medium transition"
            >
              Remove
            </button>
          </div>
        </ChosenFileTarget>
      ) : (
        <Dropzone
          pageTarget
          busy={busy}
          refuse={refuse}
          onFiles={(files) =>
            // Never to the batch while a job runs (one resumed after a reload
            // has no file in hand, so this zone shows): a second job would
            // start beside it, its status hidden behind the list.
            files.length > 1 && !busy
              ? setBatch(files)
              : setFile(files[0] ?? null)
          }
          accept="application/pdf"
          compact
          title="Add a PDF, or"
          hint="One or more PDFs"
        />
      )}

      {mode === "optimize" && current && current.signatures > 0 && (
        <WebSignatureWarning
          id={signatureWarningId}
          count={current.signatures}
          confirmed={signaturesConfirmed}
          onConfirm={(yes) => setConfirmedFor(yes ? file : null)}
        />
      )}

      {mode === "optimize" && current?.linearized && <AlreadyLinearizedNote />}

      <WorkerGate
        reserve={STATUS_SLOT}
        job={job}
        bytes={file?.size}
        run={(ready) => (
          <WorkerRunButton
            onClick={start}
            busy={busy}
            disabled={!ready || !file || heldBySignatures}
            describedBy={heldBySignatures ? signatureWarningId : undefined}
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
              ? `This runs on your local-dev server on this machine when you press ${copy.cta}.`
              : `Pressing ${copy.cta} uploads your file to our secure server, processes it with qpdf, and wipes the input after processing.`}
          </p>
        }
        off={
          <>
            <p className="text-muted text-sm leading-relaxed">{detail}</p>
            <p className="text-muted text-xs leading-relaxed">
              {copy.cta} stays off until our server is ready, so {tool.name}{" "}
              never pretends to process a file it cannot actually run.
            </p>
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

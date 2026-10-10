"use client";

import { useCallback, useState } from "react";
import { Download, FileText, ShieldCheck, Timer } from "lucide-react";
import { workerPipelineStages } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  canRunPdfOfficeExport,
  runWorkerPdfOfficeExport,
  type PdfOfficeExportWorkerResult,
} from "@/lib/workers/pdf-office-export-client";
import { downloadBytes } from "@/lib/pdf/browser";
import type { Tool } from "@/lib/tools/types";
import { pickRefusal, type PickRefusal } from "@/lib/uploads/pick-check";
import { formatBytes } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
import {
  DownloadCta,
  Dropzone,
  ResultCard,
  WorkerRunButton,
} from "./runner/runner-kit";
import { NotifyMe } from "./notify-me";
import { jobBusyLabel, useWorkerJob, WorkerJobStatus } from "./worker-job";
import { resumeSecurityJob } from "@/lib/workers/pdf-security-client";
import {
  useWorkerStatus,
  WorkerStatusPending,
  type WorkerPhase,
  WorkerStatusSlot,
  workerSlotState,
} from "./worker-status";
import {
  OfficeExportCoverageNotice,
  OfficeExportNextStep,
} from "./office-export-notices";

/**
 * The status slot's reserved height (see `WorkerStatusSlot`): the tallest
 * state it shows at the narrowest width of each breakpoint, measured
 * 2026-10-10 — phone at 360px 308px, `sm` at 640px 269px, `lg` at 1024px
 * 269px — plus 4px, to the half rem.
 */
const STATUS_SLOT = "min-h-[19.5rem] sm:min-h-[17.5rem] lg:min-h-[17.5rem]";

type PdfOfficeTool = "pdf-to-word" | "pdf-to-excel" | "pdf-to-powerpoint";
type Phase = WorkerPhase;

function isPdfOfficeTool(slug: string): slug is PdfOfficeTool {
  return (
    slug === "pdf-to-word" ||
    slug === "pdf-to-excel" ||
    slug === "pdf-to-powerpoint"
  );
}

function extensionFor(slug: PdfOfficeTool): string {
  if (slug === "pdf-to-word") return "DOCX";
  if (slug === "pdf-to-excel") return "XLSX";
  return "PPTX";
}

function badgeFor(
  phase: Phase,
  status: WorkerStatus | null,
): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading")
    return { tone: "info", label: "Checking…", pulse: true };
  if (phase === "error" || !status)
    return { tone: "muted", label: "Status unknown", pulse: false };
  return canRunPdfOfficeExport(status)
    ? { tone: "ok", label: "Secure worker", pulse: false }
    : { tone: "muted", label: "Not enabled", pulse: false };
}

export function PdfOfficeExportWorkerPanel({ tool }: { tool: Tool }) {
  const { phase, status, retry } = useWorkerStatus();
  const officeTool: PdfOfficeTool = isPdfOfficeTool(tool.slug)
    ? tool.slug
    : "pdf-to-word";

  const badge = badgeFor(phase, status);
  const available =
    phase === "ready" &&
    canRunPdfOfficeExport(status) &&
    isPdfOfficeTool(tool.slug);
  // Read only once the status is known: the loading and error phases
  // render <WorkerStatusPending>, which claims nothing about the tool.
  const unavailableDetail =
    status?.daemon.detail ?? "The secure worker is not drainable here.";

  return (
    <div className="">
      <div className="border-line bg-panel flex flex-col gap-6 rounded-[4px] border p-5 sm:p-7">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="border-info/40 bg-info/10 text-info inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium">
              <FileText className="size-3" aria-hidden />
              Selectable text export
            </span>
            <StatusBadge
              tone={badge.tone}
              label={badge.label}
              pulse={badge.pulse}
            />
          </div>
          <h2 className="text-fg text-lg font-semibold">
            {tool.name} runs on an encrypted secure worker
          </h2>
          <p className="text-muted text-sm leading-relaxed">
            The worker extracts selectable PDF text and packages it into a real{" "}
            {extensionFor(officeTool)} file. Pages without selectable text
            (scans) are not included; run OCR first to include them.
          </p>
        </div>

        <WorkerStatusSlot
          state={workerSlotState(phase, available)}
          reserve={STATUS_SLOT}
        >
          {available ? (
            <PdfOfficeRunArea
              tool={officeTool}
              output={extensionFor(officeTool)}
              refuse={(file) => pickRefusal(tool, file)}
            />
          ) : phase === "ready" ? (
            <div className="border-line bg-wash flex flex-col gap-3 rounded-[4px] border p-4">
              <p className="text-muted text-sm leading-relaxed">
                {unavailableDetail}
              </p>
              <p className="text-muted text-xs leading-relaxed">
                No runner is shown until the worker is ready, so {tool.name}{" "}
                never pretends to process input it cannot actually convert.
              </p>
              <NotifyMe
                toolName={tool.name}
                toolSlug={tool.slug}
                checking={false}
              />
            </div>
          ) : (
            <WorkerStatusPending phase={phase} onRetry={retry} />
          )}
        </WorkerStatusSlot>

        <div className="flex flex-col gap-3">
          <h3 className="text-faint kicker">What happens</h3>
          <ol className="flex flex-col gap-1">
            {workerPipelineStages(status ? status.scan.active : null, tool).map(
              (stage, index, all) => (
                <li key={stage.id} className="flex items-start gap-3">
                  <div className="flex flex-col items-center self-stretch">
                    <span className="border-line bg-wash text-muted grid size-8 shrink-0 place-items-center rounded-full border">
                      <FileText className="size-4" aria-hidden />
                    </span>
                    {index < all.length - 1 && (
                      <span className="bg-wash my-1 w-px flex-1" aria-hidden />
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 pb-3">
                    <span className="text-fg text-sm font-medium">
                      {index + 1}. {stage.title}
                    </span>
                    <span className="text-muted text-xs leading-relaxed">
                      {stage.description}
                    </span>
                  </div>
                </li>
              ),
            )}
          </ol>
        </div>

        <div className="bg-panel border-line divide-line divide-y rounded-[4px] border px-4 py-1">
          <SpecRow
            icon={Download}
            label="Output"
            value={extensionFor(officeTool)}
          />
          <SpecRow
            icon={Timer}
            label="Retention"
            value={`Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`}
          />
          <SpecRow
            icon={ShieldCheck}
            label="Limit"
            value={`${formatBytes(JOB_LIMITS.maxFileBytes)}/file`}
          />
        </div>
      </div>
    </div>
  );
}

function SpecRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Download;
  label: string;
  value: string;
}) {
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

function PdfOfficeRunArea({
  tool,
  output,
  refuse,
}: {
  tool: PdfOfficeTool;
  output: string;
  refuse: PickRefusal;
}) {
  const [file, setFile] = useState<File | null>(null);
  const job = useWorkerJob<PdfOfficeExportWorkerResult>({
    tool: tool,
    resume: (id, controls) =>
      resumeSecurityJob(id, { ...controls, tool: tool }),
  });
  const { busy, outcome, setOutcome, run } = job;
  const start = useCallback(async () => {
    if (!file) return;
    await run(async (controls) => {
      const result = await runWorkerPdfOfficeExport(
        {
          tool,
          filename: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        },
        controls,
      );
      return result;
    });
  }, [file, tool, run]);

  return (
    <div className="border-info/40 bg-info/10 flex flex-col gap-4 rounded-[4px] border p-4">
      <p className="text-info flex items-start gap-1.5 text-xs leading-relaxed">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Running this uses a private secure-worker job. Only selectable text is
        exported; scanned/image-only PDFs need OCR first.
      </p>
      {file ? (
        <div className="border-line bg-wash text-fg flex flex-wrap items-center justify-between gap-2 rounded-[3px] border px-3 py-2 text-sm">
          <span className="truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => {
              setFile(null);
              setOutcome(null);
            }}
            className="text-muted hover:text-fg shrink-0 text-xs font-medium transition"
          >
            Remove
          </button>
        </div>
      ) : (
        <Dropzone
          pageTarget
          refuse={refuse}
          onFiles={(files) => setFile(files[0] ?? null)}
          accept="application/pdf,.pdf"
          multiple={false}
          compact
          title="Add your PDF, or"
          hint="Selectable PDF"
        />
      )}
      <WorkerRunButton
        onClick={start}
        busy={busy}
        disabled={!file}
        busyLabel={jobBusyLabel(job.phase, `Exporting ${output}…`)}
        icon={FileText}
      >
        Export {output}
      </WorkerRunButton>
      <WorkerJobStatus job={job} />
      {outcome?.ok === false && !outcome.stillRunning && (
        <OfficeExportNextStep code={outcome.code} message={outcome.message} />
      )}
      {outcome?.ok === true && (
        <ResultCard announce={`Your ${output} file is ready.`}>
          <p className="text-ok text-sm">Your {output} file is ready.</p>
          <OfficeExportCoverageNotice job={outcome.job} />
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

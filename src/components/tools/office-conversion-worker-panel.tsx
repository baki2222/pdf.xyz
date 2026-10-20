"use client";

import { useCallback, useState } from "react";
import { Download, FileText, ShieldCheck, Timer } from "lucide-react";
import { workerPipelineStages } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  canRunOfficeConversion,
  runWorkerOfficeToPdf,
  type OfficeConversionWorkerResult,
} from "@/lib/workers/office-conversion-client";
import { downloadBytes } from "@/lib/pdf/browser";
import { toolFileCeilingBytes } from "@/lib/tools/file-ceilings";
import type { Tool } from "@/lib/tools/types";
import { pickRefusal } from "@/lib/uploads/pick-check";
import { formatBytes } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
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
import {
  useWorkerStatus,
  WorkerStatusPending,
  type WorkerPhase,
  WorkerStatusSlot,
  workerSlotState,
} from "./worker-status";

/**
 * The status slot's reserved height (see `WorkerStatusSlot`): the tallest
 * state it shows at the narrowest width of each breakpoint, measured
 * 2026-10-10 on Windows: phone at 360px 327.5px, `sm` at 640px 269px,
 * `lg` at 1024px 288.5px.
 * The worker-off state grew when its notice gained the logs-and-analytics
 * disclosure (fix/privacy-truth, 2026-10-10), so the phone reserve is refitted
 * to clear the tallest state by at least 3.5%, to the half rem: the headroom
 * Linux Chromium's ~2.2% taller text needs (SLOT_HEADROOM in
 * e2e/tool-layout.mobile.spec.ts).
 *
 * Refitted 2026-10-20, when the slot test began measuring `sm` and `lg`
 * (it had measured phone widths only): the tallest state, the larger of
 * Windows and Linux (CI on #187), is 269px at 640 and
 * 288.5px at 1024; x1.035, to the half rem — the rule the base
 * reserve uses.
 */
const STATUS_SLOT = "min-h-[24rem] sm:min-h-[17.5rem] lg:min-h-[19rem]";

type OfficeTool = "word-to-pdf" | "excel-to-pdf" | "powerpoint-to-pdf";
type Phase = WorkerPhase;

function isOfficeTool(slug: string): slug is OfficeTool {
  return (
    slug === "word-to-pdf" ||
    slug === "excel-to-pdf" ||
    slug === "powerpoint-to-pdf"
  );
}

function acceptFor(slug: OfficeTool): string {
  if (slug === "word-to-pdf")
    return ".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (slug === "excel-to-pdf")
    return ".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
  return ".ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation";
}

function badgeFor(
  phase: Phase,
  status: WorkerStatus | null,
): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading")
    return { tone: "info", label: "Checking…", pulse: true };
  if (phase === "error" || !status)
    return { tone: "muted", label: "Status unknown", pulse: false };
  return canRunOfficeConversion(status)
    ? { tone: "ok", label: "Secure worker", pulse: false }
    : { tone: "muted", label: "Not enabled", pulse: false };
}

export function OfficeConversionWorkerPanel({ tool }: { tool: Tool }) {
  const { phase, status, retry } = useWorkerStatus();
  const ceilingBytes = toolFileCeilingBytes(tool);
  const officeTool: OfficeTool = isOfficeTool(tool.slug)
    ? tool.slug
    : "word-to-pdf";

  const badge = badgeFor(phase, status);
  const available =
    phase === "ready" &&
    canRunOfficeConversion(status) &&
    isOfficeTool(tool.slug);
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
              LibreOffice renderer
            </span>
            <StatusBadge
              tone={badge.tone}
              label={badge.label}
              pulse={badge.pulse}
            />
          </div>
          <h2 className="text-fg text-lg font-semibold">
            {tool.name} runs on a secure worker
          </h2>
          <p className="text-muted text-sm leading-relaxed">
            LibreOffice converts your uploaded document into a real PDF on the
            isolated worker. It produces a PDF artifact or fails honestly — no
            placeholder output.
          </p>
        </div>

        <WorkerStatusSlot
          state={workerSlotState(phase, available)}
          reserve={STATUS_SLOT}
        >
          {available ? (
            <OfficeRunArea
              tool={officeTool}
              catalogTool={tool}
              accept={acceptFor(officeTool)}
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
          <SpecRow icon={Download} label="Output" value="PDF" />
          <SpecRow
            icon={Timer}
            label="Retention"
            value={`Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`}
          />
          {/* LibreOffice's own gate, not the worker's global one. This row
              read `JOB_LIMITS.maxFileBytes` — "100.0 MB/file" — on three
              pages whose engine refuses above 50 MB. */}
          {ceilingBytes !== null && (
            <SpecRow
              icon={ShieldCheck}
              label="Limit"
              value={`${formatBytes(ceilingBytes)}/file`}
            />
          )}
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

function OfficeRunArea({
  tool,
  catalogTool,
  accept,
}: {
  tool: OfficeTool;
  catalogTool: Tool;
  accept: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const job = useWorkerJob<OfficeConversionWorkerResult>({
    tool: tool,
    resume: (id, controls) =>
      resumeSecurityJob(id, { ...controls, tool: tool }),
  });
  const { busy, outcome, setOutcome, run } = job;
  const start = useCallback(async () => {
    if (!file) return;
    await run(async (controls) => {
      const result = await runWorkerOfficeToPdf(
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
        Running this uses a private secure-worker job. The uploaded document is
        stored only for the short worker lifecycle and wiped after processing.
      </p>
      {file ? (
        <ChosenFileTarget
          file={file}
          accept={accept}
          busy={busy}
          refuse={(file) => pickRefusal(catalogTool, file)}
          onReplace={(files) => {
            setOutcome(null);
            setFile(files[0] ?? null);
          }}
        >
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
        </ChosenFileTarget>
      ) : (
        <Dropzone
          pageTarget
          refuse={(file) => pickRefusal(catalogTool, file)}
          onFiles={(files) => {
            // An over-ceiling or wrong-format file never gets here: `refuse`
            // turned it away at the pick, before it was read or uploaded.
            setOutcome(null);
            setFile(files[0] ?? null);
          }}
          accept={accept}
          multiple={false}
          compact
          title="Add your document, or"
          hint="Office document"
        />
      )}
      <WorkerRunButton
        onClick={start}
        busy={busy}
        disabled={!file}
        busyLabel={jobBusyLabel(job.phase, "Converting to PDF…")}
        icon={FileText}
      >
        Convert to PDF
      </WorkerRunButton>
      <WorkerJobStatus job={job} />
      {outcome?.ok === true && (
        <ResultCard announce="Your PDF is ready.">
          <p className="text-ok text-sm">Your PDF is ready.</p>
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

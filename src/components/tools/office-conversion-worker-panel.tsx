"use client";

import { useCallback, useState } from "react";
import { Download, FileText, ShieldCheck, Timer } from "lucide-react";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
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

/**
 * The status slot's reserved height (see `WorkerStatusSlot` and
 * `WorkerGate`): the tallest state it shows — checking, a failed check,
 * not enabled, ready — at the narrowest width of each breakpoint.
 *
 * Refitted 2026-10-21 (WP-10), when the slot came to hold Run, the docket
 * and what the check said, the drop zone having moved out of it: the
 * tallest state, the larger of Windows and Linux (CI's SLOT_NATURAL lines
 * on 507b6383), is 547px at 360, 439.5px at 640, 457.5px at 1024;
 * x1.035, to the half rem, then up to a value another panel's slot already
 * uses, so the thirteen share a handful of classes. A first fit from
 * Windows alone (x1.06) left PowerPoint to PDF and PDF to PowerPoint
 * short on Linux at 360. The check: `e2e/tool-layout.mobile.spec.ts`.
 *
 * Refitted 2026-10-23, when the stage list stopped being drawn before a
 * job (one "What happens to your file" press stands in for it): the
 * tallest state is now not-enabled, off 508/547px at 360 (Windows/Linux;
 * Linux from CI's SLOT_NATURAL lines on 0504da27, a state this change
 * did not touch), x1.035 to the half rem, then up to a value another
 * panel already uses.
 */
const STATUS_SLOT = "min-h-[35.5rem] sm:min-h-[25rem] lg:min-h-[28rem]";

type OfficeTool = "word-to-pdf" | "excel-to-pdf" | "powerpoint-to-pdf";

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

export function OfficeConversionWorkerPanel({ tool }: { tool: Tool }) {
  const ceilingBytes = toolFileCeilingBytes(tool);
  const officeTool: OfficeTool = isOfficeTool(tool.slug)
    ? tool.slug
    : "word-to-pdf";

  return (
    <WorkerPanelShell
      tool={tool}
      engine={{ label: "LibreOffice renderer", icon: FileText }}
      description="LibreOffice converts your uploaded document into a real PDF on the isolated worker. It produces a PDF artifact or fails honestly — no placeholder output."
      canRun={(status) =>
        canRunOfficeConversion(status) && isOfficeTool(tool.slug)
      }
      specRows={[
        { icon: Download, label: "You get", value: "PDF" },
        {
          icon: Timer,
          label: "Your files",
          value: `Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`,
        },
        // LibreOffice's own gate, not the worker's global one. This row
        // read `JOB_LIMITS.maxFileBytes` — "100.0 MB/file" — on three
        // pages whose engine refuses above 50 MB.
        ...(ceilingBytes !== null
          ? [
              {
                icon: ShieldCheck,
                label: "Largest file",
                value: `${formatBytes(ceilingBytes)}/file`,
              },
            ]
          : []),
      ]}
    >
      <OfficeRunArea
        tool={officeTool}
        catalogTool={tool}
        accept={acceptFor(officeTool)}
      />
    </WorkerPanelShell>
  );
}

const RUN_LABEL = "Convert to PDF";

function OfficeRunArea({
  tool,
  catalogTool,
  accept,
}: {
  tool: OfficeTool;
  catalogTool: Tool;
  accept: string;
}) {
  const { available, status } = useWorkerPanel();
  const [file, setFile] = useState<File | null>(null);
  const job = useWorkerJob<OfficeConversionWorkerResult>({
    tool: tool,
    resume: (id, controls) =>
      resumeSecurityJob(id, { ...controls, tool: tool }),
  });
  const { busy, outcome, setOutcome, run } = job;
  const staged = useStagedHandoff(catalogTool.slug, RUN_LABEL, (files) => {
    setOutcome(null);
    setFile(files[0] ?? null);
  });
  const start = useCallback(async () => {
    if (!file || !available) return;
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
  }, [file, tool, run, available]);

  return (
    <div className="flex flex-col gap-4">
      {staged}
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
          <div className="border-line bg-wash text-fg rounded-ctl flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-sm">
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
      <WorkerGate
        reserve={STATUS_SLOT}
        job={job}
        bytes={file?.size}
        run={(ready) => (
          <WorkerRunButton
            onClick={start}
            busy={busy}
            disabled={!ready || !file}
            busyLabel={jobBusyLabel(job.phase, "Converting to PDF…")}
            icon={FileText}
          >
            {RUN_LABEL}
          </WorkerRunButton>
        )}
        jobStatus={<WorkerJobStatus job={job} />}
        note={
          <p className="text-info flex items-start gap-1.5 text-xs leading-relaxed">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Your document uploads to the secure worker only when you press{" "}
            {RUN_LABEL}. It is stored only for the short worker lifecycle and
            wiped after processing.
          </p>
        }
        off={
          <>
            <p className="text-muted text-sm leading-relaxed">
              {status?.daemon.detail ??
                "The secure worker is not drainable here."}
            </p>
            <p className="text-muted text-xs leading-relaxed">
              {RUN_LABEL} stays off until the worker is ready, so{" "}
              {catalogTool.name} never pretends to process input it cannot
              actually convert.
            </p>
            <NotifyMe
              toolName={catalogTool.name}
              toolSlug={catalogTool.slug}
              checking={false}
            />
          </>
        }
      />
      {outcome?.ok === true && (
        <ResultCard
          announce="Your PDF is ready."
          output={workerOutput(outcome.output, outcome.artifact)}
          inputBytes={file?.size}
        >
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

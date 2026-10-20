"use client";

import { useCallback, useState } from "react";
import { Download, ShieldCheck, Table, Timer } from "lucide-react";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import {
  canRunTableExtract,
  runWorkerTableExtract,
  type TableExtractWorkerResult,
} from "@/lib/workers/table-extract-client";
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
import { OfficeExportNextStep } from "./office-export-notices";

/**
 * The status slot's reserved height (see `WorkerStatusSlot`): the tallest
 * state it shows at the narrowest width of each breakpoint, measured
 * 2026-10-10 — phone at 360px 327.5px, `sm` at 640px 269px, `lg` at 1024px
 * 288.5px — plus 4px, to the half rem.
 *
 * Refitted 2026-10-20, when the slot test began measuring `sm` and `lg`
 * (it had measured phone widths only): the tallest state, the larger of
 * Windows and Linux (CI on #187), is 269px at 640 and
 * 288.5px at 1024; x1.035, to the half rem — the rule the base
 * reserve uses.
 */
const STATUS_SLOT = "min-h-[22.5rem] sm:min-h-[17.5rem] lg:min-h-[19rem]";

export function TableExtractWorkerPanel({ tool }: { tool: Tool }) {
  return (
    <WorkerPanelShell
      tool={tool}
      engine={{ label: "Table detection", icon: Table }}
      description="The worker reads the PDF’s selectable text with its page positions, detects aligned table grids, and returns a ZIP of CSV files plus a combined Excel workbook. Scanned PDFs and PDFs without tables fail honestly."
      canRun={canRunTableExtract}
      specRows={[
        { icon: Download, label: "Output", value: "ZIP · CSV + XLSX" },
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
      <TableExtractRunArea
        tool={tool}
        refuse={(file) => pickRefusal(tool, file)}
      />
    </WorkerPanelShell>
  );
}

const RUN_LABEL = "Extract tables";

function TableExtractRunArea({
  tool,
  refuse,
}: {
  tool: Tool;
  refuse: PickRefusal;
}) {
  const { available, status } = useWorkerPanel();
  const [file, setFile] = useState<File | null>(null);
  const job = useWorkerJob<TableExtractWorkerResult>({
    tool: "extract-tables",
    resume: (id, controls) =>
      resumeSecurityJob(id, { ...controls, tool: "extract-tables" }),
  });
  const { busy, outcome, setOutcome, run } = job;
  const staged = useStagedHandoff(tool.slug, RUN_LABEL, (files) => {
    setOutcome(null);
    setFile(files[0] ?? null);
  });
  const start = useCallback(async () => {
    if (!file || !available) return;
    await run(async (controls) => {
      const result = await runWorkerTableExtract(
        {
          filename: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        },
        controls,
      );
      return result;
    });
  }, [file, run, available]);
  // Read only once the status says this panel cannot run.
  const unavailableDetail =
    status?.daemon.detail ?? "The secure worker is not drainable here.";

  return (
    <div className="flex flex-col gap-4">
      {staged}
      {file ? (
        <ChosenFileTarget
          file={file}
          accept="application/pdf,.pdf"
          busy={busy}
          refuse={refuse}
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
          refuse={refuse}
          onFiles={(files) => setFile(files[0] ?? null)}
          accept="application/pdf,.pdf"
          multiple={false}
          compact
          title="Add your PDF, or"
          hint="Selectable PDF"
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
            busyLabel={jobBusyLabel(job.phase, "Extracting tables…")}
            icon={Table}
          >
            {RUN_LABEL}
          </WorkerRunButton>
        )}
        jobStatus={
          <>
            <WorkerJobStatus job={job} />
            {outcome?.ok === false && !outcome.stillRunning && (
              <OfficeExportNextStep
                code={outcome.code}
                message={outcome.message}
              />
            )}
          </>
        }
        note={
          <p className="text-info flex items-start gap-1.5 text-xs leading-relaxed">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Your PDF uploads to a private secure-worker job only when you press{" "}
            {RUN_LABEL}. Only aligned tables in selectable text are extracted;
            scanned/image-only PDFs need OCR first.
          </p>
        }
        off={
          <>
            <p className="text-muted text-sm leading-relaxed">
              {unavailableDetail}
            </p>
            <p className="text-muted text-xs leading-relaxed">
              {RUN_LABEL} stays off until the worker is ready, so {tool.name}{" "}
              never pretends to detect tables it cannot actually extract.
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
          announce="Your tables are ready as a ZIP of CSV files plus a combined Excel workbook."
          output={workerOutput(outcome.output, outcome.artifact)}
          inputBytes={file?.size}
        >
          <p className="text-ok text-sm">
            Your tables are ready as a ZIP of CSV files plus a combined Excel
            workbook.
          </p>
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

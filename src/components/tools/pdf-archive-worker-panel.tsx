"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Archive, FileDown, FileUp, ShieldCheck, Timer } from "lucide-react";
import { workerPipelineStages } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  canRunPdfArchive,
  runWorkerPdfToPdfA,
  type PdfArchiveWorkerResult,
} from "@/lib/workers/pdf-archive-client";
import { PDF_ARCHIVE_PASSWORD_REQUIRED_CODE } from "@/lib/workers/pdf-archive/contract";
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
import { PdfANotes } from "./pdfa-notes";

/**
 * The status slot's reserved height (see `WorkerStatusSlot`): the tallest
 * state it shows at the narrowest width of each breakpoint, measured
 * 2026-10-10 on Windows: phone at 360px 327.5px, `sm` at 640px 269px,
 * `lg` at 1024px 269px.
 * The worker-off state grew when its notice gained the logs-and-analytics
 * disclosure (fix/privacy-truth, 2026-10-10), so the phone reserve is refitted
 * to clear the tallest state by at least 3.5%, to the half rem: the headroom
 * Linux Chromium's ~2.2% taller text needs (SLOT_HEADROOM in
 * e2e/tool-layout.mobile.spec.ts).
 */
const STATUS_SLOT = "min-h-[21.5rem] sm:min-h-[17.5rem] lg:min-h-[17.5rem]";

type Phase = WorkerPhase;

/** Where a user with an open-password PDF can remove the password first. */
export const UNLOCK_TOOL_SLUG = "unlock-pdf";

function badgeFor(
  phase: Phase,
  status: WorkerStatus | null,
): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading")
    return { tone: "info", label: "Checking…", pulse: true };
  if (phase === "error" || !status)
    return { tone: "muted", label: "Status unknown", pulse: false };
  if (canRunPdfArchive(status)) {
    return status.mode === "local-dev"
      ? { tone: "warn", label: "Local-dev worker", pulse: true }
      : { tone: "ok", label: "Secure worker", pulse: false };
  }
  return { tone: "muted", label: "Not enabled", pulse: false };
}

function SpecRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileUp;
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

export function PdfArchiveWorkerPanel({ tool }: { tool: Tool }) {
  const { phase, status, retry } = useWorkerStatus();

  const badge = badgeFor(phase, status);
  const available = phase === "ready" && canRunPdfArchive(status);

  return (
    <div className="">
      <div className="border-line bg-panel flex flex-col gap-6 rounded-[4px] border p-5 sm:p-7">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="border-info/40 bg-info/10 text-info inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium">
              <Archive className="size-3" aria-hidden />
              Secure-worker PDF/A
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
            PDF/A conversion uses Ghostscript on the isolated worker to create
            an archive-oriented PDF/A-2b file. It produces a real PDF output or
            fails honestly — no browser placeholder and no fabricated compliance
            claim. We do not validate the result against the PDF/A
            specification, so this is a best-effort conversion rather than a
            certification. PDF/A cannot represent everything a PDF can, and
            anything Ghostscript has to remove is listed with your download.
          </p>
        </div>

        <WorkerStatusSlot
          state={workerSlotState(phase, available && status !== null)}
          reserve={STATUS_SLOT}
        >
          {available && status ? (
            <ArchiveRunArea
              localDevOnly={status.localDevOnly}
              refuse={(file) => pickRefusal(tool, file)}
            />
          ) : (
            <ArchiveUnavailable onRetry={retry} phase={phase} status={status} />
          )}
        </WorkerStatusSlot>

        <div className="flex flex-col gap-3">
          <h3 className="text-faint kicker">What happens to your file</h3>
          <ol className="flex flex-col gap-1">
            {workerPipelineStages(status ? status.scan.active : null, tool).map(
              (stage, i, all) => (
                <li key={stage.id} className="flex items-start gap-3">
                  <div className="flex flex-col items-center self-stretch">
                    <span className="border-line bg-wash text-muted grid size-8 shrink-0 place-items-center rounded-full border">
                      <Archive className="size-4" aria-hidden />
                    </span>
                    {i < all.length - 1 && (
                      <span className="bg-wash my-1 w-px flex-1" aria-hidden />
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 pb-3">
                    <span className="text-fg text-sm font-medium">
                      {i + 1}. {stage.title}
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
          <SpecRow icon={FileUp} label="Input" value="One PDF" />
          <SpecRow
            icon={FileDown}
            label="Output"
            value="PDF/A-2b (best effort, not validated)"
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

function ArchiveUnavailable({
  phase,
  onRetry,
  status,
}: {
  phase: Phase;
  onRetry: () => void;
  status: WorkerStatus | null;
}) {
  // Until the status is KNOWN this box says nothing about the tool: the
  // server renders the loading phase, and "Notify me when this ships" there
  // told search engines that live tools had not shipped. A failed status
  // check gets a retry, not a notify button.
  if (phase !== "ready")
    return <WorkerStatusPending phase={phase} onRetry={onRetry} />;
  const detail =
    status?.daemon.detail ?? "The secure worker is not drainable here.";
  return (
    <div className="border-line bg-wash flex flex-col gap-3 rounded-[4px] border p-4">
      <p className="text-muted text-sm leading-relaxed">{detail}</p>
      <p className="text-muted text-xs leading-relaxed">
        No uploader is shown until the worker is ready, so PDF/A conversion
        never pretends to process a file it cannot actually run.
      </p>
      <NotifyMe
        toolName="PDF to PDF/A"
        toolSlug="pdf-to-pdfa"
        checking={false}
      />
    </div>
  );
}

function ArchiveRunArea({
  localDevOnly,
  refuse,
}: {
  localDevOnly: boolean;
  refuse: PickRefusal;
}) {
  const [file, setFile] = useState<File | null>(null);
  const job = useWorkerJob<PdfArchiveWorkerResult>({
    tool: "pdf-to-pdfa",
    resume: (id, controls) =>
      resumeSecurityJob(id, { ...controls, tool: "pdf-to-pdfa" }),
  });
  const { busy, outcome, setOutcome, run } = job;
  const start = useCallback(async () => {
    if (!file) return;
    await run(async (controls) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await runWorkerPdfToPdfA(
        { filename: file.name, bytes },
        controls,
      );
      return result;
    });
  }, [file, run]);
  return (
    <div className="border-info/40 bg-info/10 flex flex-col gap-4 rounded-[4px] border p-4">
      <p className="text-info flex items-start gap-1.5 text-xs leading-relaxed">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {localDevOnly
          ? "This runs on your local-dev worker on this machine."
          : "Running this uploads your file to the secure worker, converts it with Ghostscript, and wipes the input after processing."}
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
          refuse={refuse}
          onFiles={(files) => setFile(files[0] ?? null)}
          accept="application/pdf"
          multiple={false}
          compact
          title="Add a PDF, or"
          hint="PDF"
        />
      )}
      <WorkerRunButton
        onClick={start}
        busy={busy}
        disabled={!file}
        busyLabel={jobBusyLabel(job.phase, "Converting to PDF/A…")}
        icon={Archive}
      >
        Convert to PDF/A
      </WorkerRunButton>
      {/* The failure itself (with its ErrorNote), a still-running job and
          Cancel are the shared hook's; the Unlock pointer below is this
          tool's own next step for the one code it knows. */}
      <WorkerJobStatus job={job} />
      {/* The worker can tell an open-password file from a broken one; the
          user should not have to guess which Unlock tool that means. */}
      {outcome?.ok === false &&
        outcome.code === PDF_ARCHIVE_PASSWORD_REQUIRED_CODE && (
          <p className="text-muted text-sm">
            <Link
              href={`/tools/${UNLOCK_TOOL_SLUG}`}
              className="text-fg font-medium underline underline-offset-2"
            >
              Unlock PDF
            </Link>{" "}
            removes the password if you know it. Then convert the unlocked copy
            here.
          </p>
        )}
      {outcome?.ok === true && (
        <ResultCard announce="Your PDF/A file is ready.">
          {/* Above the download: a user who clicks and leaves is exactly the
              user who needs to know something was dropped from their file. */}
          <PdfANotes job={outcome.job} />
          <p className="text-ok text-sm">Your PDF/A file is ready.</p>
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

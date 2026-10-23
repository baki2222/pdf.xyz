"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Archive, FileDown, FileUp, ShieldCheck, Timer } from "lucide-react";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
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
import { PdfANotes } from "./pdfa-notes";

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
 * tallest state is now not-enabled, off 527.5/547px at 360 (Windows/Linux;
 * Linux from CI's SLOT_NATURAL lines on 0504da27, a state this change
 * did not touch), x1.035 to the half rem, then up to a value another
 * panel already uses.
 */
const STATUS_SLOT = "min-h-[35.5rem] sm:min-h-[25rem] lg:min-h-[28rem]";

/** Where a user with an open-password PDF can remove the password first. */
export const UNLOCK_TOOL_SLUG = "unlock-pdf";

export function PdfArchiveWorkerPanel({ tool }: { tool: Tool }) {
  return (
    <WorkerPanelShell
      tool={tool}
      engine={{ label: "Secure-worker PDF/A", icon: Archive }}
      description="PDF/A conversion uses Ghostscript on the isolated worker to create an archive-oriented PDF/A-2b file. It produces a real PDF output or fails honestly — no browser placeholder and no fabricated compliance claim. We do not validate the result against the PDF/A specification, so this is a best-effort conversion rather than a certification. PDF/A cannot represent everything a PDF can, and anything Ghostscript has to remove is listed with your download."
      canRun={canRunPdfArchive}
      specRows={[
        { icon: FileUp, label: "You add", value: "One PDF" },
        {
          icon: FileDown,
          label: "You get",
          value: "PDF/A-2b (best effort, not validated)",
        },
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
      <ArchiveRunArea refuse={(file) => pickRefusal(tool, file)} />
    </WorkerPanelShell>
  );
}

const RUN_LABEL = "Convert to PDF/A";

function ArchiveRunArea({ refuse }: { refuse: PickRefusal }) {
  const { available, status } = useWorkerPanel();
  const [file, setFile] = useState<File | null>(null);
  const job = useWorkerJob<PdfArchiveWorkerResult>({
    tool: "pdf-to-pdfa",
    resume: (id, controls) =>
      resumeSecurityJob(id, { ...controls, tool: "pdf-to-pdfa" }),
  });
  const { busy, outcome, setOutcome, run } = job;
  const staged = useStagedHandoff("pdf-to-pdfa", RUN_LABEL, (files) => {
    setOutcome(null);
    setFile(files[0] ?? null);
  });
  const start = useCallback(async () => {
    if (!file || !available) return;
    await run(async (controls) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await runWorkerPdfToPdfA(
        { filename: file.name, bytes },
        controls,
      );
      return result;
    });
  }, [file, run, available]);
  const detail =
    status?.daemon.detail ?? "The secure worker is not drainable here.";
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
            busyLabel={jobBusyLabel(job.phase, "Converting to PDF/A…")}
            icon={Archive}
          >
            {RUN_LABEL}
          </WorkerRunButton>
        )}
        jobStatus={
          <>
            {/* The failure itself (with its ErrorNote), a still-running job
                and Cancel are the shared hook's; the Unlock pointer below is
                this tool's own next step for the one code it knows. */}
            <WorkerJobStatus job={job} />
            {/* The worker can tell an open-password file from a broken one;
                the user should not have to guess which Unlock tool that
                means. */}
            {outcome?.ok === false &&
              outcome.code === PDF_ARCHIVE_PASSWORD_REQUIRED_CODE && (
                <p className="text-muted text-sm">
                  <Link
                    href={`/tools/${UNLOCK_TOOL_SLUG}`}
                    className="text-fg font-medium underline underline-offset-2"
                  >
                    Unlock PDF
                  </Link>{" "}
                  removes the password if you know it. Then convert the unlocked
                  copy here.
                </p>
              )}
          </>
        }
        note={
          <p className="text-info flex items-start gap-1.5 text-xs leading-relaxed">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {status?.localDevOnly
              ? `This runs on your local-dev worker on this machine when you press ${RUN_LABEL}.`
              : `Pressing ${RUN_LABEL} uploads your file to the secure worker, converts it with Ghostscript, and wipes the input after processing.`}
          </p>
        }
        off={
          <>
            <p className="text-muted text-sm leading-relaxed">{detail}</p>
            <p className="text-muted text-xs leading-relaxed">
              {RUN_LABEL} stays off until the worker is ready, so PDF/A
              conversion never pretends to process a file it cannot actually
              run.
            </p>
            <NotifyMe
              toolName="PDF to PDF/A"
              toolSlug="pdf-to-pdfa"
              checking={false}
            />
          </>
        }
      />
      {outcome?.ok === true && (
        <ResultCard
          announce="Your PDF/A file is ready."
          output={workerOutput(outcome.output, outcome.artifact)}
          inputBytes={file?.size}
        >
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

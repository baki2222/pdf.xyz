"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import dynamic from "next/dynamic";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import { PdfASignatureWarning } from "./pdfa-signature-warning";
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
import {
  DEFAULT_PDFA_LEVEL,
  PDFA_LEVELS,
  PDFA_LEVEL_LABEL,
  PDFA_LEVEL_NAMES,
  type PdfALevelId,
} from "@/lib/workers/pdf-archive/levels";
import { PDFA_COLOUR_NOTE } from "@/lib/workers/pdf-archive/colour";

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
 *
 * Refitted 2026-10-24, when the not-enabled box became one sentence,
 * Why?, Try again and Notify me (the reason one press away): the
 * tallest state, Windows / Linux (CI's SLOT_NATURAL lines on
 * 28af68e1), is 338/357.5px at 360-390, 225.5/225.5px at 640,
 * 230.5/230.5px at 1024; the larger x1.035, to the half rem.
 */
const STATUS_SLOT = "min-h-[23.5rem] sm:min-h-[15rem] lg:min-h-[15rem]";

/** Where a user with an open-password PDF can remove the password first. */
export const UNLOCK_TOOL_SLUG = "unlock-pdf";

export function PdfArchiveWorkerPanel({ tool }: { tool: Tool }) {
  return (
    <WorkerPanelShell
      tool={tool}
      engine={{ label: "PDF/A conversion", icon: Archive }}
      // CHANGED 2026-11-06 (audit #41): ended "anything Ghostscript has to
      // remove is listed with your download". -dQUIET suppresses the font
      // substitution line and the notes are capped (content/pdf-to-pdfa.ts),
      // so only what Ghostscript reports is listed.
      description="PDF/A conversion uses Ghostscript on our isolated server to create an archive-oriented PDF/A file at the level you pick. It produces a real PDF output or fails honestly — no browser placeholder and no fabricated compliance claim. We do not validate the result against the PDF/A specification, so this is a best-effort conversion rather than a certification. PDF/A cannot represent everything a PDF can; what Ghostscript reports dropping is listed with your download, but not every change it makes — a font it substitutes is not reported, so compare the pages before you replace an original."
      canRun={canRunPdfArchive}
      specRows={[
        { icon: FileUp, label: "You add", value: "One or more PDFs" },
        {
          icon: FileDown,
          label: "You get",
          value: `${PDFA_LEVEL_NAMES} (best effort, not validated)`,
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

/**
 * Two or more PDFs: the worker batch (batch plan P3), its own chunk,
 * fetched only when they arrive. The level applies to every file.
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

function ArchiveRunArea({ refuse }: { refuse: PickRefusal }) {
  const { available, status, tool } = useWorkerPanel();
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<File[] | null>(null);
  // Audit pdf-to-pdfa#1: the level the archive asks for; PDF/A-2b by default.
  const [level, setLevel] = useState<PdfALevelId>(DEFAULT_PDFA_LEVEL.id);
  const levelId = useId();
  const levelHint =
    PDFA_LEVELS.find((l) => l.id === level)?.hint ?? DEFAULT_PDFA_LEVEL.hint;
  // Audit pdf-to-pdfa#6: the picked file's digital signatures, counted in
  // the browser before any upload. Keyed by the file, so a count and a
  // confirmation given for one file never carry to the next.
  const [signatures, setSignatures] = useState<{
    file: File;
    count: number;
  } | null>(null);
  const [confirmedFor, setConfirmedFor] = useState<File | null>(null);
  const signatureWarningId = useId();
  useEffect(() => {
    if (!file) return;
    let live = true;
    file
      .arrayBuffer()
      .then((buf) => {
        if (live)
          setSignatures({
            file,
            count: countDigitalSignatures(new Uint8Array(buf)),
          });
      })
      // An unreadable file is the upload's problem to report, not this note's.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [file]);
  const signatureCount = signatures?.file === file ? signatures.count : 0;
  const signaturesConfirmed = confirmedFor !== null && confirmedFor === file;
  const heldBySignatures = signatureCount > 0 && !signaturesConfirmed;
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
    if (!signaturesConfirmed) {
      // The gate reads the file it is about to upload, so a press that lands
      // before the pick-time read finished cannot send a signed file unasked.
      const count = await file.arrayBuffer().then(
        (buf) => countDigitalSignatures(new Uint8Array(buf)),
        () => 0,
      );
      if (count > 0) {
        setSignatures({ file, count });
        return;
      }
    }
    await run(async (controls) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await runWorkerPdfToPdfA(
        { filename: file.name, bytes, level },
        controls,
      );
      return result;
    });
  }, [file, run, available, level, signaturesConfirmed]);
  const detail =
    status?.daemon.detail ?? "Our secure server is not drainable here.";
  const levelPicker = (
    <div className="flex flex-col gap-1">
      <label htmlFor={levelId} className="text-fg text-sm font-medium">
        {PDFA_LEVEL_LABEL}
      </label>
      <select
        id={levelId}
        value={level}
        aria-disabled={busy}
        aria-describedby={`${levelId}-hint`}
        onChange={(e) => {
          // Locked while a job runs, but kept in the focus order.
          if (busy) return;
          setOutcome(null);
          setLevel(e.target.value as PdfALevelId);
        }}
        className="border-line bg-wash text-fg focus:border-accent/40 rounded-ctl min-h-11 border px-3 py-1.5 text-sm outline-none"
      >
        {PDFA_LEVELS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.standard}
          </option>
        ))}
      </select>
      <p id={`${levelId}-hint`} className="text-muted text-xs leading-relaxed">
        {levelHint}
      </p>
      {/* Audit pdf-to-pdfa#5: said before Run, not after the download. */}
      <p className="text-muted text-xs leading-relaxed">{PDFA_COLOUR_NOTE}</p>
    </div>
  );
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
          run={(input, controls) =>
            runWorkerPdfToPdfA({ ...input, level }, controls)
          }
          settings={levelPicker}
        />
      </div>
    );
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
      {file && signatureCount > 0 && (
        <PdfASignatureWarning
          id={signatureWarningId}
          count={signatureCount}
          confirmed={signaturesConfirmed}
          onConfirm={(yes) => setConfirmedFor(yes ? file : null)}
        />
      )}
      {levelPicker}
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
              ? `This runs on your local-dev server on this machine when you press ${RUN_LABEL}.`
              : `Pressing ${RUN_LABEL} uploads your file to our secure server, converts it with Ghostscript, and wipes the input after processing.`}
          </p>
        }
        off={
          <>
            <p className="text-muted text-sm leading-relaxed">{detail}</p>
            <p className="text-muted text-xs leading-relaxed">
              {RUN_LABEL} stays off until our server is ready, so PDF/A
              conversion never pretends to process a file it cannot actually
              run.
            </p>
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

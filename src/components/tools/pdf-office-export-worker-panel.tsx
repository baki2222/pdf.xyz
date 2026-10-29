"use client";

import { useCallback, useState } from "react";
import { Download, FileText, ShieldCheck, Timer } from "lucide-react";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import {
  canRunPdfOfficeExport,
  runWorkerPdfOfficeExport,
  type PdfOfficeExportWorkerResult,
} from "@/lib/workers/pdf-office-export-client";
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
import { OfficeExportCoverageNotice } from "./office-export-coverage";
import { OfficeExportNextStep } from "./office-export-notices";
import { OcrLanguagePicker, useOcrLanguageChoice } from "./ocr-language-picker";
import { WORD_OCR_HINT } from "@/lib/jobs/pdf-office-export";
import { PDF_TO_WORD_OCR_LANGUAGE_CODES } from "@/lib/jobs/ocr";

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
 *
 * Refitted 2026-10-24, when the not-enabled box became one sentence,
 * Why?, Try again and Notify me (the reason one press away): the
 * tallest state, Windows / Linux (CI's SLOT_NATURAL lines on
 * 28af68e1), is 338/357.5px at 360-390, 225.5/225.5px at 640,
 * 230.5/230.5px at 1024; the larger x1.035, to the half rem.
 */
const STATUS_SLOT = "min-h-[23.5rem] sm:min-h-[15rem] lg:min-h-[15rem]";

type PdfOfficeTool = "pdf-to-word" | "pdf-to-excel" | "pdf-to-powerpoint";

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

/**
 * What the panel says the export carries, per tool. Word and Excel package a
 * PDF's selectable text and refuse a scan; since 2026-10-10 PowerPoint reads
 * the PAGES, keeps their pictures and drawing, and turns a scan into a slide
 * of pictures (`pdf-office-export/page-scan.ts`). One sentence for all three
 * said "Pages without selectable text (scans) are not included" until then,
 * which became false for PowerPoint.
 */
const EXPORT_COPY: Record<
  PdfOfficeTool,
  { badge: string; summary: string; note: string; hint: string }
> = {
  // CHANGED 2026-10-17: "The worker extracts selectable PDF text and
  // packages it into a real DOCX file. Pages without selectable text (scans)
  // are not included" — true until Word began carrying pictures.
  "pdf-to-word": {
    badge: "Text and pictures",
    summary:
      // CHANGED 2026-10-24: "…; run OCR first to have its words as text
      // too." — before the OCR switch below ran it in the same job.
      "The worker reads each page's selectable text, in reading order, and its pictures, and packages them into a real DOCX file. A scanned page comes through as a picture; turn on OCR below to have its words as text too.",
    note: "Running this uses a private secure-worker job. A PDF with no selectable text at all, such as a scan, needs the OCR switch on.",
    hint: "Selectable PDF",
  },
  "pdf-to-excel": {
    badge: "Selectable text export",
    summary:
      "The worker extracts selectable PDF text and packages it into a real XLSX file. Pages without selectable text (scans) are not included; run OCR first to include them.",
    note: "Running this uses a private secure-worker job. Only selectable text is exported; scanned/image-only PDFs need OCR first.",
    hint: "Selectable PDF",
  },
  "pdf-to-powerpoint": {
    badge: "Pages to slides",
    summary:
      "The worker reads each page and builds a real PPTX file: pictures where the page shows them, text in text boxes at their places, other drawing as pictures. A scanned page comes through as a picture; run OCR first to have its words as text too.",
    note: "Running this uses a private secure-worker job. A scanned page comes through as a picture on its slide; run OCR first to have its words as text.",
    hint: "One PDF",
  },
};

export function PdfOfficeExportWorkerPanel({ tool }: { tool: Tool }) {
  const officeTool: PdfOfficeTool = isPdfOfficeTool(tool.slug)
    ? tool.slug
    : "pdf-to-word";

  return (
    <WorkerPanelShell
      tool={tool}
      engine={{ label: EXPORT_COPY[officeTool].badge, icon: FileText }}
      description={EXPORT_COPY[officeTool].summary}
      canRun={(status) =>
        canRunPdfOfficeExport(status) && isPdfOfficeTool(tool.slug)
      }
      specRows={[
        { icon: Download, label: "You get", value: extensionFor(officeTool) },
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
      <PdfOfficeRunArea
        tool={officeTool}
        catalogTool={tool}
        output={extensionFor(officeTool)}
        refuse={(file) => pickRefusal(tool, file)}
      />
    </WorkerPanelShell>
  );
}

function PdfOfficeRunArea({
  tool,
  catalogTool,
  output,
  refuse,
}: {
  tool: PdfOfficeTool;
  catalogTool: Tool;
  output: string;
  refuse: PickRefusal;
}) {
  const { available, status } = useWorkerPanel();
  const runLabel = `Export ${output}`;
  const [file, setFile] = useState<File | null>(null);
  const job = useWorkerJob<PdfOfficeExportWorkerResult>({
    tool: tool,
    resume: (id, controls) =>
      resumeSecurityJob(id, { ...controls, tool: tool }),
  });
  const { busy, outcome, setOutcome, run } = job;
  const staged = useStagedHandoff(catalogTool.slug, runLabel, (files) => {
    setOutcome(null);
    setFile(files[0] ?? null);
  });
  // PDF to Word only: OCR first, in the same job, with OCR PDF's languages.
  const offersOcr = tool === "pdf-to-word";
  const [ocrOn, setOcrOn] = useState(false);
  // Right-to-left scripts are left out: their words come out of the
  // conversion out of order (`PDF_TO_WORD_OCR_LANGUAGE_CODES`).
  const languageChoice = useOcrLanguageChoice(
    status,
    PDF_TO_WORD_OCR_LANGUAGE_CODES,
  );
  const ocrAvailable = status?.ocr.available === true;
  const ocrBlocked = offersOcr && ocrOn && !ocrAvailable;
  const languages = languageChoice.selected;
  const start = useCallback(async () => {
    if (!file || !available || ocrBlocked) return;
    await run(async (controls) => {
      const result = await runWorkerPdfOfficeExport(
        {
          tool,
          filename: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
          ...(offersOcr && ocrOn ? { ocr: { languages } } : {}),
        },
        controls,
      );
      return result;
    });
  }, [file, tool, run, available, ocrBlocked, offersOcr, ocrOn, languages]);
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
          <div className="border-line bg-wash text-fg rounded-ctl flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-sm">
            <span className="truncate">{file.name}</span>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setOutcome(null);
              }}
              className="text-muted hover:text-fg shrink-0 text-sm font-medium transition max-sm:-my-1.5 max-sm:py-1.5"
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
          hint={EXPORT_COPY[tool].hint}
        />
      )}
      {offersOcr && (
        <div className="border-line rounded-panel flex flex-col gap-3 border p-3">
          <label className="text-muted flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={ocrOn}
              // Guarded, never `disabled`: focus stays put mid-run (#46).
              onChange={(event) => {
                if (!busy) setOcrOn(event.target.checked);
              }}
              aria-disabled={busy || undefined}
              className="border-line-strong bg-wash accent-accent rounded-ctl mt-0.5 size-4"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-fg font-medium">
                Recognise text in scans (OCR)
              </span>
              <span className="text-muted text-xs leading-relaxed">
                {WORD_OCR_HINT}
              </span>
            </span>
          </label>
          {ocrOn &&
            (ocrAvailable ? (
              <OcrLanguagePicker choice={languageChoice} />
            ) : (
              <p className="text-warn text-xs leading-relaxed">
                {status?.ocr.detail ??
                  "OCR isn't available on this worker, so this option can't run here."}{" "}
                Turn it off to convert the selectable text alone.
              </p>
            ))}
        </div>
      )}
      <WorkerGate
        reserve={STATUS_SLOT}
        job={job}
        bytes={file?.size}
        run={(ready) => (
          <WorkerRunButton
            onClick={start}
            busy={busy}
            disabled={!ready || !file || ocrBlocked}
            busyLabel={jobBusyLabel(job.phase, `Exporting ${output}…`)}
            icon={FileText}
          >
            {runLabel}
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
            <span>
              Your PDF uploads only when you press {runLabel}.{" "}
              {EXPORT_COPY[tool].note}
            </span>
          </p>
        }
        off={
          <>
            <p className="text-muted text-sm leading-relaxed">
              {unavailableDetail}
            </p>
            <p className="text-muted text-xs leading-relaxed">
              {runLabel} stays off until the worker is ready, so{" "}
              {catalogTool.name} never pretends to process input it cannot
              actually convert.
            </p>
          </>
        }
      />
      {outcome?.ok === true && (
        <ResultCard
          announce={`Your ${output} file is ready.`}
          output={workerOutput(outcome.output, outcome.artifact)}
          inputBytes={file?.size}
        >
          <p className="text-ok text-sm">Your {output} file is ready.</p>
          <OfficeExportCoverageNotice job={outcome.job} tool={tool} />
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

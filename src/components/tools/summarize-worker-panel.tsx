"use client";

import { useCallback, useState } from "react";
import { Download, FileText, ShieldCheck, Sparkles, Timer } from "lucide-react";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import { aiReadLimitFor } from "@/lib/jobs/ai-read-limit";
import {
  DEFAULT_SUMMARY_FORMAT,
  DEFAULT_SUMMARY_LENGTH,
  MAX_SUMMARY_FOCUS_CHARS,
  type SummaryFormat,
  type SummaryLength,
} from "@/lib/jobs/summarize-pdf";
import {
  aiDailyAllowanceNote,
  aiToolUnavailableDetail,
} from "@/lib/workers/ai-tool-availability";
import { countDeclaredCharacters } from "@/lib/workers/ai-declared-characters";
import {
  canRunSummarize,
  preflightSummarize,
  runWorkerSummarize,
  type SummarizeWorkerResult,
} from "@/lib/workers/summarize-client";
import { downloadBytes } from "@/lib/pdf/browser";
import { TruncationNotice } from "./truncation-notice";
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
import { OfficeExportNextStep } from "./office-export-notices";
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
 * on 507b6383), is 660.8px at 360, 478px at 640, 535px at 1024;
 * x1.035, to the half rem, then up to a value another panel's slot already
 * uses, so the thirteen share a handful of classes. A first fit from
 * Windows alone (x1.06) left PowerPoint to PDF and PDF to PowerPoint
 * short on Linux at 360. The check: `e2e/tool-layout.mobile.spec.ts`.
 *
 * Refitted 2026-10-23, when the stage list stopped being drawn before a
 * job (one "What happens to your file" press stands in for it): the
 * tallest state is now not-enabled, off 641.3/660.8px at 360 (Windows/Linux;
 * Linux from CI's SLOT_NATURAL lines on 0504da27, a state this change
 * did not touch), x1.035 to the half rem, then up to a value another
 * panel already uses.
 */
const STATUS_SLOT = "min-h-[43rem] sm:min-h-[29.5rem] lg:min-h-[33.5rem]";

const LENGTH_OPTIONS: { value: SummaryLength; label: string }[] = [
  { value: "brief", label: "Brief — TL;DR + key points" },
  { value: "standard", label: "Standard — the main points" },
  { value: "detailed", label: "Detailed — every major section" },
];

const FORMAT_OPTIONS: { value: SummaryFormat; label: string }[] = [
  { value: "paragraphs", label: "Paragraphs" },
  { value: "bullets", label: "Bullet points" },
  { value: "outline", label: "Section outline" },
];

export function SummarizeWorkerPanel({ tool }: { tool: Tool }) {
  return (
    <WorkerPanelShell
      tool={tool}
      tone="accent"
      engine={{ label: "AI summary", icon: Sparkles }}
      description={
        <>
          The worker extracts your PDF&apos;s selectable text and asks a
          configured AI model to summarize only that text, then returns a
          summary package — Markdown, plain text, and a manifest recording the
          model and scope. With no AI model configured, or a scanned PDF with no
          selectable text, the job fails instead of guessing. The model is
          instructed to use only the document&apos;s text, but AI output can
          still be wrong, so check important details against your PDF.
        </>
      }
      canRun={canRunSummarize}
      specRows={[
        {
          icon: Download,
          label: "You get",
          value: "ZIP · summary.md + summary.txt + manifest",
        },
        {
          icon: Timer,
          label: "Your files",
          value: `Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`,
        },
        {
          icon: ShieldCheck,
          label: "Largest file",
          value: `${formatBytes(JOB_LIMITS.maxFileBytes)}/file · ${aiReadLimitFor(tool.slug).toLocaleString("en-US")} characters read`,
        },
      ]}
    >
      <SummaryBuilder tool={tool} refuse={(file) => pickRefusal(tool, file)} />
    </WorkerPanelShell>
  );
}

const RUN_LABEL = "Summarize PDF";

function SummaryBuilder({ tool, refuse }: { tool: Tool; refuse: PickRefusal }) {
  const { available, status } = useWorkerPanel();
  const [file, setFile] = useState<File | null>(null);
  const [length, setLength] = useState<SummaryLength>(DEFAULT_SUMMARY_LENGTH);
  const [format, setFormat] = useState<SummaryFormat>(DEFAULT_SUMMARY_FORMAT);
  const [focus, setFocus] = useState("");
  const job = useWorkerJob<SummarizeWorkerResult>({
    tool: "summarize-pdf",
    resume: (id, controls) =>
      resumeSecurityJob(id, { ...controls, tool: "summarize-pdf" }),
  });
  const { busy, outcome, setOutcome, run } = job;
  const staged = useStagedHandoff(tool.slug, RUN_LABEL, (files) => {
    setOutcome(null);
    setFile(files[0] ?? null);
  });

  const canRun = file != null && !busy;

  const start = useCallback(async () => {
    if (!file || !available) return;
    await run(async (controls) => {
      const trimmedFocus = focus.trim();
      const bytes = new Uint8Array(await file.arrayBuffer());
      // CHECK HERE, BEFORE ANYTHING IS SPENT. The allowance is reserved when
      // the job is created, and a scan or a locked PDF has no count to
      // declare, so the worker's refusal would arrive after the undeclared
      // price (a third of the day) was taken. See preflightSummarize.
      const refusal = await preflightSummarize(bytes);
      if (!refusal.ok) return refusal;
      const result = await runWorkerSummarize(
        {
          filename: file.name,
          bytes,
          length,
          format,
          ...(trimmedFocus ? { focus: trimmedFocus } : {}),
          // Counted before upload so the run is charged what this document
          // holds, not a third of the day. `null` (a file pdfjs cannot count)
          // sends it undeclared at the old price rather than refusing it.
          declaredCharacters: await countDeclaredCharacters(bytes),
        },
        controls,
      );
      return result;
    });
  }, [file, length, format, focus, run, available]);

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
          hint="PDF with selectable text to summarize"
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-muted flex flex-col gap-1 text-xs">
          Summary length
          <select
            value={length}
            onChange={(e) => setLength(e.target.value as SummaryLength)}
            className="border-line bg-wash text-fg focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
          >
            {LENGTH_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-muted flex flex-col gap-1 text-xs">
          Format
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as SummaryFormat)}
            className="border-line bg-wash text-fg focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
          >
            {FORMAT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-muted flex flex-col gap-1 text-xs sm:col-span-2">
          Focus (optional)
          <input
            type="text"
            value={focus}
            onChange={(e) =>
              setFocus(e.target.value.slice(0, MAX_SUMMARY_FOCUS_CHARS))
            }
            maxLength={MAX_SUMMARY_FOCUS_CHARS}
            placeholder="e.g. focus on financial risks and obligations"
            className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
          />
        </label>
      </div>

      <WorkerGate
        reserve={STATUS_SLOT}
        job={job}
        bytes={file?.size}
        run={(ready) => (
          <WorkerRunButton
            onClick={start}
            busy={busy}
            // `canRun` already folds in `!busy`; both go through one blocked branch.
            disabled={!ready || !canRun}
            busyLabel={jobBusyLabel(job.phase, "Summarizing…")}
            icon={FileText}
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
          <div className="flex flex-col gap-2">
            <p className="text-accent flex items-start gap-1.5 text-xs leading-relaxed">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Your PDF uploads to a private secure-worker job only when you
              press {RUN_LABEL}. The worker sends only the PDF&apos;s selectable
              text to a configured AI model — it does not read scanned images
              (run OCR first) — and the model is told to summarize only that
              text. AI output can still be wrong.
            </p>
            {/* Said only when the panel can run, inside the reserved slot:
                above it, it pushed the whole slot down as the status
                answered (Chat with PDF read CLS 0.0241 at 390, 2026-10-10). */}
            <p className="text-muted text-xs leading-relaxed">
              {aiDailyAllowanceNote(tool.slug)}
            </p>
          </div>
        }
        off={
          <>
            <p className="text-muted text-sm leading-relaxed">
              {aiToolUnavailableDetail(status)}
            </p>
            <p className="text-muted text-xs leading-relaxed">
              {RUN_LABEL} stays off until the worker is ready, so {tool.name}{" "}
              never pretends to produce a summary it cannot actually generate.
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
          announce="Your AI summary package is ready."
          output={workerOutput(outcome.output, outcome.artifact)}
          inputBytes={file?.size}
        >
          <TruncationNotice
            job={outcome.job}
            consequence="This summarises those pages, not the whole document."
          />
          <p className="text-ok text-sm">
            Your AI summary package is ready — the summary in Markdown and plain
            text, plus a manifest recording the model and honest scope.
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

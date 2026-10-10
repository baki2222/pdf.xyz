"use client";

import { useCallback, useState } from "react";
import { Download, FileText, ShieldCheck, Sparkles, Timer } from "lucide-react";
import { workerPipelineStages } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import { aiReadLimitFor } from "@/lib/jobs/ai-read-limit";
import {
  DEFAULT_SUMMARY_FORMAT,
  DEFAULT_SUMMARY_LENGTH,
  MAX_SUMMARY_FOCUS_CHARS,
  type SummaryFormat,
  type SummaryLength,
} from "@/lib/jobs/summarize-pdf";
import type { WorkerStatus } from "@/lib/workers/status";
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
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
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
 * 2026-10-10 — phone at 360px 745px, `sm` at 640px 546px, `lg` at 1024px
 * 565.5px — plus 4px, to the half rem. The run state includes the daily
 * allowance note, which only a panel that can run says.
 */
const STATUS_SLOT = "min-h-[47rem] sm:min-h-[34.5rem] lg:min-h-[36rem]";

type Phase = WorkerPhase;

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

function badgeFor(
  phase: Phase,
  status: WorkerStatus | null,
): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading")
    return { tone: "info", label: "Checking…", pulse: true };
  if (phase === "error" || !status)
    return { tone: "muted", label: "Status unknown", pulse: false };
  return canRunSummarize(status)
    ? { tone: "ok", label: "Secure worker", pulse: false }
    : { tone: "muted", label: "Not enabled", pulse: false };
}

export function SummarizeWorkerPanel({ tool }: { tool: Tool }) {
  const { phase, status, retry } = useWorkerStatus();

  const badge = badgeFor(phase, status);
  const available = phase === "ready" && canRunSummarize(status);
  // Read only once the status is known: the loading and error phases
  // render <WorkerStatusPending>, which claims nothing about the tool.
  const unavailableDetail = aiToolUnavailableDetail(status);

  return (
    <div className="">
      <div className="border-line bg-panel flex flex-col gap-6 rounded-[4px] border p-5 sm:p-7">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="border-accent/40 bg-accent/10 text-accent inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium">
              <Sparkles className="size-3" aria-hidden />
              AI summary
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
            The worker extracts your PDF&apos;s selectable text and asks a
            configured AI model to summarize only that text, then returns a
            summary package — Markdown, plain text, and a manifest recording the
            model and scope. With no AI model configured, or a scanned PDF with
            no selectable text, the job fails instead of guessing. The model is
            instructed to use only the document&apos;s text, but AI output can
            still be wrong, so check important details against your PDF.
          </p>
        </div>

        <WorkerStatusSlot
          state={workerSlotState(phase, available)}
          reserve={STATUS_SLOT}
        >
          {available ? (
            <div className="flex flex-col gap-6">
              {/* Said only when the panel can run, so it is part of the
                  run area. Above the slot it pushed the whole slot down
                  as the status answered: Chat with PDF read CLS 0.0241 at
                  390 with the slot reserved (measured 2026-10-10). */}
              <p className="text-muted text-xs leading-relaxed">
                {aiDailyAllowanceNote(tool.slug)}
              </p>
              <SummaryBuilder refuse={(file) => pickRefusal(tool, file)} />
            </div>
          ) : phase === "ready" ? (
            <div className="border-line bg-wash flex flex-col gap-3 rounded-[4px] border p-4">
              <p className="text-muted text-sm leading-relaxed">
                {unavailableDetail}
              </p>
              <p className="text-muted text-xs leading-relaxed">
                No builder is shown until the worker is ready, so {tool.name}{" "}
                never pretends to produce a summary it cannot actually generate.
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
                      <Sparkles className="size-4" aria-hidden />
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
            value="ZIP · summary.md + summary.txt + manifest"
          />
          <SpecRow
            icon={Timer}
            label="Retention"
            value={`Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`}
          />
          <SpecRow
            icon={ShieldCheck}
            label="Limit"
            value={`${formatBytes(JOB_LIMITS.maxFileBytes)}/file · ${aiReadLimitFor(tool.slug).toLocaleString("en-US")} characters read`}
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

function SummaryBuilder({ refuse }: { refuse: PickRefusal }) {
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

  const canRun = file != null && !busy;

  const start = useCallback(async () => {
    if (!file) return;
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
  }, [file, length, format, focus, run]);

  return (
    <div className="border-accent/40 bg-accent/10 flex flex-col gap-4 rounded-[4px] border p-4">
      <p className="text-accent flex items-start gap-1.5 text-xs leading-relaxed">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Running this uses a private secure-worker job. The worker sends only the
        PDF&apos;s selectable text to a configured AI model — it does not read
        scanned images (run OCR first) — and the model is told to summarize only
        that text. AI output can still be wrong.
      </p>

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
          hint="PDF with selectable text to summarize"
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-muted flex flex-col gap-1 text-xs">
          Summary length
          <select
            value={length}
            onChange={(e) => setLength(e.target.value as SummaryLength)}
            className="border-line bg-wash text-fg focus:border-accent/40 rounded-lg border px-3 py-1.5 text-sm outline-none"
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
            className="border-line bg-wash text-fg focus:border-accent/40 rounded-lg border px-3 py-1.5 text-sm outline-none"
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
            className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 rounded-lg border px-3 py-1.5 text-sm outline-none"
          />
        </label>
      </div>

      <WorkerRunButton
        onClick={start}
        busy={busy}
        // `canRun` already folds in `!busy`; both go through one blocked branch.
        disabled={!canRun}
        busyLabel={jobBusyLabel(job.phase, "Summarizing…")}
        icon={FileText}
        tone="violet"
      >
        Summarize PDF
      </WorkerRunButton>

      <WorkerJobStatus job={job} />
      {outcome?.ok === false && !outcome.stillRunning && (
        <OfficeExportNextStep code={outcome.code} message={outcome.message} />
      )}
      {outcome?.ok === true && (
        <ResultCard announce="Your AI summary package is ready.">
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

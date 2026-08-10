"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FileText, ShieldCheck, Sparkles, Timer } from "lucide-react";
import { workerPipelineStages } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import {
  DEFAULT_SUMMARY_FORMAT,
  DEFAULT_SUMMARY_LENGTH,
  MAX_SUMMARY_FOCUS_CHARS,
  type SummaryFormat,
  type SummaryLength,
} from "@/lib/jobs/summarize-pdf";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  AI_DAILY_ALLOWANCE_NOTE,
  aiToolUnavailableDetail,
} from "@/lib/workers/ai-tool-availability";
import {
  canRunSummarize,
  runWorkerSummarize,
  type SummarizeWorkerResult,
} from "@/lib/workers/summarize-client";
import { downloadBytes } from "@/lib/pdf/browser";
import { track } from "@/lib/telemetry/track";
import type { Tool } from "@/lib/tools/types";
import { formatBytes } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
import {
  Dropzone,
  ErrorNote,
  ResultCard,
  WorkerRunButton,
} from "./runner/runner-kit";
import { NotifyMe } from "./notify-me";

type Phase = "loading" | "error" | "ready";

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
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<WorkerStatus | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/worker/status", { headers: { accept: "application/json" } })
      .then((res) =>
        res.ok
          ? (res.json() as Promise<WorkerStatus>)
          : Promise.reject(new Error("unreachable")),
      )
      .then((next) => {
        if (!active) return;
        setStatus(next);
        setPhase("ready");
        track({
          name: "worker_status_checked",
          mode: next.mode,
          enabled: next.enabled,
        });
      })
      .catch(() => {
        if (active) setPhase("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const badge = badgeFor(phase, status);
  const available = phase === "ready" && canRunSummarize(status);
  const unavailableDetail =
    phase === "loading"
      ? "Checking whether a secure worker is available…"
      : phase === "error"
        ? "The worker status endpoint could not be reached right now."
        : aiToolUnavailableDetail(status);

  return (
    <div className="gradient-border">
      <div className="glass flex flex-col gap-6 rounded-3xl p-5 sm:p-7">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-400/10 px-2.5 py-1 text-[11px] font-medium text-violet-200">
              <Sparkles className="size-3" aria-hidden />
              AI summary
            </span>
            <StatusBadge
              tone={badge.tone}
              label={badge.label}
              pulse={badge.pulse}
            />
          </div>
          <h2 className="text-lg font-semibold text-white">
            {tool.name} runs on an encrypted secure worker
          </h2>
          <p className="text-sm leading-relaxed text-slate-400">
            The worker extracts your PDF&apos;s selectable text and asks a
            configured AI model to summarize only that text, then returns a
            summary package — Markdown, plain text, and a manifest recording the
            model and scope. It never fabricates a summary: with no AI model
            configured, or a scanned PDF with no selectable text, it fails
            honestly instead of guessing.
          </p>
        </div>

        {available && (
          <p className="text-xs leading-relaxed text-slate-400">
            {AI_DAILY_ALLOWANCE_NOTE}
          </p>
        )}
        {available ? (
          <SummaryBuilder />
        ) : (
          <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm leading-relaxed text-slate-300">
              {unavailableDetail}
            </p>
            <p className="text-xs leading-relaxed text-slate-400">
              No builder is shown until the worker is ready, so {tool.name}{" "}
              never pretends to produce a summary it cannot actually generate.
            </p>
            <NotifyMe toolName={tool.name} toolSlug={tool.slug} />
          </div>
        )}

        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold tracking-widest text-slate-400 uppercase">
            What happens
          </h3>
          <ol className="flex flex-col gap-1">
            {workerPipelineStages(status?.scan.active ?? false).map(
              (stage, index, all) => (
                <li key={stage.id} className="flex items-start gap-3">
                  <div className="flex flex-col items-center self-stretch">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-300">
                      <Sparkles className="size-4" aria-hidden />
                    </span>
                    {index < all.length - 1 && (
                      <span
                        className="my-1 w-px flex-1 bg-white/10"
                        aria-hidden
                      />
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 pb-3">
                    <span className="text-sm font-medium text-slate-200">
                      {index + 1}. {stage.title}
                    </span>
                    <span className="text-xs leading-relaxed text-slate-400">
                      {stage.description}
                    </span>
                  </div>
                </li>
              ),
            )}
          </ol>
        </div>

        <div className="bg-surface-2 divide-y divide-white/5 rounded-2xl border border-white/10 px-4 py-1">
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
      <span className="inline-flex items-center gap-2 text-sm text-slate-400">
        <Icon className="size-4 text-slate-400" aria-hidden />
        {label}
      </span>
      <span className="text-right text-sm font-medium text-slate-200">
        {value}
      </span>
    </div>
  );
}

function SummaryBuilder() {
  const [file, setFile] = useState<File | null>(null);
  const [length, setLength] = useState<SummaryLength>(DEFAULT_SUMMARY_LENGTH);
  const [format, setFormat] = useState<SummaryFormat>(DEFAULT_SUMMARY_FORMAT);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SummarizeWorkerResult | null>(null);

  const canRun = file != null && !busy;

  const start = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    try {
      setOutcome(null);
      const trimmedFocus = focus.trim();
      const result = await runWorkerSummarize({
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
        length,
        format,
        ...(trimmedFocus ? { focus: trimmedFocus } : {}),
      });
      setOutcome(result);
    } catch {
      // A rejected fetch — offline, DNS failure, a reset connection, CORS — or a
      // file that could not be read. None of these produce a response to inspect,
      // so there is nothing honest to say beyond what happened.
      setOutcome({
        ok: false,
        message:
          "Lost the connection before the job finished. Check your network and try again.",
      });
    } finally {
      setBusy(false);
    }
  }, [file, length, format, focus]);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-violet-400/25 bg-violet-500/[0.06] p-4">
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-violet-100/90">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Running this uses a private secure-worker job. The worker summarizes
        only the PDF&apos;s selectable text with a configured AI model — it does
        not read scanned images (run OCR first) and does not invent content.
      </p>

      {file ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200">
          <span className="truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => {
              setFile(null);
              setOutcome(null);
            }}
            className="shrink-0 text-xs font-medium text-slate-400 transition hover:text-white"
          >
            Remove
          </button>
        </div>
      ) : (
        <Dropzone
          onFiles={(files) => setFile(files[0] ?? null)}
          accept="application/pdf,.pdf"
          multiple={false}
          compact
          title="Add your PDF, or"
          hint="PDF with selectable text to summarize"
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Summary length
          <select
            value={length}
            onChange={(e) => setLength(e.target.value as SummaryLength)}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-violet-400/50"
          >
            {LENGTH_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Format
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as SummaryFormat)}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-violet-400/50"
          >
            {FORMAT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400 sm:col-span-2">
          Focus (optional)
          <input
            type="text"
            value={focus}
            onChange={(e) =>
              setFocus(e.target.value.slice(0, MAX_SUMMARY_FOCUS_CHARS))
            }
            maxLength={MAX_SUMMARY_FOCUS_CHARS}
            placeholder="e.g. focus on financial risks and obligations"
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-400 focus:border-violet-400/50"
          />
        </label>
      </div>

      <WorkerRunButton
        onClick={start}
        busy={busy}
        // `canRun` already folds in `!busy`; both go through one blocked branch.
        disabled={!canRun}
        busyLabel="Summarizing…"
        icon={FileText}
        tone="violet"
      >
        Summarize PDF
      </WorkerRunButton>

      {outcome?.ok === false && <ErrorNote message={outcome.message} />}
      {outcome?.ok === true && (
        <ResultCard announce="Your AI summary package is ready.">
          <p className="text-sm text-emerald-200">
            Your AI summary package is ready — the summary in Markdown and plain
            text, plus a manifest recording the model and honest scope.
          </p>
          <button
            type="button"
            onClick={() =>
              downloadBytes(outcome.output, outcome.artifact.filename)
            }
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:brightness-110 sm:w-auto sm:self-start"
          >
            <Download className="size-4" aria-hidden />
            Download {outcome.artifact.filename}
          </button>
        </ResultCard>
      )}
    </div>
  );
}

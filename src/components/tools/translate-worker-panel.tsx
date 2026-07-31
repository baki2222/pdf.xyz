"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Languages, ShieldCheck, Sparkles, Timer } from "lucide-react";
import { WORKER_PIPELINE_STAGES } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import {
  DEFAULT_TRANSLATE_SOURCE,
  LANGUAGE_NAMES,
  MAX_TRANSLATE_INSTRUCTIONS_CHARS,
  TRANSLATE_LANGUAGES,
  TRANSLATE_SOURCE_AUTO,
  type TranslateLanguage,
  type TranslateSourceLanguage,
} from "@/lib/jobs/translate-pdf";
import type { WorkerStatus } from "@/lib/workers/status";
import { aiToolUnavailableDetail } from "@/lib/workers/ai-tool-availability";
import {
  canRunTranslate,
  runWorkerTranslate,
  type TranslateWorkerResult,
} from "@/lib/workers/translate-client";
import { downloadBytes } from "@/lib/pdf/browser";
import { track } from "@/lib/telemetry/track";
import type { Tool } from "@/lib/tools/types";
import { formatBytes } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
import { Dropzone, ErrorNote, Spinner } from "./runner/runner-kit";
import { NotifyMe } from "./notify-me";

type Phase = "loading" | "error" | "ready";

/** The default target language shown in the builder. */
const DEFAULT_TARGET: TranslateLanguage = "en";

function badgeFor(phase: Phase, status: WorkerStatus | null): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading") return { tone: "info", label: "Checking…", pulse: true };
  if (phase === "error" || !status) return { tone: "muted", label: "Status unknown", pulse: false };
  return canRunTranslate(status)
    ? { tone: "ok", label: "Secure worker", pulse: false }
    : { tone: "muted", label: "Not enabled", pulse: false };
}

export function TranslateWorkerPanel({ tool }: { tool: Tool }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<WorkerStatus | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/worker/status", { headers: { accept: "application/json" } })
      .then((res) => (res.ok ? (res.json() as Promise<WorkerStatus>) : Promise.reject(new Error("unreachable"))))
      .then((next) => {
        if (!active) return;
        setStatus(next);
        setPhase("ready");
        track({ name: "worker_status_checked", mode: next.mode, enabled: next.enabled });
      })
      .catch(() => {
        if (active) setPhase("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const badge = badgeFor(phase, status);
  const available = phase === "ready" && canRunTranslate(status);
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
              AI translation
            </span>
            <StatusBadge tone={badge.tone} label={badge.label} pulse={badge.pulse} />
          </div>
          <h2 className="text-lg font-semibold text-white">{tool.name} runs on an encrypted secure worker</h2>
          <p className="text-sm leading-relaxed text-slate-400">
            The worker extracts your PDF&apos;s selectable text and asks a configured AI model to translate only that
            text into your target language, then returns a translation package — Markdown, plain text, and a manifest
            recording the model and scope. It produces translated text (not a layout-preserving PDF) and never fabricates
            a translation: with no AI model configured, or a scanned PDF with no selectable text, it fails honestly
            instead of guessing.
          </p>
        </div>

        {available ? (
          <TranslateBuilder />
        ) : (
          <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm leading-relaxed text-slate-300">{unavailableDetail}</p>
            <p className="text-xs leading-relaxed text-slate-500">
              No builder is shown until the worker is ready, so {tool.name} never pretends to produce a translation it
              cannot actually generate.
            </p>
            <NotifyMe toolName={tool.name} toolSlug={tool.slug} />
          </div>
        )}

        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">What happens</h3>
          <ol className="flex flex-col gap-1">
            {WORKER_PIPELINE_STAGES.map((stage, index) => (
              <li key={stage.id} className="flex items-start gap-3">
                <div className="flex flex-col items-center self-stretch">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-300">
                    <Sparkles className="size-4" aria-hidden />
                  </span>
                  {index < WORKER_PIPELINE_STAGES.length - 1 && <span className="my-1 w-px flex-1 bg-white/10" aria-hidden />}
                </div>
                <div className="flex flex-col gap-0.5 pb-3">
                  <span className="text-sm font-medium text-slate-200">
                    {index + 1}. {stage.title}
                  </span>
                  <span className="text-xs leading-relaxed text-slate-500">{stage.description}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-surface-2 px-4 py-1">
          <SpecRow icon={Download} label="Output" value="ZIP · translation.md + translation.txt + manifest" />
          <SpecRow icon={Timer} label="Retention" value={`Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`} />
          <SpecRow icon={ShieldCheck} label="Limit" value={`${formatBytes(JOB_LIMITS.maxFileBytes)}/file`} />
        </div>
      </div>
    </div>
  );
}

function SpecRow({ icon: Icon, label, value }: { icon: typeof Download; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="inline-flex items-center gap-2 text-sm text-slate-400">
        <Icon className="size-4 text-slate-500" aria-hidden />
        {label}
      </span>
      <span className="text-right text-sm font-medium text-slate-200">{value}</span>
    </div>
  );
}

function TranslateBuilder() {
  const [file, setFile] = useState<File | null>(null);
  const [targetLanguage, setTargetLanguage] = useState<TranslateLanguage>(DEFAULT_TARGET);
  const [sourceLanguage, setSourceLanguage] = useState<TranslateSourceLanguage>(DEFAULT_TRANSLATE_SOURCE);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<TranslateWorkerResult | null>(null);

  const canRun = file != null && !busy;

  const start = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setOutcome(null);
    const trimmed = instructions.trim();
    const result = await runWorkerTranslate({
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      targetLanguage,
      sourceLanguage,
      ...(trimmed ? { instructions: trimmed } : {}),
    });
    setOutcome(result);
    setBusy(false);
  }, [file, targetLanguage, sourceLanguage, instructions]);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-violet-400/25 bg-violet-500/[0.06] p-4">
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-violet-100/90">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Running this uses a private secure-worker job. The worker translates only the PDF&apos;s selectable text with a
        configured AI model — it does not read scanned images (run OCR first) and does not invent content.
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
        <Dropzone onFiles={(files) => setFile(files[0] ?? null)} accept="application/pdf,.pdf" multiple={false} compact title="Add your PDF, or" hint="PDF with selectable text to translate" />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Translate into
          <select
            value={targetLanguage}
            onChange={(e) => setTargetLanguage(e.target.value as TranslateLanguage)}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-violet-400/50"
          >
            {TRANSLATE_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_NAMES[code]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Source language
          <select
            value={sourceLanguage}
            onChange={(e) => setSourceLanguage(e.target.value as TranslateSourceLanguage)}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-violet-400/50"
          >
            <option value={TRANSLATE_SOURCE_AUTO}>Auto-detect</option>
            {TRANSLATE_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_NAMES[code]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400 sm:col-span-2">
          Instructions (optional)
          <input
            type="text"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value.slice(0, MAX_TRANSLATE_INSTRUCTIONS_CHARS))}
            maxLength={MAX_TRANSLATE_INSTRUCTIONS_CHARS}
            placeholder="e.g. keep product names in English, use a formal register"
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-400/50"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={start}
        disabled={!canRun}
        aria-busy={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-violet-400/40 bg-violet-500/15 px-6 py-2.5 text-sm font-semibold text-violet-100 transition hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:self-start"
      >
        {busy ? (
          <>
            <Spinner />
            Translating…
          </>
        ) : (
          <>
            <Languages className="size-4" aria-hidden />
            Translate PDF
          </>
        )}
      </button>

      {outcome?.ok === false && <ErrorNote message={outcome.message} />}
      {outcome?.ok === true && (
        <div className="flex flex-col gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.07] p-4">
          <p className="text-sm text-emerald-200">
            Your AI translation package is ready — the translation in Markdown and plain text, plus a manifest recording
            the model and honest scope.
          </p>
          <button
            type="button"
            onClick={() => downloadBytes(outcome.output, outcome.artifact.filename)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:brightness-110 sm:w-auto sm:self-start"
          >
            <Download className="size-4" aria-hidden />
            Download {outcome.artifact.filename}
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Plus, ScanSearch, ShieldCheck, Sparkles, Timer, Trash2 } from "lucide-react";
import { WORKER_PIPELINE_STAGES } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import {
  EXTRACTION_FIELD_TYPES,
  MAX_EXTRACTION_FIELDS,
  MAX_EXTRACTION_PROMPT_CHARS,
  MAX_FIELD_NAME_CHARS,
  type ExtractionField,
  type ExtractionFieldType,
  type ExtractionMode,
} from "@/lib/jobs/ai-extract";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  canRunAiExtract,
  runWorkerAiExtract,
  type AiExtractWorkerResult,
} from "@/lib/workers/ai-extract-client";
import { downloadBytes } from "@/lib/pdf/browser";
import { track } from "@/lib/telemetry/track";
import type { Tool } from "@/lib/tools/types";
import { formatBytes } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
import { Dropzone, ErrorNote, Spinner } from "./runner/runner-kit";
import { NotifyMe } from "./notify-me";

type Phase = "loading" | "error" | "ready";

function badgeFor(phase: Phase, status: WorkerStatus | null): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading") return { tone: "info", label: "Checking…", pulse: true };
  if (phase === "error" || !status) return { tone: "muted", label: "Status unknown", pulse: false };
  return canRunAiExtract(status)
    ? { tone: "ok", label: "Secure worker", pulse: false }
    : { tone: "muted", label: "Not enabled", pulse: false };
}

export function AiExtractWorkerPanel({ tool }: { tool: Tool }) {
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
  const available = phase === "ready" && canRunAiExtract(status);
  const unavailableDetail =
    phase === "loading"
      ? "Checking whether a secure worker is available…"
      : phase === "error"
        ? "The worker status endpoint could not be reached right now."
        : (status?.daemon.detail ?? "The secure worker is not drainable here.");

  return (
    <div className="gradient-border">
      <div className="glass flex flex-col gap-6 rounded-3xl p-5 sm:p-7">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-400/10 px-2.5 py-1 text-[11px] font-medium text-violet-200">
              <Sparkles className="size-3" aria-hidden />
              AI extraction
            </span>
            <StatusBadge tone={badge.tone} label={badge.label} pulse={badge.pulse} />
          </div>
          <h2 className="text-lg font-semibold text-white">{tool.name} runs on an encrypted secure worker</h2>
          <p className="text-sm leading-relaxed text-slate-400">
            The worker extracts your PDF&apos;s selectable text and asks a configured AI model to pull the fields you
            describe into clean JSON, then returns an extraction package — the model&apos;s JSON, a readable rendering,
            and a manifest recording the model and scope. It never fabricates data: with no AI model configured, a
            scanned PDF with no selectable text, or a model reply that isn&apos;t valid JSON, it fails honestly instead
            of guessing.
          </p>
        </div>

        {available ? (
          <AiExtractBuilder />
        ) : (
          <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm leading-relaxed text-slate-300">{unavailableDetail}</p>
            <p className="text-xs leading-relaxed text-slate-500">
              No builder is shown until the worker is ready, so {tool.name} never pretends to produce an extraction it
              cannot actually generate.
            </p>
            <NotifyMe toolName={tool.name} />
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
          <SpecRow icon={Download} label="Output" value="ZIP · extraction.json + extraction.md + manifest" />
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

const EMPTY_FIELD: ExtractionField = { name: "", type: "string" };

function AiExtractBuilder() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ExtractionMode>("schema");
  const [prompt, setPrompt] = useState("");
  const [fields, setFields] = useState<ExtractionField[]>([{ ...EMPTY_FIELD }]);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<AiExtractWorkerResult | null>(null);

  const namedFields = fields.filter((f) => f.name.trim().length > 0);
  const requestReady =
    mode === "prompt" ? prompt.trim().length > 0 : namedFields.length > 0;
  const canRun = file != null && !busy && requestReady;

  const start = useCallback(async () => {
    if (!file || !requestReady) return;
    setBusy(true);
    setOutcome(null);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await runWorkerAiExtract(
      mode === "prompt"
        ? { filename: file.name, bytes, mode: "prompt", prompt: prompt.trim() }
        : {
            filename: file.name,
            bytes,
            mode: "schema",
            schema: namedFields.map((f) => ({
              name: f.name.trim(),
              type: f.type,
              ...(f.description?.trim() ? { description: f.description.trim() } : {}),
            })),
          },
    );
    setOutcome(result);
    setBusy(false);
  }, [file, mode, prompt, namedFields, requestReady]);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-violet-400/25 bg-violet-500/[0.06] p-4">
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-violet-100/90">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Running this uses a private secure-worker job. The worker extracts only the PDF&apos;s selectable text with a
        configured AI model — it does not read scanned images (run OCR first) and never invents values.
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
        <Dropzone onFiles={(files) => setFile(files[0] ?? null)} accept="application/pdf,.pdf" multiple={false} compact title="Add your PDF, or" hint="PDF with selectable text to extract from" />
      )}

      <div className="inline-flex gap-1 self-start rounded-full border border-white/10 bg-white/[0.03] p-1 text-xs">
        <ModeTab active={mode === "schema"} onClick={() => setMode("schema")} label="Field schema" />
        <ModeTab active={mode === "prompt"} onClick={() => setMode("prompt")} label="Prompt" />
      </div>

      {mode === "prompt" ? (
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          What to extract
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, MAX_EXTRACTION_PROMPT_CHARS))}
            maxLength={MAX_EXTRACTION_PROMPT_CHARS}
            rows={3}
            placeholder="e.g. Extract the invoice number, issue date, vendor name, and grand total."
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-400/50"
          />
        </label>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-slate-400">Fields to extract</span>
          {fields.map((field, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={field.name}
                onChange={(e) => {
                  const name = e.target.value.slice(0, MAX_FIELD_NAME_CHARS);
                  setFields((prev) => prev.map((f, j) => (j === i ? { ...f, name } : f)));
                }}
                placeholder="field name (e.g. total)"
                className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-400/50"
              />
              <select
                value={field.type}
                onChange={(e) => {
                  const type = e.target.value as ExtractionFieldType;
                  setFields((prev) => prev.map((f, j) => (j === i ? { ...f, type } : f)));
                }}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-violet-400/50"
              >
                {EXTRACTION_FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setFields((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))}
                disabled={fields.length <= 1}
                aria-label="Remove field"
                className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 text-slate-400 transition hover:text-white disabled:opacity-40"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setFields((prev) => (prev.length < MAX_EXTRACTION_FIELDS ? [...prev, { ...EMPTY_FIELD }] : prev))}
            disabled={fields.length >= MAX_EXTRACTION_FIELDS}
            className="inline-flex items-center gap-1.5 self-start rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:text-white disabled:opacity-40"
          >
            <Plus className="size-3.5" aria-hidden />
            Add field
          </button>
        </div>
      )}

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
            Extracting…
          </>
        ) : (
          <>
            <ScanSearch className="size-4" aria-hidden />
            Extract data
          </>
        )}
      </button>

      {outcome?.ok === false && <ErrorNote message={outcome.message} />}
      {outcome?.ok === true && (
        <div className="flex flex-col gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.07] p-4">
          <p className="text-sm text-emerald-200">
            Your AI extraction package is ready — the extracted data as JSON, a readable rendering, plus a manifest
            recording the model and honest scope.
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

function ModeTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 font-medium transition ${
        active ? "bg-violet-500/25 text-violet-100" : "text-slate-400 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

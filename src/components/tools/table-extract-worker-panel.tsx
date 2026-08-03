"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, ShieldCheck, Table, Timer } from "lucide-react";
import { workerPipelineStages } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  canRunTableExtract,
  runWorkerTableExtract,
  type TableExtractWorkerResult,
} from "@/lib/workers/table-extract-client";
import { downloadBytes } from "@/lib/pdf/browser";
import { track } from "@/lib/telemetry/track";
import type { Tool } from "@/lib/tools/types";
import { formatBytes } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
import { Dropzone, ErrorNote, ResultCard, Spinner } from "./runner/runner-kit";
import { NotifyMe } from "./notify-me";

type Phase = "loading" | "error" | "ready";

function badgeFor(phase: Phase, status: WorkerStatus | null): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading") return { tone: "info", label: "Checking…", pulse: true };
  if (phase === "error" || !status) return { tone: "muted", label: "Status unknown", pulse: false };
  return canRunTableExtract(status) ? { tone: "ok", label: "Secure worker", pulse: false } : { tone: "muted", label: "Not enabled", pulse: false };
}

export function TableExtractWorkerPanel({ tool }: { tool: Tool }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<WorkerStatus | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/worker/status", { headers: { accept: "application/json" } })
      .then((res) => res.ok ? (res.json() as Promise<WorkerStatus>) : Promise.reject(new Error("unreachable")))
      .then((next) => {
        if (!active) return;
        setStatus(next);
        setPhase("ready");
        track({ name: "worker_status_checked", mode: next.mode, enabled: next.enabled });
      })
      .catch(() => { if (active) setPhase("error"); });
    return () => { active = false; };
  }, []);

  const badge = badgeFor(phase, status);
  const available = phase === "ready" && canRunTableExtract(status);
  const unavailableDetail = phase === "loading"
    ? "Checking whether a secure worker is available…"
    : phase === "error"
      ? "The worker status endpoint could not be reached right now."
      : (status?.daemon.detail ?? "The secure worker is not drainable here.");

  return (
    <div className="gradient-border">
      <div className="glass flex flex-col gap-6 rounded-3xl p-5 sm:p-7">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/30 bg-blue-400/10 px-2.5 py-1 text-[11px] font-medium text-blue-200">
              <Table className="size-3" aria-hidden />
              Table detection
            </span>
            <StatusBadge tone={badge.tone} label={badge.label} pulse={badge.pulse} />
          </div>
          <h2 className="text-lg font-semibold text-white">{tool.name} runs on an encrypted secure worker</h2>
          <p className="text-sm leading-relaxed text-slate-400">
            The worker reads the PDF&rsquo;s selectable text with its page positions, detects aligned table grids, and returns a ZIP of CSV files plus a combined Excel workbook. Scanned PDFs and PDFs without tables fail honestly.
          </p>
        </div>

        {available ? (
          <TableExtractRunArea />
        ) : (
          <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm leading-relaxed text-slate-300">{unavailableDetail}</p>
            <p className="text-xs leading-relaxed text-slate-500">
              No runner is shown until the worker is ready, so {tool.name} never pretends to detect tables it cannot actually extract.
            </p>
            <NotifyMe toolName={tool.name} toolSlug={tool.slug} />
          </div>
        )}

        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">What happens</h3>
          <ol className="flex flex-col gap-1">
            {workerPipelineStages(status?.scan.active ?? false).map((stage, index, all) => (
              <li key={stage.id} className="flex items-start gap-3">
                <div className="flex flex-col items-center self-stretch">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-300"><Table className="size-4" aria-hidden /></span>
                  {index < all.length - 1 && <span className="my-1 w-px flex-1 bg-white/10" aria-hidden />}
                </div>
                <div className="flex flex-col gap-0.5 pb-3">
                  <span className="text-sm font-medium text-slate-200">{index + 1}. {stage.title}</span>
                  <span className="text-xs leading-relaxed text-slate-500">{stage.description}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-surface-2 px-4 py-1">
          <SpecRow icon={Download} label="Output" value="ZIP · CSV + XLSX" />
          <SpecRow icon={Timer} label="Retention" value={`Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`} />
          <SpecRow icon={ShieldCheck} label="Limit" value={`${formatBytes(JOB_LIMITS.maxFileBytes)}/file`} />
        </div>
      </div>
    </div>
  );
}

function SpecRow({ icon: Icon, label, value }: { icon: typeof Download; label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 py-2.5"><span className="inline-flex items-center gap-2 text-sm text-slate-400"><Icon className="size-4 text-slate-500" aria-hidden />{label}</span><span className="text-right text-sm font-medium text-slate-200">{value}</span></div>;
}

function TableExtractRunArea() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<TableExtractWorkerResult | null>(null);
  const start = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setOutcome(null);
    const result = await runWorkerTableExtract({ filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    setOutcome(result);
    setBusy(false);
  }, [file]);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-blue-400/25 bg-blue-500/[0.06] p-4">
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-blue-100/90">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Running this uses a private secure-worker job. Only aligned tables in selectable text are extracted; scanned/image-only PDFs need OCR first.
      </p>
      {file ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200">
          <span className="truncate">{file.name}</span>
          <button type="button" onClick={() => { setFile(null); setOutcome(null); }} className="shrink-0 text-xs font-medium text-slate-400 transition hover:text-white">Remove</button>
        </div>
      ) : (
        <Dropzone onFiles={(files) => setFile(files[0] ?? null)} accept="application/pdf,.pdf" multiple={false} compact title="Add your PDF, or" hint="Selectable PDF" />
      )}
      <button type="button" onClick={start} disabled={busy || !file} aria-busy={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-blue-400/40 bg-blue-500/15 px-6 py-2.5 text-sm font-semibold text-blue-100 transition hover:bg-blue-500/25 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:self-start">
        {busy ? <><Spinner />Extracting tables…</> : <><Table className="size-4" aria-hidden />Extract tables</>}
      </button>
      {outcome?.ok === false && <ErrorNote message={outcome.message} />}
      {outcome?.ok === true && (
        <ResultCard announce="Your tables are ready as a ZIP of CSV files plus a combined Excel workbook.">
          <p className="text-sm text-emerald-200">Your tables are ready as a ZIP of CSV files plus a combined Excel workbook.</p>
          <button type="button" onClick={() => downloadBytes(outcome.output, outcome.artifact.filename)} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:brightness-110 sm:w-auto sm:self-start"><Download className="size-4" aria-hidden />Download {outcome.artifact.filename}</button>
        </ResultCard>
      )}
    </div>
  );
}

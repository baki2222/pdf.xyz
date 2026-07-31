"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FileText, ShieldCheck, Timer } from "lucide-react";
import { WORKER_PIPELINE_STAGES } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  canRunPdfOfficeExport,
  runWorkerPdfOfficeExport,
  type PdfOfficeExportWorkerResult,
} from "@/lib/workers/pdf-office-export-client";
import { downloadBytes } from "@/lib/pdf/browser";
import { track } from "@/lib/telemetry/track";
import type { Tool } from "@/lib/tools/types";
import { formatBytes } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
import { Dropzone, ErrorNote, Spinner } from "./runner/runner-kit";
import { NotifyMe } from "./notify-me";

type PdfOfficeTool = "pdf-to-word" | "pdf-to-excel" | "pdf-to-powerpoint";
type Phase = "loading" | "error" | "ready";

function isPdfOfficeTool(slug: string): slug is PdfOfficeTool {
  return slug === "pdf-to-word" || slug === "pdf-to-excel" || slug === "pdf-to-powerpoint";
}

function extensionFor(slug: PdfOfficeTool): string {
  if (slug === "pdf-to-word") return "DOCX";
  if (slug === "pdf-to-excel") return "XLSX";
  return "PPTX";
}

function badgeFor(phase: Phase, status: WorkerStatus | null): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading") return { tone: "info", label: "Checking…", pulse: true };
  if (phase === "error" || !status) return { tone: "muted", label: "Status unknown", pulse: false };
  return canRunPdfOfficeExport(status) ? { tone: "ok", label: "Secure worker", pulse: false } : { tone: "muted", label: "Not enabled", pulse: false };
}

export function PdfOfficeExportWorkerPanel({ tool }: { tool: Tool }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const officeTool: PdfOfficeTool = isPdfOfficeTool(tool.slug) ? tool.slug : "pdf-to-word";

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
  const available = phase === "ready" && canRunPdfOfficeExport(status) && isPdfOfficeTool(tool.slug);
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
              <FileText className="size-3" aria-hidden />
              Selectable text export
            </span>
            <StatusBadge tone={badge.tone} label={badge.label} pulse={badge.pulse} />
          </div>
          <h2 className="text-lg font-semibold text-white">{tool.name} runs on an encrypted secure worker</h2>
          <p className="text-sm leading-relaxed text-slate-400">
            The worker extracts selectable PDF text and packages it into a real {extensionFor(officeTool)} file. Scanned PDFs fail honestly and should be OCR’d first.
          </p>
        </div>

        {available ? (
          <PdfOfficeRunArea tool={officeTool} output={extensionFor(officeTool)} />
        ) : (
          <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm leading-relaxed text-slate-300">{unavailableDetail}</p>
            <p className="text-xs leading-relaxed text-slate-500">
              No runner is shown until the worker is ready, so {tool.name} never pretends to process input it cannot actually convert.
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
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-300"><FileText className="size-4" aria-hidden /></span>
                  {index < WORKER_PIPELINE_STAGES.length - 1 && <span className="my-1 w-px flex-1 bg-white/10" aria-hidden />}
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
          <SpecRow icon={Download} label="Output" value={extensionFor(officeTool)} />
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

function PdfOfficeRunArea({ tool, output }: { tool: PdfOfficeTool; output: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<PdfOfficeExportWorkerResult | null>(null);
  const start = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setOutcome(null);
    const result = await runWorkerPdfOfficeExport({ tool, filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    setOutcome(result);
    setBusy(false);
  }, [file, tool]);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-blue-400/25 bg-blue-500/[0.06] p-4">
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-blue-100/90">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Running this uses a private secure-worker job. Only selectable text is exported; scanned/image-only PDFs need OCR first.
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
        {busy ? <><Spinner />Exporting {output}…</> : <><FileText className="size-4" aria-hidden />Export {output}</>}
      </button>
      {outcome?.ok === false && <ErrorNote message={outcome.message} />}
      {outcome?.ok === true && (
        <div className="flex flex-col gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.07] p-4">
          <p className="text-sm text-emerald-200">Your {output} file is ready.</p>
          <button type="button" onClick={() => downloadBytes(outcome.output, outcome.artifact.filename)} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:brightness-110 sm:w-auto sm:self-start"><Download className="size-4" aria-hidden />Download {outcome.artifact.filename}</button>
        </div>
      )}
    </div>
  );
}

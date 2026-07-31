"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, Download, FileDown, FileUp, ShieldCheck, Timer } from "lucide-react";
import { WORKER_PIPELINE_STAGES } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import type { WorkerStatus } from "@/lib/workers/status";
import { canRunPdfArchive, runWorkerPdfToPdfA, type PdfArchiveWorkerResult } from "@/lib/workers/pdf-archive-client";
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
  if (canRunPdfArchive(status)) {
    return status.mode === "local-dev"
      ? { tone: "warn", label: "Local-dev worker", pulse: true }
      : { tone: "ok", label: "Secure worker", pulse: false };
  }
  return { tone: "muted", label: "Not enabled", pulse: false };
}

function SpecRow({ icon: Icon, label, value }: { icon: typeof FileUp; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="inline-flex items-center gap-2 text-sm text-slate-400"><Icon className="size-4 text-slate-500" aria-hidden />{label}</span>
      <span className="text-right text-sm font-medium text-slate-200">{value}</span>
    </div>
  );
}

export function PdfArchiveWorkerPanel({ tool }: { tool: Tool }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/worker/status", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? (r.json() as Promise<WorkerStatus>) : Promise.reject(new Error("unreachable"))))
      .then((s) => {
        if (!active) return;
        setStatus(s);
        setPhase("ready");
        track({ name: "worker_status_checked", mode: s.mode, enabled: s.enabled });
      })
      .catch(() => { if (active) setPhase("error"); });
    return () => { active = false; };
  }, []);

  const badge = badgeFor(phase, status);
  const available = phase === "ready" && canRunPdfArchive(status);

  return (
    <div className="gradient-border">
      <div className="glass flex flex-col gap-6 rounded-3xl p-5 sm:p-7">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/30 bg-blue-400/10 px-2.5 py-1 text-[11px] font-medium text-blue-200"><Archive className="size-3" aria-hidden />Secure-worker PDF/A</span>
            <StatusBadge tone={badge.tone} label={badge.label} pulse={badge.pulse} />
          </div>
          <h2 className="text-lg font-semibold text-white">{tool.name} runs on an encrypted secure worker</h2>
          <p className="text-sm leading-relaxed text-slate-400">PDF/A conversion uses Ghostscript on the isolated worker to create an archive-oriented PDF/A-2b file. It produces a real PDF output or fails honestly — no browser placeholder and no fabricated compliance claim.</p>
        </div>

        {available && status ? <ArchiveRunArea localDevOnly={status.localDevOnly} /> : <ArchiveUnavailable phase={phase} status={status} />}

        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">What happens to your file</h3>
          <ol className="flex flex-col gap-1">
            {WORKER_PIPELINE_STAGES.map((stage, i) => (
              <li key={stage.id} className="flex items-start gap-3">
                <div className="flex flex-col items-center self-stretch"><span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-300"><Archive className="size-4" aria-hidden /></span>{i < WORKER_PIPELINE_STAGES.length - 1 && <span className="my-1 w-px flex-1 bg-white/10" aria-hidden />}</div>
                <div className="flex flex-col gap-0.5 pb-3"><span className="text-sm font-medium text-slate-200">{i + 1}. {stage.title}</span><span className="text-xs leading-relaxed text-slate-500">{stage.description}</span></div>
              </li>
            ))}
          </ol>
        </div>

        <div className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-surface-2 px-4 py-1">
          <SpecRow icon={FileUp} label="Input" value="One PDF" />
          <SpecRow icon={FileDown} label="Output" value="PDF/A-2b PDF" />
          <SpecRow icon={Timer} label="Retention" value={`Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`} />
          <SpecRow icon={ShieldCheck} label="Limit" value={`${formatBytes(JOB_LIMITS.maxFileBytes)}/file`} />
        </div>
      </div>
    </div>
  );
}

function ArchiveUnavailable({ phase, status }: { phase: Phase; status: WorkerStatus | null }) {
  const detail = phase === "loading" ? "Checking whether a secure worker is available…" : phase === "error" ? "The worker status endpoint could not be reached right now." : status?.daemon.detail ?? "The secure worker is not drainable here.";
  return <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-sm leading-relaxed text-slate-300">{detail}</p><p className="text-xs leading-relaxed text-slate-500">No uploader is shown until the worker is ready, so PDF/A conversion never pretends to process a file it cannot actually run.</p><NotifyMe toolName="PDF to PDF/A" toolSlug="pdf-to-pdfa" /></div>;
}

function ArchiveRunArea({ localDevOnly }: { localDevOnly: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<PdfArchiveWorkerResult | null>(null);
  const start = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setOutcome(null);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await runWorkerPdfToPdfA({ filename: file.name, bytes });
    setOutcome(result);
    setBusy(false);
  }, [file]);
  return <div className="flex flex-col gap-4 rounded-2xl border border-blue-400/25 bg-blue-500/[0.06] p-4"><p className="flex items-start gap-1.5 text-xs leading-relaxed text-blue-100/90"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />{localDevOnly ? "This runs on your local-dev worker on this machine." : "Running this uploads your file to the encrypted secure worker, converts it with Ghostscript, and wipes the input after processing."}</p>{file ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200"><span className="truncate">{file.name}</span><button type="button" onClick={() => { setFile(null); setOutcome(null); }} className="shrink-0 text-xs font-medium text-slate-400 transition hover:text-white">Remove</button></div> : <Dropzone onFiles={(files) => setFile(files[0] ?? null)} accept="application/pdf" multiple={false} compact title="Add a PDF, or" hint="PDF" />}<button type="button" onClick={start} disabled={!file || busy} aria-busy={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-blue-400/40 bg-blue-500/15 px-6 py-2.5 text-sm font-semibold text-blue-100 transition hover:bg-blue-500/25 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:self-start">{busy ? <><Spinner />Converting to PDF/A…</> : <><Archive className="size-4" aria-hidden />Convert to PDF/A</>}</button>{outcome?.ok === false && <ErrorNote message={outcome.message} />}{outcome?.ok === true && <div className="flex flex-col gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.07] p-4"><p className="text-sm text-emerald-200">Your PDF/A file is ready.</p><button type="button" onClick={() => downloadBytes(outcome.output, outcome.artifact.filename)} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:brightness-110 sm:w-auto sm:self-start"><Download className="size-4" aria-hidden />Download {outcome.artifact.filename}</button></div>}</div>;
}

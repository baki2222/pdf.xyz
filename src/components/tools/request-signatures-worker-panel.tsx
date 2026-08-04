"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, PenLine, Plus, ShieldCheck, Timer, Trash2, Users } from "lucide-react";
import { workerPipelineStages } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import {
  MAX_REQUEST_SIGNERS,
  type RequestSignatureField,
  type RequestSignatureRouting,
} from "@/lib/jobs/request-signatures";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  canRunRequestSignatures,
  runWorkerRequestSignatures,
  type RequestSignaturesWorkerResult,
} from "@/lib/workers/request-signatures-client";
import { downloadBytes } from "@/lib/pdf/browser";
import { track } from "@/lib/telemetry/track";
import type { Tool } from "@/lib/tools/types";
import { formatBytes } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
import { Dropzone, ErrorNote, ResultCard, Spinner } from "./runner/runner-kit";
import { NotifyMe } from "./notify-me";

type Phase = "loading" | "error" | "ready";

interface SignerDraft {
  name: string;
  email: string;
}

function badgeFor(phase: Phase, status: WorkerStatus | null): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading") return { tone: "info", label: "Checking…", pulse: true };
  if (phase === "error" || !status) return { tone: "muted", label: "Status unknown", pulse: false };
  return canRunRequestSignatures(status)
    ? { tone: "ok", label: "Secure worker", pulse: false }
    : { tone: "muted", label: "Not enabled", pulse: false };
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Turn the draft signers into real placed fields: one signature field per signer
 * (plus an optional date field), laid out as a stacked signature block near the
 * bottom of the target page in fractional (0..1) coordinates. Deterministic and
 * always in-bounds, so the request the worker receives validates.
 */
function buildFields(
  signerCount: number,
  page: number,
  includeDate: boolean,
): RequestSignatureField[] {
  const fields: RequestSignatureField[] = [];
  const rowHeight = Math.min(0.11, 0.6 / Math.max(1, signerCount));
  const boxHeight = rowHeight * 0.55;
  for (let i = 0; i < signerCount; i += 1) {
    const y = 0.06 + i * rowHeight;
    fields.push({ signer: i, page, type: "signature", x: 0.08, y, width: 0.4, height: boxHeight, required: true });
    if (includeDate) {
      fields.push({ signer: i, page, type: "date", x: 0.56, y, width: 0.22, height: boxHeight, required: true });
    }
  }
  return fields;
}

export function RequestSignaturesWorkerPanel({ tool }: { tool: Tool }) {
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
  const available = phase === "ready" && canRunRequestSignatures(status);
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
              <PenLine className="size-3" aria-hidden />
              Signature request
            </span>
            <StatusBadge tone={badge.tone} label={badge.label} pulse={badge.pulse} />
          </div>
          <h2 className="text-lg font-semibold text-white">{tool.name} runs on an encrypted secure worker</h2>
          <p className="text-sm leading-relaxed text-slate-400">
            The worker adds real fillable fields for each signer and returns a signature-request package — the prepared
            PDF, a manifest, and an audit trail. It prepares and records the request; it never fabricates a signed
            document, and legally-binding delivery to external signers needs a configured e-signature provider.
          </p>
        </div>

        {available ? (
          <RequestBuilder />
        ) : (
          <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm leading-relaxed text-slate-300">{unavailableDetail}</p>
            <p className="text-xs leading-relaxed text-slate-500">
              No builder is shown until the worker is ready, so {tool.name} never pretends to prepare a request it
              cannot actually package.
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
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-300">
                    <PenLine className="size-4" aria-hidden />
                  </span>
                  {index < all.length - 1 && <span className="my-1 w-px flex-1 bg-white/10" aria-hidden />}
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
          <SpecRow icon={Download} label="Output" value="ZIP · prepared PDF + manifest" />
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

function RequestBuilder() {
  const [file, setFile] = useState<File | null>(null);
  const [signers, setSigners] = useState<SignerDraft[]>([{ name: "", email: "" }]);
  const [routing, setRouting] = useState<RequestSignatureRouting>("sequential");
  const [page, setPage] = useState(1);
  const [includeDate, setIncludeDate] = useState(true);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RequestSignaturesWorkerResult | null>(null);

  const cleanSigners = useMemo(
    () =>
      signers
        .map((s) => ({ name: s.name.trim(), email: s.email.trim() }))
        .filter((s) => s.name.length > 0 && EMAIL_SHAPE.test(s.email)),
    [signers],
  );
  const canRun = file != null && cleanSigners.length > 0 && !busy;

  const updateSigner = useCallback((index: number, patch: Partial<SignerDraft>) => {
    setSigners((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }, []);
  const addSigner = useCallback(() => {
    setSigners((prev) => (prev.length >= MAX_REQUEST_SIGNERS ? prev : [...prev, { name: "", email: "" }]));
  }, []);
  const removeSigner = useCallback((index: number) => {
    setSigners((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }, []);

  const start = useCallback(async () => {
    if (!file || cleanSigners.length === 0) return;
    setBusy(true);
    setOutcome(null);
    const fields = buildFields(cleanSigners.length, page, includeDate);
    const result = await runWorkerRequestSignatures({
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      signers: cleanSigners,
      fields,
      routing,
      ...(title.trim() ? { title: title.trim() } : {}),
    });
    setOutcome(result);
    setBusy(false);
  }, [file, cleanSigners, page, includeDate, routing, title]);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-violet-400/25 bg-violet-500/[0.06] p-4">
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-violet-100/90">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Running this uses a private secure-worker job. The worker prepares the PDF with real fillable fields and packages
        the request — it does not collect or certify signatures.
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
        <Dropzone onFiles={(files) => setFile(files[0] ?? null)} accept="application/pdf,.pdf" multiple={false} compact title="Add your PDF, or" hint="PDF to send for signature" />
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-slate-500">
            <Users className="size-3.5" aria-hidden />
            Signers
          </span>
          <button
            type="button"
            onClick={addSigner}
            disabled={signers.length >= MAX_REQUEST_SIGNERS}
            className="inline-flex items-center gap-1 text-xs font-medium text-violet-300 transition hover:text-violet-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="size-3.5" aria-hidden />
            Add signer
          </button>
        </div>
        {signers.map((signer, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-violet-500/20 text-xs font-semibold text-violet-200">{index + 1}</span>
            <input
              type="text"
              value={signer.name}
              onChange={(e) => updateSigner(index, { name: e.target.value })}
              placeholder="Full name"
              aria-label={`Signer ${index + 1} name`}
              className="min-w-[8rem] flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-400/50"
            />
            <input
              type="email"
              value={signer.email}
              onChange={(e) => updateSigner(index, { email: e.target.value })}
              placeholder="email@company.com"
              aria-label={`Signer ${index + 1} email`}
              className="min-w-[10rem] flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-400/50"
            />
            <button
              type="button"
              onClick={() => removeSigner(index)}
              disabled={signers.length <= 1}
              aria-label={`Remove signer ${index + 1}`}
              className="shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Signing order
          <select
            value={routing}
            onChange={(e) => setRouting(e.target.value as RequestSignatureRouting)}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-violet-400/50"
          >
            <option value="sequential">Sequential — one at a time</option>
            <option value="parallel">Parallel — everyone at once</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Signature page
          <input
            type="number"
            min={1}
            value={page}
            onChange={(e) => setPage(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-violet-400/50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400 sm:col-span-2">
          Request title (optional)
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Master Services Agreement"
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-400/50"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300 sm:col-span-2">
          <input type="checkbox" checked={includeDate} onChange={(e) => setIncludeDate(e.target.checked)} className="size-4 rounded border-white/20 bg-white/[0.04]" />
          Add a date field next to each signature
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
            Preparing request…
          </>
        ) : (
          <>
            <PenLine className="size-4" aria-hidden />
            Prepare signature request
          </>
        )}
      </button>

      {outcome?.ok === false && <ErrorNote message={outcome.message} />}
      {outcome?.ok === true && (
        <ResultCard announce="Your signature-request package is ready.">
          <p className="text-sm text-emerald-200">
            Your signature-request package is ready — the prepared PDF with fillable fields, a manifest, and an audit
            trail.
          </p>
          <button
            type="button"
            onClick={() => downloadBytes(outcome.output, outcome.artifact.filename)}
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

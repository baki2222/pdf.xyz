"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  PenLine,
  Plus,
  ShieldCheck,
  Timer,
  Trash2,
  Users,
} from "lucide-react";
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
import {
  Dropzone,
  ErrorNote,
  ResultCard,
  WorkerRunButton,
} from "./runner/runner-kit";
import { NotifyMe } from "./notify-me";

type Phase = "loading" | "error" | "ready";

interface SignerDraft {
  name: string;
  email: string;
}

function badgeFor(
  phase: Phase,
  status: WorkerStatus | null,
): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading")
    return { tone: "info", label: "Checking…", pulse: true };
  if (phase === "error" || !status)
    return { tone: "muted", label: "Status unknown", pulse: false };
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
    fields.push({
      signer: i,
      page,
      type: "signature",
      x: 0.08,
      y,
      width: 0.4,
      height: boxHeight,
      required: true,
    });
    if (includeDate) {
      fields.push({
        signer: i,
        page,
        type: "date",
        x: 0.56,
        y,
        width: 0.22,
        height: boxHeight,
        required: true,
      });
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
  const available = phase === "ready" && canRunRequestSignatures(status);
  const unavailableDetail =
    phase === "loading"
      ? "Checking whether a secure worker is available…"
      : phase === "error"
        ? "The worker status endpoint could not be reached right now."
        : (status?.daemon.detail ?? "The secure worker is not drainable here.");

  return (
    <div className="">
      <div className="border-line bg-panel flex flex-col gap-6 rounded-[4px] border p-5 sm:p-7">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="border-accent/40 bg-accent/10 text-accent inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium">
              <PenLine className="size-3" aria-hidden />
              Signature request
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
            The worker adds real fillable fields for each signer and returns a
            signature-request package — the prepared PDF, a manifest, and an
            audit trail. It prepares and records the request; it never
            fabricates a signed document, and legally-binding delivery to
            external signers needs a configured e-signature provider.
          </p>
        </div>

        {available ? (
          <RequestBuilder />
        ) : (
          <div className="border-line bg-wash flex flex-col gap-3 rounded-[4px] border p-4">
            <p className="text-muted text-sm leading-relaxed">
              {unavailableDetail}
            </p>
            <p className="text-muted text-xs leading-relaxed">
              No builder is shown until the worker is ready, so {tool.name}{" "}
              never pretends to prepare a request it cannot actually package.
            </p>
            <NotifyMe toolName={tool.name} toolSlug={tool.slug} />
          </div>
        )}

        <div className="flex flex-col gap-3">
          <h3 className="text-faint font-mono text-xs font-medium tracking-[0.18em] uppercase">
            What happens
          </h3>
          <ol className="flex flex-col gap-1">
            {workerPipelineStages(status?.scan.active ?? false).map(
              (stage, index, all) => (
                <li key={stage.id} className="flex items-start gap-3">
                  <div className="flex flex-col items-center self-stretch">
                    <span className="border-line bg-wash text-muted grid size-8 shrink-0 place-items-center rounded-full border">
                      <PenLine className="size-4" aria-hidden />
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

        <div className="bg-panel border-line divide-y divide-white/5 rounded-[4px] border px-4 py-1">
          <SpecRow
            icon={Download}
            label="Output"
            value="ZIP · prepared PDF + manifest"
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
      <span className="text-muted inline-flex items-center gap-2 text-sm">
        <Icon className="text-muted size-4" aria-hidden />
        {label}
      </span>
      <span className="text-fg text-right text-sm font-medium">{value}</span>
    </div>
  );
}

function RequestBuilder() {
  const [file, setFile] = useState<File | null>(null);
  const [signers, setSigners] = useState<SignerDraft[]>([
    { name: "", email: "" },
  ]);
  const [routing, setRouting] = useState<RequestSignatureRouting>("sequential");
  const [page, setPage] = useState(1);
  const [includeDate, setIncludeDate] = useState(true);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RequestSignaturesWorkerResult | null>(
    null,
  );

  const cleanSigners = useMemo(
    () =>
      signers
        .map((s) => ({ name: s.name.trim(), email: s.email.trim() }))
        .filter((s) => s.name.length > 0 && EMAIL_SHAPE.test(s.email)),
    [signers],
  );
  const canRun = file != null && cleanSigners.length > 0 && !busy;

  const updateSigner = useCallback(
    (index: number, patch: Partial<SignerDraft>) => {
      setSigners((prev) =>
        prev.map((s, i) => (i === index ? { ...s, ...patch } : s)),
      );
    },
    [],
  );
  const addSigner = useCallback(() => {
    setSigners((prev) =>
      prev.length >= MAX_REQUEST_SIGNERS
        ? prev
        : [...prev, { name: "", email: "" }],
    );
  }, []);
  const removeSigner = useCallback((index: number) => {
    setSigners((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== index),
    );
  }, []);

  const start = useCallback(async () => {
    if (!file || cleanSigners.length === 0) return;
    setBusy(true);
    try {
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
  }, [file, cleanSigners, page, includeDate, routing, title]);

  return (
    <div className="border-accent/40 bg-accent/10 flex flex-col gap-4 rounded-[4px] border p-4">
      <p className="text-accent flex items-start gap-1.5 text-xs leading-relaxed">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Running this uses a private secure-worker job. The worker prepares the
        PDF with real fillable fields and packages the request — it does not
        collect or certify signatures.
      </p>

      {file ? (
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
      ) : (
        <Dropzone
          onFiles={(files) => setFile(files[0] ?? null)}
          accept="application/pdf,.pdf"
          multiple={false}
          compact
          title="Add your PDF, or"
          hint="PDF to send for signature"
        />
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-faint inline-flex items-center gap-1.5 font-mono text-xs font-medium tracking-[0.18em] uppercase">
            <Users className="size-3.5" aria-hidden />
            Signers
          </span>
          <button
            type="button"
            onClick={addSigner}
            aria-disabled={signers.length >= MAX_REQUEST_SIGNERS || undefined}
            className="text-accent hover:text-accent inline-flex items-center gap-1 text-xs font-medium transition aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          >
            <Plus className="size-3.5" aria-hidden />
            Add signer
          </button>
        </div>
        {signers.map((signer, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <span className="bg-accent/10 text-accent grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold">
              {index + 1}
            </span>
            <input
              type="text"
              value={signer.name}
              onChange={(e) => updateSigner(index, { name: e.target.value })}
              placeholder="Full name"
              aria-label={`Signer ${index + 1} name`}
              className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent min-w-[8rem] flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none"
            />
            <input
              type="email"
              value={signer.email}
              onChange={(e) => updateSigner(index, { email: e.target.value })}
              placeholder="email@company.com"
              aria-label={`Signer ${index + 1} email`}
              className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent min-w-[10rem] flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => removeSigner(index)}
              aria-disabled={signers.length <= 1 || undefined}
              aria-label={`Remove signer ${index + 1}`}
              className="text-muted hover:text-err shrink-0 rounded-lg p-1.5 transition aria-disabled:cursor-not-allowed aria-disabled:opacity-30"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-muted flex flex-col gap-1 text-xs">
          Signing order
          <select
            value={routing}
            onChange={(e) =>
              setRouting(e.target.value as RequestSignatureRouting)
            }
            className="border-line bg-wash text-fg focus:border-accent/40 rounded-lg border px-3 py-1.5 text-sm outline-none"
          >
            <option value="sequential">Sequential — one at a time</option>
            <option value="parallel">Parallel — everyone at once</option>
          </select>
        </label>
        <label className="text-muted flex flex-col gap-1 text-xs">
          Signature page
          <input
            type="number"
            min={1}
            value={page}
            onChange={(e) =>
              setPage(Math.max(1, Math.floor(Number(e.target.value) || 1)))
            }
            className="border-line bg-wash text-fg focus:border-accent/40 rounded-lg border px-3 py-1.5 text-sm outline-none"
          />
        </label>
        <label className="text-muted flex flex-col gap-1 text-xs sm:col-span-2">
          Request title (optional)
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Master Services Agreement"
            className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 rounded-lg border px-3 py-1.5 text-sm outline-none"
          />
        </label>
        <label className="text-muted flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={includeDate}
            onChange={(e) => setIncludeDate(e.target.checked)}
            className="border-line-strong bg-wash size-4 rounded"
          />
          Add a date field next to each signature
        </label>
      </div>

      <WorkerRunButton
        onClick={start}
        busy={busy}
        // `canRun` already folds in `!busy`; both go through one blocked branch.
        disabled={!canRun}
        busyLabel="Preparing request…"
        icon={PenLine}
        tone="violet"
      >
        Prepare signature request
      </WorkerRunButton>

      {outcome?.ok === false && <ErrorNote message={outcome.message} />}
      {outcome?.ok === true && (
        <ResultCard announce="Your signature-request package is ready.">
          <p className="text-ok text-sm">
            Your signature-request package is ready — the prepared PDF with
            fillable fields, a manifest, and an audit trail.
          </p>
          <button
            type="button"
            onClick={() =>
              downloadBytes(outcome.output, outcome.artifact.filename)
            }
            className="bg-invert text-fg-invert hover:bg-invert/85 inline-flex w-full items-center justify-center gap-2 rounded-[3px] px-6 py-2.5 text-sm font-semibold transition-colors sm:w-auto sm:self-start"
          >
            <Download className="size-4" aria-hidden />
            Download {outcome.artifact.filename}
          </button>
        </ResultCard>
      )}
    </div>
  );
}

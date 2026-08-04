"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Download,
  Eye,
  EyeOff,
  FileDown,
  FileUp,
  KeyRound,
  Lock,
  ShieldCheck,
  Timer,
  Unlock,
} from "lucide-react";
import { workerPipelineStages } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import {
  DEFAULT_PDF_KEY_LENGTH,
  MAX_PDF_PASSWORD_BYTES,
  PDF_ENCRYPTION_LEVELS,
  type PdfKeyLength,
} from "@/lib/jobs/pdf-security";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  canRunPdfSecurity,
  runWorkerProtect,
  runWorkerUnlock,
  type PdfSecurityWorkerResult,
} from "@/lib/workers/pdf-security-client";
import { downloadBytes } from "@/lib/pdf/browser";
import { track } from "@/lib/telemetry/track";
import type { Tool } from "@/lib/tools/types";
import { cn, formatBytes } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
import {
  Dropzone,
  ErrorNote,
  ResultCard,
  Spinner,
  WorkerRunButton,
} from "./runner/runner-kit";
import { NotifyMe } from "./notify-me";

type Phase = "loading" | "error" | "ready";
type Mode = "protect" | "unlock";

/** Number of UTF-8 bytes a password occupies (the bound qpdf actually enforces). */
function passwordByteLength(password: string): number {
  return new TextEncoder().encode(password).length;
}

function StageIcon({ id, className }: { id: string; className?: string }) {
  switch (id) {
    case "process":
      return <Lock className={className} aria-hidden />;
    case "scan":
      return <ShieldCheck className={className} aria-hidden />;
    case "download":
      return <Download className={className} aria-hidden />;
    case "delete":
      return <Timer className={className} aria-hidden />;
    default:
      return <FileUp className={className} aria-hidden />;
  }
}

function SpecRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileUp;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="inline-flex items-center gap-2 text-sm text-slate-400">
        <Icon className="size-4 text-slate-500" aria-hidden />
        {label}
      </span>
      <span className="text-right text-sm font-medium text-slate-200">
        {value}
      </span>
    </div>
  );
}

/** Honest availability badge derived from the live worker status. */
function badgeFor(
  phase: Phase,
  status: WorkerStatus | null,
): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading") return { tone: "info", label: "Checking…", pulse: true };
  if (phase === "error" || !status) {
    return { tone: "muted", label: "Status unknown", pulse: false };
  }
  if (canRunPdfSecurity(status)) {
    return status.mode === "local-dev"
      ? { tone: "warn", label: "Local-dev worker", pulse: true }
      : { tone: "ok", label: "Secure worker", pulse: false };
  }
  return { tone: "muted", label: "Not enabled", pulse: false };
}

const COPY: Record<
  Mode,
  { icon: typeof Lock; badge: string; blurb: string; cta: string; running: string }
> = {
  protect: {
    icon: Lock,
    badge: "Secure-worker encryption",
    blurb:
      "Encrypting a PDF needs the native qpdf engine, so it runs on an isolated, auto-deleting secure worker rather than in your browser. Your password is sent to that worker only to encrypt the file, and the input is wiped right after.",
    cta: "Encrypt on the worker",
    running: "Encrypting on the worker…",
  },
  unlock: {
    icon: Unlock,
    badge: "Secure-worker unlock",
    blurb:
      "Removing a password needs the native qpdf engine, so it runs on an isolated, auto-deleting secure worker. Enter the password that already opens the file — Unlock can't recover or bypass a password you don't know. The input is wiped right after.",
    cta: "Unlock on the worker",
    running: "Unlocking on the worker…",
  },
};

/**
 * Premium, honest secure-worker panel for `/tools/protect-pdf` and
 * `/tools/unlock-pdf`. It reads the live, presence-only `/api/worker/status`
 * endpoint and only offers the real qpdf-backed flow when a worker is genuinely
 * available; otherwise it says so plainly and offers no upload. It never fakes a
 * result — every protected/unlocked file here is real output downloaded from the
 * worker. The password is entered in a masked field and travels only in the job
 * request body; it is never shown in copy, a URL, or a log.
 */
export function PdfSecurityWorkerPanel({ tool }: { tool: Tool }) {
  const mode: Mode = tool.slug === "protect-pdf" ? "protect" : "unlock";
  const copy = COPY[mode];
  const HeaderIcon = copy.icon;

  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<WorkerStatus | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/worker/status", { headers: { accept: "application/json" } })
      .then((r) =>
        r.ok
          ? (r.json() as Promise<WorkerStatus>)
          : Promise.reject(new Error("unreachable")),
      )
      .then((s) => {
        if (!active) return;
        setStatus(s);
        setPhase("ready");
        track({ name: "worker_status_checked", mode: s.mode, enabled: s.enabled });
      })
      .catch(() => {
        if (active) setPhase("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const badge = badgeFor(phase, status);
  const available = phase === "ready" && canRunPdfSecurity(status);

  return (
    <div className="gradient-border">
      <div className="glass flex flex-col gap-6 rounded-3xl p-5 sm:p-7">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/30 bg-blue-400/10 px-2.5 py-1 text-[11px] font-medium text-blue-200">
              <HeaderIcon className="size-3" aria-hidden />
              {copy.badge}
            </span>
            <StatusBadge tone={badge.tone} label={badge.label} pulse={badge.pulse} />
          </div>
          <h2 className="text-lg font-semibold text-white">
            {tool.name} runs on an encrypted secure worker
          </h2>
          <p className="text-sm leading-relaxed text-slate-400">{copy.blurb}</p>
        </div>

        {/* Status-dependent action area */}
        {available && status ? (
          <SecurityRunArea mode={mode} localDevOnly={status.localDevOnly} />
        ) : (
          <SecurityUnavailable phase={phase} status={status} toolName={tool.name} toolSlug={tool.slug} />
        )}

        {/* Pipeline: honest "here's what will happen" */}
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            What happens to your file
          </h3>
          <ol className="flex flex-col gap-1">
            {workerPipelineStages(status?.scan.active ?? false).map((stage, i, all) => (
              <li key={stage.id} className="flex items-start gap-3">
                <div className="flex flex-col items-center self-stretch">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-300">
                    <StageIcon id={stage.id} className="size-4" />
                  </span>
                  {i < all.length - 1 && (
                    <span className="my-1 w-px flex-1 bg-white/10" aria-hidden />
                  )}
                </div>
                <div className="flex flex-col gap-0.5 pb-3">
                  <span className="text-sm font-medium text-slate-200">
                    {i + 1}. {stage.title}
                  </span>
                  <span className="text-xs leading-relaxed text-slate-500">
                    {stage.description}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Spec rows */}
        <div className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-surface-2 px-4 py-1">
          <SpecRow icon={FileUp} label="Input" value="One PDF" />
          <SpecRow icon={FileDown} label="Output" value="PDF" />
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

        <p className="text-xs leading-relaxed text-slate-500">
          No account required. This runs on an isolated secure worker: files are
          encrypted in transit and at rest, processed in a sandbox with no network
          egress, and deleted automatically. Your password is used only to perform
          the operation and is never stored or logged.
        </p>
      </div>
    </div>
  );
}

/**
 * The honest "not running here" state: a clear reason from the live status plus a
 * notify placeholder. Renders NO uploader and NO password field — nothing can be
 * submitted, so nothing pretends it can.
 */
function SecurityUnavailable({
  phase,
  status,
  toolName,
  toolSlug,
}: {
  phase: Phase;
  status: WorkerStatus | null;
  toolName: string;
  toolSlug: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-4">
      {phase === "loading" ? (
        <p
          className="inline-flex items-center gap-2 text-sm text-slate-400"
          role="status"
        >
          <Spinner className="size-4" />
          Checking whether a secure worker is available…
        </p>
      ) : (
        <p className="text-sm leading-relaxed text-amber-100/90">
          {phase === "error"
            ? "We couldn't confirm secure-worker availability just now, so this isn't offered here. No file is ever uploaded until it's confirmed available."
            : (status?.security.detail ??
              "PDF password protection isn't enabled in this environment. No file is uploaded.")}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <NotifyMe toolName={toolName} toolSlug={toolSlug} />
      </div>
    </div>
  );
}

/** A masked password input with an accessible show/hide toggle. */
function PasswordField({
  id,
  label,
  value,
  onChange,
  disabled,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  autoComplete: string;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-slate-400">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          // Masked by default; a user-initiated toggle reveals their own value.
          type={reveal ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          autoComplete={autoComplete}
          spellCheck={false}
          aria-describedby={`${id}-hint`}
          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 pr-11 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-violet-400/50 focus:bg-white/[0.05] disabled:opacity-50"
          placeholder="••••••••"
        />
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          disabled={disabled}
          aria-label={reveal ? "Hide password" : "Show password"}
          aria-pressed={reveal}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-500 transition hover:text-slate-200 disabled:opacity-50"
        >
          {reveal ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Eye className="size-4" aria-hidden />
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * The available state: an uploader, a masked password field (plus an encryption
 * strength selector for protect), and a run button that drives the real, documented
 * job flow. Reached only when the status endpoint honestly reports the worker
 * available; every result here is real output downloaded from the worker.
 */
function SecurityRunArea({
  mode,
  localDevOnly,
}: {
  mode: Mode;
  localDevOnly: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [keyLength, setKeyLength] = useState<PdfKeyLength>(DEFAULT_PDF_KEY_LENGTH);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<PdfSecurityWorkerResult | null>(null);

  const passwordBytes = passwordByteLength(password);
  const tooLong = passwordBytes > MAX_PDF_PASSWORD_BYTES;
  const canSubmit =
    file !== null && password.length > 0 && !tooLong && !busy;

  const start = useCallback(async () => {
    if (!file || password.length === 0 || tooLong) return;
    setBusy(true);
    try {
      setOutcome(null);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result =
        mode === "protect"
          ? await runWorkerProtect({
              filename: file.name,
              bytes,
              password,
              keyLength,
            })
          : await runWorkerUnlock({ filename: file.name, bytes, password });
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
  }, [file, password, keyLength, mode, tooLong]);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-blue-400/25 bg-blue-500/[0.06] p-4">
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-blue-100/90">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {localDevOnly
          ? "This runs on your local-dev worker — the file and password are processed in-process on this machine, not sent to any third party."
          : "Running this uploads your file to the encrypted secure worker; your password is sent to it only to perform the operation."}
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
          accept="application/pdf"
          multiple={false}
          compact
          title={
            mode === "protect"
              ? "Add a PDF to password-protect, or"
              : "Add a password-protected PDF, or"
          }
          hint="PDF"
        />
      )}

      <PasswordField
        id="pdf-security-password"
        label={mode === "protect" ? "New password" : "Current password"}
        value={password}
        onChange={setPassword}
        disabled={busy}
        // "new-password" avoids the browser offering a saved login for unlock, and
        // avoids prompting to save the just-set encryption password for protect.
        autoComplete="new-password"
      />
      <p
        id="pdf-security-password-hint"
        className={cn(
          "text-xs leading-relaxed",
          tooLong ? "text-amber-300" : "text-slate-500",
        )}
      >
        {mode === "protect"
          ? "Anyone opening the PDF will need this password. Store it somewhere safe — it can't be recovered."
          : "Enter the password that currently opens this PDF."}
        {tooLong
          ? ` Too long: ${passwordBytes}/${MAX_PDF_PASSWORD_BYTES} bytes.`
          : ""}
      </p>

      {mode === "protect" && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-slate-400">
            Encryption strength
          </span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Encryption strength">
            {PDF_ENCRYPTION_LEVELS.map((level) => {
              const active = keyLength === level.keyLength;
              return (
                <button
                  key={level.keyLength}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setKeyLength(level.keyLength)}
                  disabled={busy}
                  title={level.description}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50",
                    active
                      ? "border-violet-400/50 bg-violet-500/15 text-violet-100"
                      : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25 hover:bg-white/[0.06] hover:text-white",
                  )}
                >
                  <KeyRound className="size-3" aria-hidden />
                  {level.label}
                </button>
              );
            })}
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            {PDF_ENCRYPTION_LEVELS.find((l) => l.keyLength === keyLength)?.description}
          </p>
        </div>
      )}

      <WorkerRunButton
        onClick={start}
        busy={busy}
        // `canSubmit` already folds in `!busy`; both go through one blocked branch.
        disabled={!canSubmit}
        busyLabel={COPY[mode].running}
        icon={mode === "protect" ? Lock : Unlock}
      >
        {COPY[mode].cta}
      </WorkerRunButton>

      {outcome?.ok === false && <ErrorNote message={outcome.message} />}

      {outcome?.ok === true && (
        <ResultCard announce={mode === "protect" ? "Your PDF is protected and ready." : "Your PDF is unlocked and ready."}>
          <p className="text-sm text-emerald-200">
            {mode === "protect"
              ? "Your PDF is protected and ready."
              : "Your PDF is unlocked and ready."}
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

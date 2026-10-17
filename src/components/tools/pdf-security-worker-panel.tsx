"use client";

import { useCallback, useState } from "react";
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
  PASSWORD_QUEUE_LIFETIME,
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
import type { Tool } from "@/lib/tools/types";
import { pickRefusal, type PickRefusal } from "@/lib/uploads/pick-check";
import { cn, formatBytes } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/status/status-ui";
import {
  DownloadCta,
  Dropzone,
  ResultCard,
  WorkerRunButton,
} from "./runner/runner-kit";
import { ChosenFileTarget } from "./chosen-file-target";
import { NotifyMe } from "./notify-me";
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
 * 2026-10-10 — phone at 360px 619px, `sm` at 640px 501.5px, `lg` at 1024px
 * 521px — plus 4px, to the half rem.
 */
const STATUS_SLOT = "min-h-[40.5rem] sm:min-h-[32rem] lg:min-h-[33rem]";

type Phase = WorkerPhase;
type Mode = "protect" | "unlock";

/**
 * Whether the run must wait for a password — in BOTH modes. Protect needs one
 * to set. Unlock needs one the file accepts: the password that opens it, or,
 * for a file that opens freely but locks printing, copying or editing, its
 * owner (permissions) password. A blank unlock would lift those locks without
 * the owner password, which Unlock never does, and the job parser refuses it.
 *
 * (wave1/l06-copy-other let unlock run blank; the merge kept the rule the
 * other lane had kept, a50c54c — see `parseUnlockPdfOptions`.)
 */
export function isPasswordMissing(_mode: Mode, password: string): boolean {
  return password.length === 0;
}

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
      <span className="text-muted inline-flex items-center gap-2 text-sm">
        <Icon className="text-muted size-4" aria-hidden />
        {label}
      </span>
      <span className="text-fg text-right text-sm font-medium">{value}</span>
    </div>
  );
}

/** Honest availability badge derived from the live worker status. */
function badgeFor(
  phase: Phase,
  status: WorkerStatus | null,
): { tone: StatusTone; label: string; pulse: boolean } {
  if (phase === "loading")
    return { tone: "info", label: "Checking…", pulse: true };
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
  {
    icon: typeof Lock;
    badge: string;
    blurb: string;
    cta: string;
    running: string;
  }
> = {
  protect: {
    icon: Lock,
    badge: "Secure-worker encryption",
    blurb:
      "Encrypting a PDF needs the native qpdf engine, so it runs on an isolated, auto-deleting secure worker rather than in your browser. Your password is used only to encrypt the file and is deleted from our job queue when the job ends; the input is wiped right after.",
    cta: "Encrypt on the worker",
    running: "Encrypting on the worker…",
  },
  unlock: {
    icon: Unlock,
    badge: "Secure-worker unlock",
    blurb:
      "Removing a password needs the native qpdf engine, so it runs on an isolated, auto-deleting secure worker. Enter the password that opens the file — or, if it opens without one and only printing, copying or editing is locked, its owner (permissions) password. Unlock can't recover or bypass a password you don't know. The input is wiped right after.",
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

  const { phase, status, retry } = useWorkerStatus();

  const badge = badgeFor(phase, status);
  const available = phase === "ready" && canRunPdfSecurity(status);

  return (
    <div className="">
      <div className="border-line bg-panel flex flex-col gap-6 rounded-[4px] border p-5 sm:p-7">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="border-info/40 bg-info/10 text-info inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium">
              <HeaderIcon className="size-3" aria-hidden />
              {copy.badge}
            </span>
            <StatusBadge
              tone={badge.tone}
              label={badge.label}
              pulse={badge.pulse}
            />
          </div>
          <h2 className="text-fg text-lg font-semibold">
            {tool.name} runs on a secure worker
          </h2>
          <p className="text-muted text-sm leading-relaxed">{copy.blurb}</p>
        </div>

        {/* Status-dependent action area */}
        <WorkerStatusSlot
          state={workerSlotState(phase, available && status !== null)}
          reserve={STATUS_SLOT}
        >
          {available && status ? (
            <SecurityRunArea
              mode={mode}
              localDevOnly={status.localDevOnly}
              refuse={(file) => pickRefusal(tool, file)}
            />
          ) : (
            <SecurityUnavailable
              onRetry={retry}
              phase={phase}
              status={status}
              toolName={tool.name}
              toolSlug={tool.slug}
            />
          )}
        </WorkerStatusSlot>

        {/* Pipeline: honest "here's what will happen" */}
        <div className="flex flex-col gap-3">
          <h3 className="text-faint kicker">What happens to your file</h3>
          <ol className="flex flex-col gap-1">
            {workerPipelineStages(status ? status.scan.active : null, tool).map(
              (stage, i, all) => (
                <li key={stage.id} className="flex items-start gap-3">
                  <div className="flex flex-col items-center self-stretch">
                    <span className="border-line bg-wash text-muted grid size-8 shrink-0 place-items-center rounded-full border">
                      <StageIcon id={stage.id} className="size-4" />
                    </span>
                    {i < all.length - 1 && (
                      <span className="bg-wash my-1 w-px flex-1" aria-hidden />
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 pb-3">
                    <span className="text-fg text-sm font-medium">
                      {i + 1}. {stage.title}
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

        {/* Spec rows */}
        <div className="bg-panel border-line divide-line divide-y rounded-[4px] border px-4 py-1">
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

        <p className="text-muted text-xs leading-relaxed">
          No account required. This runs on a separate processing server, not in
          your browser: files travel over an encrypted connection, are processed
          in a temporary per-job folder that is erased when the job ends, and
          are deleted automatically. Your password is never logged.{" "}
          {PASSWORD_QUEUE_LIFETIME}
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
  onRetry,
  status,
  toolName,
  toolSlug,
}: {
  phase: Phase;
  onRetry: () => void;
  status: WorkerStatus | null;
  toolName: string;
  toolSlug: string;
}) {
  // Until the status is KNOWN this box says nothing about the tool: the
  // server renders the loading phase, and "Notify me when this ships" there
  // told search engines that live tools had not shipped. A failed status
  // check gets a retry, not a notify button.
  if (phase !== "ready")
    return <WorkerStatusPending phase={phase} onRetry={onRetry} />;
  return (
    <div className="border-warn/40 bg-warn/10 flex flex-col gap-3 rounded-[4px] border p-4">
      <p className="text-warn text-sm leading-relaxed">
        {status?.security.detail ??
          "PDF password protection isn't enabled in this environment. No file is uploaded."}
      </p>
      <div className="flex flex-col gap-2">
        <NotifyMe toolName={toolName} toolSlug={toolSlug} checking={false} />
      </div>
    </div>
  );
}

/**
 * A masked password input with an accessible show/hide toggle.
 *
 * While the run is busy the input goes `readOnly`, never `disabled`: a
 * natively disabled input cannot hold focus, so a user whose caret was still
 * in the field when the run started (click the Run button in a browser that
 * does not focus buttons on click, and the caret never left) would be thrown
 * to `<body>` at t=0 — the #46 defect on an input. Read-only keeps the field
 * focusable and its value visible/selectable while refusing edits, and the
 * reveal toggle stays functional throughout (showing your own password mid-run
 * changes nothing about the job).
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  busy,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  autoComplete: string;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-muted text-xs font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          // Masked by default; a user-initiated toggle reveals their own value.
          type={reveal ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          readOnly={busy}
          autoComplete={autoComplete}
          spellCheck={false}
          aria-describedby={`${id}-hint`}
          className={cn(
            "border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 focus:bg-wash w-full rounded-[3px] border px-3 py-2.5 pr-11 text-sm transition outline-none",
            busy && "opacity-50",
          )}
          placeholder="••••••••"
        />
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          aria-label={reveal ? "Hide password" : "Show password"}
          aria-pressed={reveal}
          className="text-muted hover:text-fg absolute inset-y-0 right-0 grid w-11 place-items-center transition"
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
  refuse,
}: {
  mode: Mode;
  localDevOnly: boolean;
  refuse: PickRefusal;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [keyLength, setKeyLength] = useState<PdfKeyLength>(
    DEFAULT_PDF_KEY_LENGTH,
  );
  const job = useWorkerJob<PdfSecurityWorkerResult>({
    tool: mode === "protect" ? "protect-pdf" : "unlock-pdf",
    resume: (id, controls) =>
      resumeSecurityJob(id, {
        ...controls,
        tool: mode === "protect" ? "protect-pdf" : "unlock-pdf",
      }),
  });
  const { busy, outcome, setOutcome, run } = job;

  const passwordBytes = passwordByteLength(password);
  const tooLong = passwordBytes > MAX_PDF_PASSWORD_BYTES;
  const passwordMissing = isPasswordMissing(mode, password);
  const canSubmit = file !== null && !passwordMissing && !tooLong && !busy;

  const start = useCallback(async () => {
    if (!file || passwordMissing || tooLong) return;
    await run(async (controls) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result =
        mode === "protect"
          ? await runWorkerProtect(
              {
                filename: file.name,
                bytes,
                password,
                keyLength,
              },
              controls,
            )
          : await runWorkerUnlock(
              { filename: file.name, bytes, password },
              controls,
            );
      return result;
    });
  }, [file, password, keyLength, mode, tooLong, passwordMissing, run]);

  return (
    <div className="border-info/40 bg-info/10 flex flex-col gap-4 rounded-[4px] border p-4">
      <p className="text-info flex items-start gap-1.5 text-xs leading-relaxed">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {localDevOnly
          ? "This runs on your local-dev worker — the file and password are processed in-process on this machine, not sent to any third party."
          : "Running this uploads your file to the secure worker; your password travels with the job through our queue and is used only to perform the operation."}
      </p>

      {file ? (
        <ChosenFileTarget
          file={file}
          accept="application/pdf"
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
          accept="application/pdf"
          multiple={false}
          compact
          title={
            mode === "protect"
              ? "Add a PDF to password-protect, or"
              : "Add a locked PDF, or"
          }
          hint="PDF"
        />
      )}

      <PasswordField
        id="pdf-security-password"
        label={mode === "protect" ? "New password" : "Current password"}
        value={password}
        onChange={setPassword}
        busy={busy}
        // "new-password" avoids the browser offering a saved login for unlock, and
        // avoids prompting to save the just-set encryption password for protect.
        autoComplete="new-password"
      />
      <p
        id="pdf-security-password-hint"
        className={cn(
          "text-xs leading-relaxed",
          tooLong ? "text-warn" : "text-muted",
        )}
      >
        {mode === "protect"
          ? "Anyone opening the PDF will need this password. Store it somewhere safe — it can't be recovered."
          : // A PDF that opens freely but locks printing or copying has no
            // password that "opens" it; its owner password is the one qpdf
            // accepts. Until 2026-09 this hint named only the open password,
            // so that user had nothing true to type.
            "Enter the password that opens this PDF — or, if it opens without one, its owner (permissions) password."}
        {tooLong
          ? ` Too long: ${passwordBytes}/${MAX_PDF_PASSWORD_BYTES} bytes.`
          : ""}
      </p>

      {mode === "protect" && (
        <div className="flex flex-col gap-2">
          <span className="text-muted text-xs font-medium">
            Encryption strength
          </span>
          <div
            className="flex flex-wrap gap-1.5"
            role="radiogroup"
            aria-label="Encryption strength"
          >
            {PDF_ENCRYPTION_LEVELS.map((level) => {
              const active = keyLength === level.keyLength;
              return (
                <button
                  key={level.keyLength}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  // aria-disabled + a guarded click, never the native attribute —
                  // a disabled radio drops focus and leaves the tab order mid-run
                  // (the #46 rule; see ChipButton in runner-kit).
                  onClick={() => {
                    if (!busy) setKeyLength(level.keyLength);
                  }}
                  aria-disabled={busy || undefined}
                  title={level.description}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition aria-disabled:opacity-50",
                    active
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : "border-line bg-wash text-muted hover:border-line-strong hover:bg-wash hover:text-fg",
                  )}
                >
                  <KeyRound className="size-3" aria-hidden />
                  {level.label}
                </button>
              );
            })}
          </div>
          <p className="text-muted text-xs leading-relaxed">
            {
              PDF_ENCRYPTION_LEVELS.find((l) => l.keyLength === keyLength)
                ?.description
            }
          </p>
        </div>
      )}

      <WorkerRunButton
        onClick={start}
        busy={busy}
        // `canSubmit` already folds in `!busy`; both go through one blocked branch.
        disabled={!canSubmit}
        busyLabel={jobBusyLabel(job.phase, COPY[mode].running)}
        icon={mode === "protect" ? Lock : Unlock}
      >
        {COPY[mode].cta}
      </WorkerRunButton>

      <WorkerJobStatus job={job} />

      {outcome?.ok === true && (
        <ResultCard
          announce={
            mode === "protect"
              ? "Your PDF is protected and ready."
              : "Your PDF is unlocked and ready."
          }
        >
          <p className="text-ok text-sm">
            {mode === "protect"
              ? "Your PDF is protected and ready."
              : "Your PDF is unlocked and ready."}
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

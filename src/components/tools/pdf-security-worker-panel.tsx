"use client";

import { RunReason } from "@/components/tools/runner/run-reason";
import { useCallback, useMemo, useState } from "react";
import {
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
import { DEFAULT_RETENTION, JOB_LIMITS } from "@/lib/jobs/types";
import {
  DEFAULT_PDF_KEY_LENGTH,
  MAX_PDF_PASSWORD_BYTES,
  PASSWORD_QUEUE_LIFETIME,
  PDF_ENCRYPTION_LEVELS,
  type PdfKeyLength,
} from "@/lib/jobs/pdf-security";
import {
  ALL_PERMISSIONS_ALLOWED,
  hasRestrictions,
  type PdfPermissions,
} from "@/lib/jobs/pdf-permissions";
import {
  FORMS_FOLLOW_ANNOTATE,
  PDF_PERMISSIONS,
  PERMISSIONS_ARE_FLAGS,
} from "@/lib/jobs/pdf-permission-labels";
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
import {
  DownloadCta,
  Dropzone,
  ResultCard,
  WorkerRunButton,
} from "./runner/runner-kit";
import { ChosenFileTarget } from "./chosen-file-target";
import { jobBusyLabel, useWorkerJob, WorkerJobStatus } from "./worker-job";
import { resumeSecurityJob } from "@/lib/workers/pdf-security-client";
import { useStagedHandoff } from "./use-staged-handoff";
import {
  useWorkerPanel,
  WorkerGate,
  WorkerPanelShell,
  workerOutput,
} from "./worker-panel-shell";

/**
 * The status slot's reserved height (see `WorkerStatusSlot` and
 * `WorkerGate`): the tallest state it shows — checking, a failed check,
 * not enabled, ready — at the narrowest width of each breakpoint.
 *
 * Refitted 2026-10-21 (WP-10), when the slot came to hold Run, the docket
 * and what the check said, the drop zone having moved out of it: the
 * tallest state, the larger of Windows and Linux (CI's SLOT_NATURAL lines
 * on 507b6383), is 548px at 360, 439.5px at 640, 457.5px at 1024;
 * x1.035, to the half rem, then up to a value another panel's slot already
 * uses, so the thirteen share a handful of classes. A first fit from
 * Windows alone (x1.06) left PowerPoint to PDF and PDF to PowerPoint
 * short on Linux at 360. The check: `e2e/tool-layout.mobile.spec.ts`.
 *
 * Refitted 2026-10-23, when the stage list stopped being drawn before a
 * job (one "What happens to your file" press stands in for it): the
 * tallest state is now not-enabled, off 528.5/548px at 360 (Windows/Linux;
 * Linux from CI's SLOT_NATURAL lines on 0504da27, a state this change
 * did not touch), x1.035 to the half rem, then up to a value another
 * panel already uses.
 *
 * Refitted 2026-10-24, when the not-enabled box became one sentence,
 * Why?, Try again and Notify me (the reason one press away): the
 * tallest state, Windows / Linux (CI's SLOT_NATURAL lines on
 * 28af68e1), is 338/357.5px at 360-390, 225.5/225.5px at 640,
 * 230.5/230.5px at 1024; the larger x1.035, to the half rem.
 */
const STATUS_SLOT = "min-h-[23.5rem] sm:min-h-[15rem] lg:min-h-[15rem]";

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

/**
 * What the boxes mean once the format's ties are applied: accessibility is
 * always allowed (AES cannot block it), and form filling is allowed whenever
 * comments are (the annotate bit grants it). The job validator refuses the
 * combinations these rules out, so the panel never sends one.
 */
export function effectivePermissions(chosen: PdfPermissions): PdfPermissions {
  return {
    ...chosen,
    accessibility: true,
    fillForms: chosen.annotate ? true : chosen.fillForms,
  };
}

/**
 * Why the owner password cannot be used yet, or `null` when it can. Only
 * asked while a restriction is set — the open password would lift a
 * restriction whose owner password is missing or the same.
 */
export function ownerPasswordProblem(
  password: string,
  ownerPassword: string,
): string | null {
  if (ownerPassword.length === 0)
    return "Restricting permissions needs an owner password.";
  if (passwordByteLength(ownerPassword) > MAX_PDF_PASSWORD_BYTES)
    return `Too long: ${passwordByteLength(ownerPassword)}/${MAX_PDF_PASSWORD_BYTES} bytes.`;
  if (ownerPassword === password)
    return "Use a different password from the open password, or the restrictions bind no one.";
  return null;
}

/** Number of UTF-8 bytes a password occupies (the bound qpdf actually enforces). */
function passwordByteLength(password: string): number {
  return new TextEncoder().encode(password).length;
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
    badge: "Password encryption",
    blurb:
      "Encrypting a PDF needs the native qpdf engine, so it runs on an isolated, auto-deleting secure server rather than in your browser. Your password is used only to encrypt the file and is deleted from our job queue when the job ends; the input is wiped right after.",
    cta: "Encrypt PDF",
    running: "Encrypting on our secure server…",
  },
  unlock: {
    icon: Unlock,
    badge: "Password removal",
    blurb:
      "Removing a password needs the native qpdf engine, so it runs on an isolated, auto-deleting secure server. Enter the password that opens the file — or, if it opens without one and only printing, copying or editing is locked, its owner (permissions) password. Unlock can't recover or bypass a password you don't know. The input is wiped right after.",
    cta: "Unlock PDF",
    running: "Unlocking on our secure server…",
  },
};

/**
 * Premium, honest secure-worker panel for `/tools/protect-pdf` and
 * `/tools/unlock-pdf`. The file and password can be given at once; the run —
 * the only thing that uploads — waits for the live, presence-only
 * `/api/worker/status` check to say a worker is genuinely available, and
 * otherwise the panel says so plainly and uploads nothing. It never fakes a
 * result — every protected/unlocked file here is real output downloaded from the
 * worker. The password is entered in a masked field and travels only in the job
 * request body; it is never shown in copy, a URL, or a log.
 */
export function PdfSecurityWorkerPanel({ tool }: { tool: Tool }) {
  const mode: Mode = tool.slug === "protect-pdf" ? "protect" : "unlock";
  const copy = COPY[mode];

  return (
    <WorkerPanelShell
      tool={tool}
      engine={{ label: copy.badge, icon: copy.icon }}
      description={copy.blurb}
      canRun={canRunPdfSecurity}
      specRows={[
        { icon: FileUp, label: "You add", value: "One PDF" },
        { icon: FileDown, label: "You get", value: "PDF" },
        {
          icon: Timer,
          label: "Your files",
          value: `Input wiped after processing · output ${DEFAULT_RETENTION.outputTtlMinutes} min`,
        },
        {
          icon: ShieldCheck,
          label: "Largest file",
          value: `${formatBytes(JOB_LIMITS.maxFileBytes)}/file`,
        },
      ]}
      footer={
        <p className="text-muted text-xs leading-relaxed">
          No account required. This runs on a separate processing server, not in
          your browser: files travel over an encrypted connection, are processed
          in a temporary per-job folder that is erased when the job ends, and
          are deleted automatically. Your password is never logged.{" "}
          {PASSWORD_QUEUE_LIFETIME}
        </p>
      }
    >
      <SecurityRunArea
        mode={mode}
        tool={tool}
        refuse={(file) => pickRefusal(tool, file)}
      />
    </WorkerPanelShell>
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
            "border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 focus:bg-wash rounded-ctl w-full border px-3 py-3 pr-11 text-sm transition outline-none",
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
  tool,
  refuse,
}: {
  mode: Mode;
  tool: Tool;
  refuse: PickRefusal;
}) {
  const { available, status } = useWorkerPanel();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [keyLength, setKeyLength] = useState<PdfKeyLength>(
    DEFAULT_PDF_KEY_LENGTH,
  );
  // Protect only. Every switch on = today's behaviour, and nothing extra is
  // sent; turning one off asks for an owner password.
  const [chosen, setChosen] = useState<PdfPermissions>(ALL_PERMISSIONS_ALLOWED);
  const [ownerPassword, setOwnerPassword] = useState("");
  const permissions = useMemo(() => effectivePermissions(chosen), [chosen]);
  const restricting = mode === "protect" && hasRestrictions(permissions);
  const ownerProblem = restricting
    ? ownerPasswordProblem(password, ownerPassword)
    : null;
  const job = useWorkerJob<PdfSecurityWorkerResult>({
    tool: mode === "protect" ? "protect-pdf" : "unlock-pdf",
    resume: (id, controls) =>
      resumeSecurityJob(id, {
        ...controls,
        tool: mode === "protect" ? "protect-pdf" : "unlock-pdf",
      }),
  });
  const { busy, outcome, setOutcome, run } = job;
  // A file carried here (a merge's "Continue with", an encrypted PDF's
  // remedy) is staged: it waits beside the password field, and nothing —
  // file or password — leaves this browser until Run.
  const staged = useStagedHandoff(tool.slug, COPY[mode].cta, (files) => {
    setOutcome(null);
    setFile(files[0] ?? null);
  });

  const passwordBytes = passwordByteLength(password);
  const tooLong = passwordBytes > MAX_PDF_PASSWORD_BYTES;
  const passwordMissing = isPasswordMissing(mode, password);
  const canSubmit =
    file !== null &&
    !passwordMissing &&
    !tooLong &&
    ownerProblem === null &&
    !busy;

  const start = useCallback(async () => {
    if (!file || passwordMissing || tooLong || ownerProblem || !available)
      return;
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
                // Sent only when restricting: an all-allowed request is
                // byte-for-byte the one that shipped before permissions.
                ...(restricting ? { ownerPassword, permissions } : {}),
              },
              controls,
            )
          : await runWorkerUnlock(
              { filename: file.name, bytes, password },
              controls,
            );
      return result;
    });
  }, [
    file,
    password,
    keyLength,
    mode,
    tooLong,
    passwordMissing,
    ownerProblem,
    restricting,
    ownerPassword,
    permissions,
    run,
    available,
  ]);

  return (
    <div className="flex flex-col gap-4">
      {staged}
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
          <div className="border-line bg-wash text-fg rounded-ctl flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-sm">
            <span className="truncate">{file.name}</span>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setOutcome(null);
              }}
              className="text-muted hover:text-fg tap-y shrink-0 text-sm font-medium transition"
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
                    "rounded-tag inline-flex h-11 items-center gap-1.5 border px-3 py-1.5 text-xs font-medium transition aria-disabled:opacity-50",
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

      {mode === "protect" && (
        <PermissionControls
          chosen={chosen}
          onChange={setChosen}
          effective={permissions}
          busy={busy}
          restricting={restricting}
          ownerPassword={ownerPassword}
          onOwnerPassword={setOwnerPassword}
          ownerProblem={ownerProblem}
        />
      )}

      <WorkerGate
        reserve={STATUS_SLOT}
        job={job}
        bytes={file?.size}
        run={(ready) => (
          <RunReason
            after
            reason={
              ready && file !== null && passwordMissing
                ? mode === "protect"
                  ? "Type a new password first."
                  : "Type the password that opens this PDF first."
                : null
            }
          >
            {(describedBy) => (
              <WorkerRunButton
                onClick={start}
                busy={busy}
                describedBy={describedBy}
                // `canSubmit` already folds in `!busy`; both go through one blocked branch.
                disabled={!ready || !canSubmit}
                busyLabel={jobBusyLabel(job.phase, COPY[mode].running)}
                icon={mode === "protect" ? Lock : Unlock}
              >
                {COPY[mode].cta}
              </WorkerRunButton>
            )}
          </RunReason>
        )}
        jobStatus={<WorkerJobStatus job={job} />}
        note={
          <p className="text-info flex items-start gap-1.5 text-xs leading-relaxed">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {status?.localDevOnly
              ? "This runs on your local-dev server — the file and password are processed in-process on this machine, not sent to any third party."
              : `Nothing leaves this browser until you press ${COPY[mode].cta}. Then your file uploads to our secure server; your password travels with the job through our queue and is used only to perform the operation.`}
          </p>
        }
        off={
          <>
            <p className="text-warn text-sm leading-relaxed">
              {status?.security.detail ??
                "PDF password protection isn't enabled in this environment. No file is uploaded."}
            </p>
          </>
        }
      />

      {outcome?.ok === true && (
        <ResultCard
          announce={
            mode === "protect"
              ? "Your PDF is protected and ready."
              : "Your PDF is unlocked and ready."
          }
          output={workerOutput(outcome.output, outcome.artifact)}
          inputBytes={file?.size}
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

/**
 * Protect's permission switches and, once one is off, the owner password
 * that lifts them. Every box starts ticked (today's behaviour). Two boxes can
 * be inert, and say why: accessibility (AES cannot block it) and form
 * filling while comments are allowed (the format ties them).
 *
 * Inert boxes use `aria-disabled` and a guarded change, never `disabled`, so
 * focus is never ejected mid-edit (the #46 rule).
 */
function PermissionControls({
  chosen,
  onChange,
  effective,
  busy,
  restricting,
  ownerPassword,
  onOwnerPassword,
  ownerProblem,
}: {
  chosen: PdfPermissions;
  onChange: (next: PdfPermissions) => void;
  effective: PdfPermissions;
  busy: boolean;
  restricting: boolean;
  ownerPassword: string;
  onOwnerPassword: (value: string) => void;
  ownerProblem: string | null;
}) {
  return (
    <fieldset className="border-line rounded-panel flex flex-col gap-2 border p-3">
      <legend className="text-muted px-1 text-xs font-medium">
        Permissions
      </legend>
      <p className="text-muted text-xs leading-relaxed">
        Untick what people who open the file may not do. Leave every box ticked
        to allow everything.
      </p>
      <div className="flex flex-col gap-1.5">
        {PDF_PERMISSIONS.map((info) => {
          const formsTied = info.key === "fillForms" && chosen.annotate;
          const inert = Boolean(info.alwaysAllowed) || formsTied;
          const note =
            info.alwaysAllowed ?? (formsTied ? FORMS_FOLLOW_ANNOTATE : null);
          return (
            <label
              key={info.key}
              className="text-fg tap-row flex items-start gap-2.5 text-sm"
            >
              <input
                type="checkbox"
                checked={effective[info.key]}
                aria-disabled={inert || busy || undefined}
                onChange={(event) => {
                  if (inert || busy) return;
                  onChange({ ...chosen, [info.key]: event.target.checked });
                }}
                className="border-line-strong bg-wash accent-accent rounded-ctl mt-0.5 size-4 aria-disabled:opacity-50"
              />
              <span className="flex flex-col gap-0.5">
                <span>{info.label}</span>
                {note && (
                  <span className="text-muted text-xs leading-relaxed">
                    {note}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {restricting && (
        <div className="flex flex-col gap-1.5 pt-1">
          <PasswordField
            id="pdf-security-owner-password"
            label="Owner password"
            value={ownerPassword}
            onChange={onOwnerPassword}
            busy={busy}
            autoComplete="new-password"
          />
          <p
            id="pdf-security-owner-password-hint"
            className={cn(
              "text-xs leading-relaxed",
              ownerProblem && ownerPassword.length > 0
                ? "text-warn"
                : "text-muted",
            )}
          >
            Needed to lift these restrictions later, and must differ from the
            open password.
            {ownerProblem && ownerPassword.length > 0 ? ` ${ownerProblem}` : ""}
          </p>
        </div>
      )}
      <p className="text-muted text-xs leading-relaxed">
        {PERMISSIONS_ARE_FLAGS}
      </p>
    </fieldset>
  );
}

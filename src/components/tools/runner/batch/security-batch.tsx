"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Eye, EyeOff, KeyRound, Lock, Unlock } from "lucide-react";
import { BatchSkip } from "@/lib/batch";
import {
  PROTECT_BATCH_PASSWORD_HINT,
  PROTECT_NEEDS_PASSWORD_REASON,
  PROTECT_RESTRICTED_REASON,
  SECURITY_RETRY_NOTE,
  UNLOCK_BATCH_PASSWORD_HINT,
  UNLOCK_NOT_LOCKED_REASON,
  protectRetryHeading,
  unlockRetryHeading,
} from "@/lib/batch/security-copy";
import {
  AES128_PASSWORD_CHARSET_MESSAGE,
  DEFAULT_PDF_KEY_LENGTH,
  isPdfDocEncodable,
  MAX_PDF_PASSWORD_BYTES,
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
import { classifyPdfAccess } from "@/lib/pdf/encryption";
import type { Tool } from "@/lib/tools/types";
import { cn } from "@/lib/utils";
import {
  runWorkerProtect,
  runWorkerUnlock,
} from "@/lib/workers/pdf-security-client";
import { buttonVariants } from "@/components/ui/button";
import {
  CONFIRM_OWNER_PASSWORD_FIRST,
  CONFIRM_PASSWORD_FIRST,
  PASSWORDS_DIFFER,
  effectivePermissions,
  needsConfirming,
  ownerPasswordProblem,
} from "../../pdf-security-worker-panel";
import { WorkerBatchRunner } from "./worker-batch-runner";
import { BatchItemError, type WorkerRun } from "./worker-batch";

/**
 * Protect PDF's and Unlock PDF's batch (batch plan P4): one password — and
 * for Protect one strength and one set of permissions — typed once and sent
 * with every file, each file one of today's single jobs through the worker
 * batch (`./worker-batch-runner`).
 *
 * THE PASSWORDS. They never enter React state: each field is uncontrolled,
 * and what is typed is copied into a ref (`draftRef`). React state holds only
 * what the form needs to draw itself — lengths and the reason Run is held —
 * never a password. Pressing Run copies the checked draft into `frozenRef`,
 * which `run` reads for every file, and empties the draft (its fields
 * unmount as the batch starts). `frozenRef` is emptied when the batch ends
 * (done or canceled; a pause is not an end), on "Run again", and when this
 * unmounts (New files, Choose different files, a Remove down to one file,
 * leaving the page). Nothing here writes to storage, a URL, a log or
 * telemetry; the job body is the only place a password travels, exactly as
 * the single-file panel sends it (`queue/sealed-options.ts` seals it on our
 * server).
 *
 * THE LOOK BEFORE AN UPLOAD. `classifyPdfAccess` opens each file in the
 * browser, when its turn comes: Unlock leaves out a PDF that is not locked
 * (a skipped row, no upload, not in the ZIP — the owner's ruling), Protect
 * one that is already encrypted. Nothing is unlocked here: the check opens
 * with no password and never with `ignoreEncryption`, and a restricted file
 * goes to our server like any locked one, where only its owner password
 * lifts the restrictions.
 *
 * Retry needs the password again, since the page forgot it: in place of
 * "Retry failed" the batch draws a form (`unlockRetryHeading`), and its
 * password runs the failed rows, and only them.
 */

type Mode = "protect" | "unlock";

/** What the fields hold. A ref's shape: never React state. */
interface Draft {
  password: string;
  passwordAgain: string;
  owner: string;
  ownerAgain: string;
}

const EMPTY: Readonly<Draft> = {
  password: "",
  passwordAgain: "",
  owner: "",
  ownerAgain: "",
};

/** What every job of one run sends. Held in a ref while the batch runs. */
export interface FrozenSecurityOptions {
  password: string;
  keyLength?: PdfKeyLength;
  ownerPassword?: string;
  permissions?: PdfPermissions;
}

/** The non-secret facts a form draws from: lengths, and why Run waits. */
interface DraftCheck {
  lengths: Record<keyof Draft, number>;
  unconfirmed: boolean;
  ownerUnconfirmed: boolean;
  /** The password line's warning (too long, not Latin for AES-128). */
  passwordWarning: string | null;
  ownerProblem: string | null;
  /** Why the run (or the retry) cannot start, or null. */
  blocked: string | null;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** The fields' rules, as the single-file panel applies them. */
export function checkSecurityDraft(
  draft: Readonly<Draft>,
  {
    mode,
    keyLength,
    restricting,
    missing,
  }: {
    mode: Mode;
    keyLength: PdfKeyLength;
    restricting: boolean;
    /** Run's reason while the password is empty. */
    missing: string;
  },
): DraftCheck {
  const bytes = byteLength(draft.password);
  const tooLong = bytes > MAX_PDF_PASSWORD_BYTES;
  const notLatin =
    mode === "protect" &&
    keyLength === 128 &&
    (!isPdfDocEncodable(draft.password) ||
      (restricting && !isPdfDocEncodable(draft.owner)));
  const unconfirmed =
    mode === "protect" && needsConfirming(draft.password, draft.passwordAgain);
  const ownerProblem = restricting
    ? ownerPasswordProblem(draft.password, draft.owner)
    : null;
  const ownerUnconfirmed =
    restricting && needsConfirming(draft.owner, draft.ownerAgain);
  const passwordWarning = tooLong
    ? `Too long: ${bytes}/${MAX_PDF_PASSWORD_BYTES} bytes.`
    : notLatin
      ? AES128_PASSWORD_CHARSET_MESSAGE
      : null;
  const blocked =
    draft.password.length === 0
      ? missing
      : (passwordWarning ??
        (unconfirmed
          ? CONFIRM_PASSWORD_FIRST
          : (ownerProblem ??
            (ownerUnconfirmed ? CONFIRM_OWNER_PASSWORD_FIRST : null))));
  return {
    lengths: {
      password: draft.password.length,
      passwordAgain: draft.passwordAgain.length,
      owner: draft.owner.length,
      ownerAgain: draft.ownerAgain.length,
    },
    unconfirmed,
    ownerUnconfirmed,
    passwordWarning,
    ownerProblem,
    blocked,
  };
}

/** The look before an upload: a skip for a file this mode has nothing to do with. */
export async function securityPreflight(
  mode: Mode,
  bytes: Uint8Array,
): Promise<void> {
  const access = await classifyPdfAccess(bytes);
  if (mode === "unlock" && access.kind === "unencrypted")
    throw new BatchSkip(UNLOCK_NOT_LOCKED_REASON);
  if (mode === "protect" && access.kind === "password-required")
    throw new BatchSkip(PROTECT_NEEDS_PASSWORD_REASON);
  if (mode === "protect" && access.kind === "restricted")
    throw new BatchSkip(PROTECT_RESTRICTED_REASON);
}

/** A file's job ran with no frozen password: never sent, said plainly. */
export const NO_PASSWORD_FROZEN =
  "This page no longer holds the password, so nothing was sent. Type it again and retry.";

export interface SecurityBatchProps {
  tool: Tool;
  files: File[];
  onReset: () => void;
  onSingle?: (file: File) => void;
}

/** Protect's non-secret choices: one strength, one set of permissions. */
interface Settings {
  keyLength: PdfKeyLength;
  restricting: boolean;
  permissions: PdfPermissions;
}

function settingsFor(
  mode: Mode,
  keyLength: PdfKeyLength,
  chosen: PdfPermissions,
): Settings {
  const permissions = effectivePermissions(chosen);
  return {
    keyLength,
    permissions,
    restricting: mode === "protect" && hasRestrictions(permissions),
  };
}

/** What one run sends, from a checked draft and the non-secret settings. */
function freezeOptions(
  mode: Mode,
  d: Readonly<Draft>,
  settings: Settings,
): FrozenSecurityOptions {
  return mode === "protect"
    ? {
        password: d.password,
        keyLength: settings.keyLength,
        ...(settings.restricting
          ? { ownerPassword: d.owner, permissions: settings.permissions }
          : {}),
      }
    : { password: d.password };
}

export function SecurityBatch({
  tool,
  files,
  onReset,
  onSingle,
}: SecurityBatchProps) {
  const mode: Mode = tool.slug === "protect-pdf" ? "protect" : "unlock";
  const draftRef = useRef<Draft>({ ...EMPTY });
  const frozenRef = useRef<FrozenSecurityOptions | null>(null);
  const [keyLength, setKeyLength] = useState<PdfKeyLength>(
    DEFAULT_PDF_KEY_LENGTH,
  );
  const [chosen, setChosen] = useState<PdfPermissions>(ALL_PERMISSIONS_ALLOWED);
  const settings = useMemo(
    () => settingsFor(mode, keyLength, chosen),
    [mode, keyLength, chosen],
  );
  const missing =
    mode === "protect"
      ? "Type a new password first."
      : "Type the password that opens these PDFs first.";
  const checkWith = useCallback(
    (d: Readonly<Draft>, s: Settings) =>
      checkSecurityDraft(d, {
        mode,
        keyLength: s.keyLength,
        restricting: s.restricting,
        missing,
      }),
    [mode, missing],
  );
  const [check, setCheck] = useState<DraftCheck>(() =>
    checkWith(EMPTY, settings),
  );

  // Leaving (New files, a Remove down to one file, the page) forgets both.
  useEffect(
    () => () => {
      draftRef.current = { ...EMPTY };
      frozenRef.current = null;
    },
    [],
  );

  const onInput = useCallback(
    (key: keyof Draft, value: string) => {
      draftRef.current = { ...draftRef.current, [key]: value };
      setCheck(checkWith(draftRef.current, settings));
    },
    [checkWith, settings],
  );
  // A strength or a permission changes the rules the typed draft is held to.
  const onKeyLength = (next: PdfKeyLength) => {
    setKeyLength(next);
    setCheck(checkWith(draftRef.current, settingsFor(mode, next, chosen)));
  };
  const onChosen = (next: PdfPermissions) => {
    setChosen(next);
    setCheck(checkWith(draftRef.current, settingsFor(mode, keyLength, next)));
  };

  // What a retry is held to: the strength and permissions of the run that
  // failed — non-secret, kept — and the password, typed again.
  const [ran, setRan] = useState<Settings>(settings);

  const onRun = useCallback(() => {
    frozenRef.current = freezeOptions(mode, draftRef.current, settings);
    setRan(settings);
    // The fields unmount as the batch starts; their copy goes with them.
    draftRef.current = { ...EMPTY };
    setCheck(checkWith(EMPTY, settings));
  }, [mode, settings, checkWith]);

  // The draft was already emptied at Run; what the run froze goes now.
  const onEnd = useCallback(() => {
    frozenRef.current = null;
  }, []);

  const freezeAndRetry = useCallback(
    (options: FrozenSecurityOptions, retry: () => void) => {
      frozenRef.current = options;
      retry();
    },
    [],
  );

  const run = useCallback<WorkerRun>(
    async (input, controls) => {
      const options = frozenRef.current;
      if (!options) throw new BatchItemError(NO_PASSWORD_FROZEN);
      return mode === "protect"
        ? runWorkerProtect(
            {
              ...input,
              password: options.password,
              ...(options.keyLength !== undefined
                ? { keyLength: options.keyLength }
                : {}),
              ...(options.ownerPassword !== undefined && options.permissions
                ? {
                    ownerPassword: options.ownerPassword,
                    permissions: options.permissions,
                  }
                : {}),
            },
            controls,
          )
        : runWorkerUnlock({ ...input, password: options.password }, controls);
    },
    [mode],
  );

  const preflight = useCallback(
    (_file: File, bytes: Uint8Array) => securityPreflight(mode, bytes),
    [mode],
  );

  const form = (
    <div className="flex flex-col gap-4">
      <PasswordFields
        idPrefix="security-batch"
        mode={mode}
        withOwner={settings.restricting}
        check={check}
        onInput={onInput}
        hint={
          mode === "protect"
            ? PROTECT_BATCH_PASSWORD_HINT
            : UNLOCK_BATCH_PASSWORD_HINT
        }
      />
      {mode === "protect" && (
        <StrengthChips value={keyLength} onChange={onKeyLength} />
      )}
      {mode === "protect" && (
        <Permissions
          chosen={chosen}
          effective={settings.permissions}
          onChange={onChosen}
        />
      )}
    </div>
  );

  return (
    <WorkerBatchRunner
      tool={tool}
      files={files}
      onReset={onReset}
      {...(onSingle ? { onSingle } : {})}
      run={run}
      settings={form}
      runBlocked={check.blocked}
      preflight={preflight}
      onRun={onRun}
      onEnd={onEnd}
      retry={(failed, retry) => (
        <RetryForm
          mode={mode}
          failed={failed}
          settings={ran}
          onSubmit={(options) => freezeAndRetry(options, retry)}
        />
      )}
    />
  );
}

/**
 * The password again, after a batch ended with failures: a new one for
 * Unlock ("Try another password"), the same rules for Protect. Its own
 * draft ref, never state; submitting hands the frozen options up, for the
 * failed rows only.
 */
function RetryForm({
  mode,
  failed,
  settings,
  onSubmit,
}: {
  mode: Mode;
  failed: number;
  settings: Settings;
  onSubmit: (options: FrozenSecurityOptions) => void;
}) {
  const draftRef = useRef<Draft>({ ...EMPTY });
  const headingId = useId();
  const blockedId = useId();
  const missing =
    mode === "protect"
      ? "Type the password again first."
      : "Type another password first.";
  const checkOf = (d: Readonly<Draft>) =>
    checkSecurityDraft(d, {
      mode,
      keyLength: settings.keyLength,
      restricting: settings.restricting,
      missing,
    });
  const [check, setCheck] = useState<DraftCheck>(() => checkOf(EMPTY));
  useEffect(
    () => () => {
      draftRef.current = { ...EMPTY };
    },
    [],
  );
  const heading =
    mode === "protect"
      ? protectRetryHeading(failed)
      : unlockRetryHeading(failed);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (check.blocked) return;
    const options = freezeOptions(mode, draftRef.current, settings);
    draftRef.current = { ...EMPTY };
    onSubmit(options);
  };
  const files = failed === 1 ? "1 PDF" : `${failed} PDFs`;
  return (
    <form
      data-security-retry
      aria-labelledby={headingId}
      onSubmit={submit}
      className="border-line rounded-panel flex flex-col gap-3 border p-4"
    >
      <h4 id={headingId} className="text-fg text-sm font-semibold">
        {heading}
      </h4>
      <p className="text-muted text-xs leading-relaxed">
        {SECURITY_RETRY_NOTE}
      </p>
      <PasswordFields
        idPrefix="security-retry"
        mode={mode}
        withOwner={settings.restricting}
        check={check}
        onInput={(key, value) => {
          draftRef.current = { ...draftRef.current, [key]: value };
          setCheck(checkOf(draftRef.current));
        }}
        label={mode === "unlock" ? "Another password" : undefined}
      />
      {check.blocked && (
        <p id={blockedId} className="text-warn text-xs">
          {check.blocked}
        </p>
      )}
      <div>
        <button
          type="submit"
          aria-disabled={check.blocked ? true : undefined}
          aria-describedby={check.blocked ? blockedId : undefined}
          className={buttonVariants({
            variant: "primary",
            size: "sm",
            className: cn("min-h-11 sm:min-h-0", check.blocked && "opacity-60"),
          })}
        >
          {mode === "protect" ? (
            <Lock className="size-4" aria-hidden />
          ) : (
            <Unlock className="size-4" aria-hidden />
          )}
          {mode === "protect" ? `Protect ${files} again` : `Try it on ${files}`}
        </button>
      </div>
    </form>
  );
}

/** The password fields of one form: uncontrolled, copied into a ref. */
function PasswordFields({
  idPrefix,
  mode,
  withOwner,
  check,
  onInput,
  hint,
  label,
}: {
  idPrefix: string;
  mode: Mode;
  withOwner: boolean;
  check: DraftCheck;
  onInput: (key: keyof Draft, value: string) => void;
  hint?: string;
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <SecretField
        id={`${idPrefix}-password`}
        label={
          label ?? (mode === "protect" ? "New password" : "Current password")
        }
        onInput={(v) => onInput("password", v)}
        note={[hint, check.passwordWarning].filter(Boolean).join(" ")}
        warn={check.passwordWarning !== null}
      />
      {mode === "protect" && (
        <ConfirmField
          id={`${idPrefix}-password-confirm`}
          label="Confirm password"
          onInput={(v) => onInput("passwordAgain", v)}
          differs={check.unconfirmed}
          length={check.lengths.passwordAgain}
          expected={check.lengths.password}
        />
      )}
      {withOwner && (
        <>
          <SecretField
            id={`${idPrefix}-owner-password`}
            label="Owner password"
            onInput={(v) => onInput("owner", v)}
            note={`Needed to lift these restrictions later, and must differ from the open password.${
              check.ownerProblem && check.lengths.owner > 0
                ? ` ${check.ownerProblem}`
                : ""
            }`}
            warn={check.ownerProblem !== null && check.lengths.owner > 0}
          />
          <ConfirmField
            id={`${idPrefix}-owner-password-confirm`}
            label="Confirm owner password"
            onInput={(v) => onInput("ownerAgain", v)}
            differs={check.ownerUnconfirmed}
            length={check.lengths.ownerAgain}
            expected={check.lengths.owner}
          />
        </>
      )}
    </div>
  );
}

/**
 * A masked, UNCONTROLLED password input with a show/hide toggle: React
 * never holds its value, `onInput` hands each change to the owner's ref.
 */
function SecretField({
  id,
  label,
  onInput,
  note,
  warn = false,
  onBlur,
}: {
  id: string;
  label: string;
  onInput: (value: string) => void;
  note?: string;
  warn?: boolean;
  onBlur?: () => void;
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
          type={reveal ? "text" : "password"}
          onChange={(event) => onInput(event.target.value)}
          onBlur={onBlur}
          autoComplete="new-password"
          spellCheck={false}
          aria-describedby={note ? `${id}-hint` : undefined}
          className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 focus:bg-wash rounded-ctl w-full border px-3 py-3 pr-11 text-sm transition outline-none"
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
      {note && (
        <p
          id={`${id}-hint`}
          className={cn(
            "text-xs leading-relaxed",
            warn ? "text-warn" : "text-muted",
          )}
        >
          {note}
        </p>
      )}
    </div>
  );
}

/** A password typed again; the mismatch is said once it is one (the panel's rule). */
function ConfirmField({
  id,
  label,
  onInput,
  differs,
  length,
  expected,
}: {
  id: string;
  label: string;
  onInput: (value: string) => void;
  differs: boolean;
  length: number;
  expected: number;
}) {
  const [left, setLeft] = useState(false);
  const shown = differs && length > 0 && (left || length >= expected);
  return (
    <div className="flex flex-col gap-1.5">
      <SecretField
        id={id}
        label={label}
        onInput={onInput}
        onBlur={() => setLeft(true)}
      />
      <p
        id={`${id}-hint`}
        role={shown ? "alert" : undefined}
        className={cn(
          "text-xs leading-relaxed",
          shown ? "text-warn" : "text-muted",
        )}
      >
        {shown ? PASSWORDS_DIFFER : "Type the same password again."}
      </p>
    </div>
  );
}

/** Protect's strength, one for every file. */
function StrengthChips({
  value,
  onChange,
}: {
  value: PdfKeyLength;
  onChange: (value: PdfKeyLength) => void;
}) {
  return (
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
          const active = value === level.keyLength;
          return (
            <button
              key={level.keyLength}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(level.keyLength)}
              title={level.description}
              className={cn(
                "rounded-tag inline-flex h-11 items-center gap-1.5 border px-3 py-1.5 text-xs font-medium transition",
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
        {PDF_ENCRYPTION_LEVELS.find((l) => l.keyLength === value)?.description}
      </p>
    </div>
  );
}

/** Protect's permissions, one set for every file (the panel's switches). */
function Permissions({
  chosen,
  effective,
  onChange,
}: {
  chosen: PdfPermissions;
  effective: PdfPermissions;
  onChange: (next: PdfPermissions) => void;
}) {
  return (
    <fieldset className="border-line rounded-panel flex flex-col gap-2 border p-3">
      <legend className="text-muted px-1 text-xs font-medium">
        Permissions
      </legend>
      <p className="text-muted text-xs leading-relaxed">
        Untick what people who open the files may not do. Leave every box ticked
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
                aria-disabled={inert || undefined}
                onChange={(event) => {
                  if (inert) return;
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
      <p className="text-muted text-xs leading-relaxed">
        {PERMISSIONS_ARE_FLAGS}
      </p>
    </fieldset>
  );
}

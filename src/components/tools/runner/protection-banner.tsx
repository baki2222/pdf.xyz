"use client";

import { useId, useState, type FormEvent } from "react";
import { Lock, LockOpen } from "lucide-react";
import type { PdfPermissions } from "@/lib/jobs/pdf-permissions";
import type { ProtectedPdf } from "@/lib/pdf/security/protected-pdf";
import { Spinner } from "./runner-kit";

/**
 * The note above a restricted PDF (Edit PDF, Fill Forms): what its author
 * allows, in plain words, and the one way past it — the owner password,
 * typed here and checked in the browser by the file's own security handler.
 *
 * The password is held in this component's state only while it is typed,
 * cleared as soon as it is checked, and never logged, stored or sent: the
 * check is a hash the file itself carries (`@/lib/pdf/security`).
 */

/** "printing, copying text and filling in the form", for the allowed few. */
function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * What the author allows, as a sentence a person reads — only the grants
 * this file has. `canFill` is the editor's reading of them (bit 9 or 6).
 */
export function allowedSentence(
  permissions: PdfPermissions,
  canFill: boolean,
): string {
  // A grant this editor cannot honour without rewriting the file: the
  // author allows changes, but only filling can be saved back under the
  // author's encryption here.
  if (permissions.modify)
    return "Its author allows changes, but without the owner password this editor can only fill in the form of an encrypted PDF.";
  const allowed: string[] = [];
  if (canFill) allowed.push("filling in the form");
  if (permissions.annotate) allowed.push("adding comments");
  if (permissions.print) allowed.push("printing");
  if (permissions.copy) allowed.push("copying text");
  return allowed.length > 0
    ? `Its author allows ${joinWords(allowed)}, but not changes to the page content.`
    : "Its author allows viewing it, but not changes of any kind.";
}

/** Said once the owner password is accepted. Matches Unlock PDF: no encryption. */
export const UNLOCKED_NOTE =
  "Owner password accepted: every tool is unlocked for this file. The PDF you download is not encrypted, so it no longer carries the author's restrictions or passwords.";

export const WRONG_OWNER_PASSWORD =
  "That isn't this PDF's owner password. Nothing was changed.";

export function ProtectionBanner({
  protection,
  unlocked,
  onUnlocked,
  surface,
}: {
  protection: ProtectedPdf;
  unlocked: boolean;
  onUnlocked: () => void;
  /** The editor also explains why its comment tools stay locked. */
  surface: "editor" | "forms";
}) {
  const id = useId();
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(false);
  const [wrong, setWrong] = useState(false);

  if (unlocked) {
    return (
      <p
        role="status"
        data-protection-banner="unlocked"
        className="border-ok/40 bg-ok/10 text-fg rounded-panel flex items-start gap-2 border px-3.5 py-2.5 text-sm"
      >
        <LockOpen className="text-ok mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{UNLOCKED_NOTE}</span>
      </p>
    );
  }

  const canFill = protection.canFillForms;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || checking) return;
    setChecking(true);
    setWrong(false);
    const typed = password;
    // Cleared before the check returns: the field never holds it after.
    setPassword("");
    let ok = false;
    try {
      ok = await protection.unlock(typed);
    } catch {
      ok = false;
    }
    setChecking(false);
    if (ok) onUnlocked();
    else setWrong(true);
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      data-protection-banner="restricted"
      className="border-warn/40 bg-warn/10 rounded-panel flex flex-col gap-3 border px-4 py-3.5 text-sm"
    >
      <div className="flex items-start gap-2.5">
        <Lock className="text-warn mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="flex flex-col gap-1">
          <h3 id={`${id}-title`} className="text-fg font-semibold">
            This PDF has limited permissions
          </h3>
          <p className="text-fg leading-relaxed">
            {allowedSentence(protection.permissions, canFill)} To change the
            page content, enter the owner password.
          </p>
          {canFill ? (
            <p className="text-muted text-xs leading-relaxed">
              What you fill in is saved inside the author&apos;s protection: the
              copy keeps the same restrictions and owner password.
              {surface === "editor" &&
                " Text, pictures, signatures, shapes, highlights and notes are written into the page itself here, so they need the owner password."}
            </p>
          ) : (
            <p className="text-muted text-xs leading-relaxed">
              Without the owner password this file can only be viewed here.
            </p>
          )}
        </div>
      </div>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${id}-pw`} className="text-fg text-xs font-medium">
            Owner password
          </label>
          <input
            id={`${id}-pw`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setWrong(false);
            }}
            aria-invalid={wrong || undefined}
            aria-describedby={wrong ? `${id}-err` : undefined}
            className="border-line bg-canvas text-fg rounded-ctl h-9 w-full border px-2.5 text-sm"
          />
        </div>
        <button
          type="submit"
          // aria-disabled, not disabled: a button that leaves the focus order
          // while it checks would drop the person who pressed it.
          aria-disabled={!password || checking || undefined}
          className="border-line bg-panel text-fg hover:bg-wash rounded-ctl inline-flex h-9 items-center gap-1.5 border px-3 text-sm font-semibold aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          {checking ? <Spinner /> : <LockOpen className="size-4" aria-hidden />}
          {checking ? "Checking…" : "Unlock all tools"}
        </button>
        <p className="text-muted w-full text-[11px]">
          Checked here in your browser against the file itself. It is not stored
          or sent anywhere.
        </p>
        {wrong && (
          <p id={`${id}-err`} role="alert" className="text-err w-full text-xs">
            {WRONG_OWNER_PASSWORD}
          </p>
        )}
      </form>
    </section>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { LockKeyhole } from "lucide-react";
import type { PdfPermissions } from "@/lib/jobs/pdf-permissions";
import { readFileBytes } from "@/lib/pdf/browser";
import type { EncryptionVerdict } from "@/lib/pdf/encryption";
import type { ToolGrant } from "@/lib/pdf/security/open-with-password";
import { buttonVariants } from "@/components/ui/button";
import {
  OWNER_PASSWORD_BUTTON,
  OWNER_PASSWORD_LABEL,
  type OwnerPasswordTool,
} from "@/lib/pdf/owner-password-copy";
import { PasswordField, withheldWords } from "./password-field";
import { ErrorNote } from "./runner-kit";
import type { OwnerOpened } from "./owner-unlock";

/**
 * The owner-password field under a restricted PDF's refusal in Merge PDF,
 * Extract Pages, Delete Pages, Rotate PDF and Extract Images
 * (competitor-audit backlog #11). Until 2026-11-17 each of them sent the
 * file to Unlock PDF — an upload — for a password the browser can check.
 *
 * THE RULE (owner decision): only the OWNER password lifts the author's
 * restrictions. The open password, or no password, never produces a copy
 * without them; that decision is `openForCopy`, the same one Grayscale PDF
 * makes, reached through `./owner-unlock` (its own chunk, fetched on
 * submit). This module is itself loaded with `next/dynamic` by each runner,
 * only once a restricted or password-protected file has been refused — no
 * tool page carries it in its first load.
 *
 * What each tool's output keeps is said in its hint, BEFORE the password is
 * typed: Merge PDF, Extract Pages and Delete Pages build a new file with no
 * encryption; Rotate PDF writes the rotation back under the author's own
 * encryption, so the copy keeps its passwords and restrictions; Extract
 * Images changes nothing in the PDF.
 *
 * The password lives in the form's state for the one check
 * (`./password-field`) and nowhere else: no storage write, request or DOM
 * node carries it — `owner-password-runners.test.tsx` and
 * `e2e/owner-password.spec.ts` check those, not this sentence.
 */

const CHECKED =
  "The password is checked here in your browser and never uploaded.";

export const OWNER_PASSWORD_HINT: Record<OwnerPasswordTool, string> = {
  "merge-pdf": `Type the owner password that set this PDF's restrictions and it joins the merge. The merged PDF has no password or restrictions. ${CHECKED}`,
  "extract-pages": `Type the owner password that set this PDF's restrictions and its pages can be extracted here. The new PDF has no password or restrictions. ${CHECKED}`,
  "remove-pages": `Type the owner password that set this PDF's restrictions and its pages can be deleted here. The new PDF has no password or restrictions. ${CHECKED}`,
  "rotate-pdf": `Type the owner password that set this PDF's restrictions and its pages can be rotated here. The rotated copy keeps the author's passwords, encryption and restrictions. ${CHECKED}`,
  "extract-images": `Type the owner password that set this PDF's restrictions and its images can be extracted here. The PDF itself is not changed. ${CHECKED}`,
};

/** Neither the owner password nor one that opens the file. */
export const OWNER_WRONG_PASSWORD =
  "That password is not this PDF's owner password. Nothing was changed.";

/** A password that opens the file, but not the owner's, of a restricted file. */
export function ownerWithheldMessage(permissions: PdfPermissions): string {
  return `That password opens this PDF, but it is not the owner password. The author doesn't allow ${withheldWords(permissions)}, and only the owner password lifts that. Nothing was changed.`;
}

export const OWNER_UNSUPPORTED =
  "This PDF's encryption can't be opened in your browser. Unlock PDF can remove it with the owner password.";

/** What the tool's output keeps, said once the field has opened the file. */
const OPENED_TAIL: Record<OwnerPasswordTool, string> = {
  "merge-pdf":
    "added to the list. The merged PDF has no password or restrictions.",
  "extract-pages": "The new PDF has no password or restrictions.",
  "remove-pages": "The new PDF has no password or restrictions.",
  "rotate-pdf":
    "The rotated copy keeps the author's passwords, encryption and restrictions.",
  "extract-images": "The PDF itself is not changed.",
};

function openedNote(tool: OwnerPasswordTool, how: string): string {
  return tool === "merge-pdf"
    ? `Opened with ${how}, here in your browser, and ${OPENED_TAIL[tool]}`
    : `Opened with ${how}, here in your browser. ${OPENED_TAIL[tool]}`;
}

/** Said above the tool once the owner password has opened the file. */
export const OWNER_OPENED_NOTE = Object.fromEntries(
  Object.keys(OPENED_TAIL).map((tool) => [
    tool,
    openedNote(tool as OwnerPasswordTool, "its owner password"),
  ]),
) as Record<OwnerPasswordTool, string>;

/**
 * Said instead once a password that is NOT the owner's opened it: a file
 * whose author restricts nothing, or (Rotate PDF, Extract Images) one whose
 * author grants what the tool does.
 */
export const PASSWORD_OPENED_NOTE = Object.fromEntries(
  Object.keys(OPENED_TAIL).map((tool) => [
    tool,
    openedNote(tool as OwnerPasswordTool, "its password"),
  ]),
) as Record<OwnerPasswordTool, string>;

/**
 * When the open password is enough, per tool: never for a tool whose
 * output drops the author's restrictions unless there are none.
 */
const OPEN_PASSWORD_SERVES: Record<OwnerPasswordTool, string> = {
  "merge-pdf": "If its author set no restrictions",
  "extract-pages": "If its author set no restrictions",
  "remove-pages": "If its author set no restrictions",
  "rotate-pdf": "If its author allows rotating its pages",
  "extract-images": "If its author allows copying its content",
};

/**
 * The refusal drawn ABOVE the field, in place of the tool-wide one (review
 * 2026-11-17: "Remove the password with Unlock PDF first, then try again"
 * sat directly over a field that says to type the owner password here, and
 * was the sentence a screen reader announced first). It points at the
 * field; Unlock PDF stays as the alternative. `subject` is "This PDF", or
 * the file's name in Merge PDF's list.
 */
export function ownerRefusalMessage(
  tool: OwnerPasswordTool,
  verdict: EncryptionVerdict | null | undefined,
  subject = "This PDF",
): string {
  if (verdict === "needs-password")
    return `${subject} is password-protected. Type its owner password below to use it here. ${OPEN_PASSWORD_SERVES[tool]}, the password that opens it works too. Or remove the password with Unlock PDF.`;
  if (verdict === "opens-without-password")
    return `${subject} has editing restrictions set by its author. Type the owner password that set them below to use it here, or remove them with Unlock PDF.`;
  return `${subject} is encrypted. Type its owner password below to use it here, or remove the encryption with Unlock PDF.`;
}

export function OwnerPasswordField({
  file,
  tool,
  grant,
  onOpened,
}: {
  file: File;
  tool: OwnerPasswordTool;
  /** Rotate PDF and Extract Images: the one grant they need (`openForCopy`). */
  grant?: ToolGrant;
  /**
   * The file opened: the runner reads its page board and takes it. A
   * rejection is said as {@link OWNER_UNSUPPORTED}.
   */
  onOpened: (opened: OwnerOpened) => Promise<void>;
}) {
  const check = async (typed: string): Promise<string | null> => {
    try {
      const [{ unlockWithOwnerPassword }, bytes] = await Promise.all([
        import("./owner-unlock"),
        readFileBytes(file),
      ]);
      const result = await unlockWithOwnerPassword(file, bytes, typed, grant);
      if (result.kind === "opened") {
        await onOpened(result.opened);
        return null;
      }
      return result.kind === "wrong-password"
        ? OWNER_WRONG_PASSWORD
        : result.kind === "withheld"
          ? ownerWithheldMessage(result.permissions)
          : OWNER_UNSUPPORTED;
    } catch {
      return OWNER_UNSUPPORTED;
    }
  };
  return (
    <PasswordField
      label={OWNER_PASSWORD_LABEL}
      hint={OWNER_PASSWORD_HINT[tool]}
      button={OWNER_PASSWORD_BUTTON}
      check={check}
      marker="data-owner-password"
    />
  );
}

/**
 * The refusal of an encrypted file, worded for the field, and the field
 * under it — OUTSIDE the refusal's live region, so a wrong password
 * announces its own error and not the whole block again (review
 * 2026-11-17, Merge PDF).
 */
export function OwnerRefusal({
  file,
  verdict,
  tool,
  subject,
  grant,
  onOpened,
  onDismiss,
}: {
  file: File;
  verdict: EncryptionVerdict | null | undefined;
  tool: OwnerPasswordTool;
  subject?: string;
  grant?: ToolGrant;
  onOpened: (opened: OwnerOpened) => Promise<void>;
  /** Merge PDF: take the refused file off the page. */
  onDismiss?: () => void;
}) {
  return (
    <div data-owner-refusal={tool} className="flex flex-col gap-2">
      <ErrorNote message={ownerRefusalMessage(tool, verdict, subject)} />
      <OwnerPasswordField
        file={file}
        tool={tool}
        grant={grant}
        onOpened={onOpened}
      />
      {onDismiss && (
        <div>
          <button
            type="button"
            onClick={onDismiss}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Said above the tool once the field opened the file. It takes the focus
 * when it draws: the form that held it is gone, and without this a keyboard
 * or screen-reader user was dropped on <body> with nothing said (review
 * 2026-11-17).
 */
export function OwnerOpenedNote({
  tool,
  owner,
}: {
  tool: OwnerPasswordTool;
  /** Opened by the owner password; else by one that opens the file. */
  owner: boolean;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <p
      ref={ref}
      tabIndex={-1}
      role="note"
      data-owner-opened={tool}
      className="border-info/40 bg-info/10 text-fg rounded-panel flex items-start gap-2 border px-4 py-3 text-sm"
    >
      <LockKeyhole className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{(owner ? OWNER_OPENED_NOTE : PASSWORD_OPENED_NOTE)[tool]}</span>
    </p>
  );
}

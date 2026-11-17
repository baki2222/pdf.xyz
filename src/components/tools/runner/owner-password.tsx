"use client";

import { LockKeyhole } from "lucide-react";
import type { PdfPermissions } from "@/lib/jobs/pdf-permissions";
import { readFileBytes } from "@/lib/pdf/browser";
import {
  OWNER_PASSWORD_BUTTON,
  OWNER_PASSWORD_LABEL,
  type OwnerPasswordTool,
} from "@/lib/pdf/owner-password-copy";
import { PasswordField, withheldWords } from "./password-field";
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
 * (`./password-field`), and is never stored, logged or sent.
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

/** Said above the tool once the owner password has opened the file. */
export const OWNER_OPENED_NOTE: Record<OwnerPasswordTool, string> = {
  "merge-pdf":
    "Opened with its owner password, here in your browser, and added to the list. The merged PDF has no password or restrictions.",
  "extract-pages":
    "Opened with its owner password, here in your browser. The new PDF has no password or restrictions.",
  "remove-pages":
    "Opened with its owner password, here in your browser. The new PDF has no password or restrictions.",
  "rotate-pdf":
    "Opened with its owner password, here in your browser. The rotated copy keeps the author's passwords, encryption and restrictions.",
  "extract-images":
    "Opened with its owner password, here in your browser. The PDF itself is not changed.",
};

export function OwnerPasswordField({
  file,
  tool,
  onOpened,
}: {
  file: File;
  tool: OwnerPasswordTool;
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
      const result = await unlockWithOwnerPassword(file, bytes, typed);
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

export function OwnerOpenedNote({ tool }: { tool: OwnerPasswordTool }) {
  return (
    <p
      role="note"
      data-owner-opened={tool}
      className="border-info/40 bg-info/10 text-fg rounded-panel flex items-start gap-2 border px-4 py-3 text-sm"
    >
      <LockKeyhole className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{OWNER_OPENED_NOTE[tool]}</span>
    </p>
  );
}

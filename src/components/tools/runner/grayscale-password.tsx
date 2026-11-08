"use client";

import { useId, useState, type FormEvent } from "react";
import { LockOpen } from "lucide-react";
import type { PdfPermissions } from "@/lib/jobs/pdf-permissions";
import { restrictedLabels } from "@/lib/jobs/pdf-permission-labels";
import { readFileBytes } from "@/lib/pdf/browser";
import { GRAYSCALE_PASSWORD_LABEL } from "@/lib/pdf/grayscale-password-label";
import { buttonVariants } from "@/components/ui/button";
import { ErrorNote, Spinner } from "./runner-kit";
import type { LoadedPdf } from "./use-single-pdf";

/**
 * Under Grayscale PDF's refusal of an encrypted file: a password field, so
 * the job stays on the device instead of a round trip through the server's
 * Unlock PDF (audit grayscale-pdf#6). The password is checked in the
 * browser by the file's own security handler (`./grayscale-unlock`, its own
 * chunk), held in this component's state only while it is typed, cleared
 * as it is checked, and never stored or sent.
 *
 * The grayscale copy has no encryption, so a password that does not entitle
 * the person to drop the author's restrictions is refused with the reason
 * (`./grayscale-unlock`). Sentences are constants, pinned by
 * `grayscale-password.test.tsx`.
 */

export { GRAYSCALE_PASSWORD_LABEL };

export const GRAYSCALE_PASSWORD_HINT =
  "Type the password that opens this PDF, or its owner password. It is checked here in your browser against the file itself and never uploaded.";

/**
 * For a file that opens WITHOUT a password (the restricted verdict): only its
 * owner password can change anything, so the hint asks for that one alone.
 */
export const GRAYSCALE_OWNER_PASSWORD_HINT =
  "This PDF opens without a password, so only its owner password helps here. It is checked here in your browser against the file itself and never uploaded.";

export const GRAYSCALE_WRONG_PASSWORD =
  "That password doesn't open this PDF. Nothing was changed.";

export const GRAYSCALE_UNSUPPORTED =
  "This PDF's encryption can't be opened in your browser. Unlock PDF can remove it with the password.";

export const GRAYSCALE_OPENED_NOTE =
  "Opened with its password, here in your browser. The grayscale copy is a new file without a password or encryption.";

/** "changing the document and adding comments" — the grants withheld. */
export function withheldWords(permissions: PdfPermissions): string {
  const words = restrictedLabels(permissions).map(
    (label) => label.charAt(0).toLowerCase() + label.slice(1),
  );
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export function grayscaleWithheldMessage(permissions: PdfPermissions): string {
  return `This PDF's author doesn't allow ${withheldWords(permissions)}. The grayscale copy is a new file without encryption, so it can't keep those restrictions: it needs the owner password.`;
}

export function GrayscalePassword({
  file,
  opensWithoutPassword = false,
  onOpened,
}: {
  file: File;
  /** The refusal's verdict was "opens-without-password". */
  opensWithoutPassword?: boolean;
  onOpened: (pdf: LoadedPdf) => void;
}) {
  const id = useId();
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || checking) return;
    const typed = password;
    // Cleared before the check returns: the field never holds it after.
    setPassword("");
    setChecking(true);
    setProblem(null);
    try {
      const [{ unlockForGrayscale }, bytes] = await Promise.all([
        import("./grayscale-unlock"),
        readFileBytes(file),
      ]);
      const result = await unlockForGrayscale(file, bytes, typed);
      if (result.kind === "opened") {
        onOpened(result.pdf);
        return;
      }
      setProblem(
        result.kind === "wrong-password"
          ? GRAYSCALE_WRONG_PASSWORD
          : result.kind === "withheld"
            ? grayscaleWithheldMessage(result.permissions)
            : GRAYSCALE_UNSUPPORTED,
      );
    } catch {
      setProblem(GRAYSCALE_UNSUPPORTED);
    } finally {
      setChecking(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      data-grayscale-password=""
      className="border-line bg-panel rounded-panel flex flex-col gap-3 border px-4 py-3.5"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${id}-pw`} className="text-fg text-sm font-medium">
            {GRAYSCALE_PASSWORD_LABEL}
          </label>
          <input
            id={`${id}-pw`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setProblem(null);
            }}
            aria-describedby={`${id}-hint`}
            aria-invalid={problem !== null || undefined}
            className="border-line bg-canvas text-fg rounded-ctl h-11 w-full border px-3 text-sm"
          />
        </div>
        <button
          type="submit"
          // aria-disabled, not disabled: the button stays in the focus order
          // while it checks (see `RunButton`).
          aria-disabled={!password || checking || undefined}
          className={buttonVariants({ variant: "secondary", size: "md" })}
        >
          {checking ? <Spinner /> : <LockOpen className="size-4" aria-hidden />}
          {checking ? "Checking…" : "Open with password"}
        </button>
      </div>
      <p id={`${id}-hint`} className="text-muted text-xs">
        {opensWithoutPassword
          ? GRAYSCALE_OWNER_PASSWORD_HINT
          : GRAYSCALE_PASSWORD_HINT}
      </p>
      {problem && <ErrorNote message={problem} />}
    </form>
  );
}

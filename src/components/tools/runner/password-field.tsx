"use client";

import { useId, useState, type FormEvent } from "react";
import { LockOpen } from "lucide-react";
import type { PdfPermissions } from "@/lib/jobs/pdf-permissions";
import { restrictedLabels } from "@/lib/jobs/pdf-permission-labels";
import { buttonVariants } from "@/components/ui/button";
import { ErrorNote, Spinner } from "./runner-kit";

/**
 * The password field under a refusal of an encrypted PDF — Grayscale PDF's
 * (`./grayscale-password`) and the owner-password field of Merge PDF,
 * Extract Pages, Delete Pages, Rotate PDF and Extract Images
 * (`./owner-password`). One form, so the promise both make about the
 * password is kept in one place:
 *
 * the password is held in this component's state only while it is typed,
 * CLEARED before the check returns, handed to `check` once, and never
 * stored, logged or sent. `check` returns the problem to show, or null when
 * the file opened (the caller has moved on).
 */
export function PasswordField({
  label,
  hint,
  button,
  check,
  marker,
}: {
  label: string;
  hint: string;
  /** The submit button's words. */
  button: string;
  check: (password: string) => Promise<string | null>;
  /** The form's data attribute, e.g. "data-grayscale-password". */
  marker: `data-${string}`;
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
      setProblem(await check(typed));
    } finally {
      setChecking(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      {...{ [marker]: "" }}
      className="border-line bg-panel rounded-panel flex flex-col gap-3 border px-4 py-3.5"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${id}-pw`} className="text-fg text-sm font-medium">
            {label}
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
          {checking ? "Checking…" : button}
        </button>
      </div>
      <p id={`${id}-hint`} className="text-muted text-xs">
        {hint}
      </p>
      {problem && <ErrorNote message={problem} />}
    </form>
  );
}

/** "changing the document and adding comments" — the grants withheld. */
export function withheldWords(permissions: PdfPermissions): string {
  const words = restrictedLabels(permissions).map(
    (label) => label.charAt(0).toLowerCase() + label.slice(1),
  );
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

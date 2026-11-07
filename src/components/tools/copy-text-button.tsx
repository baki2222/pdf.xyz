"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/** What the status line says after a press, by outcome. */
export const COPY_STATUS = {
  copied: "Copied to your clipboard.",
  failed:
    "Your browser did not allow copying. Select the text above and copy it instead.",
} as const;

/** How long the button shows its "Copied" state before reading as itself again. */
const COPIED_MS = 2500;

type CopyState = "idle" | "copied" | "failed";

/**
 * Puts `text` on the clipboard with one press. The text is already in the
 * page, so copying it sends nothing anywhere: `navigator.clipboard` is a
 * browser API, not a request.
 *
 * The outcome is said in a polite live region beside the button, because a
 * button whose label flips is not announced by every screen reader. A browser
 * without the API, or one that refuses (an insecure origin, a denied
 * permission), gets the honest fallback rather than a "Copied" that did not
 * happen.
 */
export function CopyTextButton({
  text,
  label,
  size = "lg",
  className,
}: {
  text: string;
  /** The button's visible name, e.g. "Copy text". */
  label: string;
  size?: "md" | "lg";
  /** Extra classes for the button (layout only, e.g. width). */
  className?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    let next: CopyState = "failed";
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        next = "copied";
      }
    } catch {
      next = "failed";
    }
    setState(next);
    if (next === "copied") {
      timer.current = window.setTimeout(() => setState("idle"), COPIED_MS);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={copy}
        className={buttonVariants({ variant: "secondary", size, className })}
      >
        {state === "copied" ? (
          <Check className="size-4" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
        {label}
      </button>
      <p role="status" aria-live="polite" className="text-muted text-xs">
        {state === "idle" ? "" : COPY_STATUS[state]}
      </p>
    </div>
  );
}

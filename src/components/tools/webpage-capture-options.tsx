"use client";

/**
 * Webpage to PDF's Capture group: what happens to the live page before it
 * prints. Every label and default comes from
 * `@/lib/jobs/webpage-capture-options`, the parser the job API and the worker
 * run, so the panel cannot offer what the worker refuses. Rendered only in
 * the panel's url mode.
 */
import { useId } from "react";
import {
  OVERLAY_MIN_SHARE,
  WEBPAGE_CAPTURE_CHOICES,
  WEBPAGE_CAPTURE_GROUP_LABEL,
  type WebpageCaptureOptions,
} from "@/lib/jobs/webpage-capture-options";

/** The line under each checkbox: what ticking it does. */
const HINTS: Readonly<Record<keyof WebpageCaptureOptions, string>> = {
  hideOverlays: `Hides the windows of common cookie-consent tools, and pop-ups covering at least ${Math.round(OVERLAY_MIN_SHARE * 100)}% of the screen. It can hide real content, so check the PDF.`,
  printStyles:
    "Untick to print the page as it looks in a browser window, ignoring the layout the site made for printing.",
  stamp:
    "Prints the address and the time it was captured, in UTC, at the foot of every page.",
};

export function WebpageCaptureGroup({
  value,
  onChange,
  disabled,
}: {
  value: WebpageCaptureOptions;
  onChange: (next: WebpageCaptureOptions) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
      <legend className="text-fg mb-1.5 text-xs font-medium">
        {WEBPAGE_CAPTURE_GROUP_LABEL}
      </legend>
      {WEBPAGE_CAPTURE_CHOICES.map((choice) => {
        // The hint sits outside the label so the checkbox's name is the
        // label alone; it is read as the description instead.
        const hintId = `${id}-${choice.key}-hint`;
        return (
          <div key={choice.key} className="flex flex-col">
            <label className="text-fg tap-row flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={value[choice.key]}
                aria-describedby={hintId}
                onChange={(e) =>
                  onChange({ ...value, [choice.key]: e.target.checked })
                }
                className="accent-accent mt-0.5 size-4 shrink-0"
              />
              <span>{choice.label}</span>
            </label>
            <p
              id={hintId}
              className="text-muted pl-6.5 text-xs leading-relaxed"
            >
              {HINTS[choice.key]}
            </p>
          </div>
        );
      })}
    </fieldset>
  );
}

"use client";

/**
 * Webpage to PDF's Capture group: what happens to the live page before it
 * prints. Every label and default comes from
 * `@/lib/jobs/webpage-capture-options`, the parser the job API and the worker
 * run, so the panel cannot offer what the worker refuses. Rendered only in
 * the panel's url mode.
 */
import {
  OVERLAY_MIN_SHARE,
  WEBPAGE_CAPTURE_CHOICES,
  WEBPAGE_CAPTURE_GROUP_LABEL,
  type WebpageCaptureOptions,
} from "@/lib/jobs/webpage-capture-options";

/** The line under each checkbox: what ticking it does. */
const HINTS: Readonly<Record<keyof WebpageCaptureOptions, string>> = {
  hideOverlays: `Hides the windows of common cookie-consent tools, and pop-ups covering at least ${Math.round(OVERLAY_MIN_SHARE * 100)}% of the screen. It can hide real content, so check the PDF.`,
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
  return (
    <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
      <legend className="text-fg mb-1.5 text-xs font-medium">
        {WEBPAGE_CAPTURE_GROUP_LABEL}
      </legend>
      {WEBPAGE_CAPTURE_CHOICES.map((choice) => (
        <label
          key={choice.key}
          className="text-fg tap-row flex items-start gap-2.5 text-sm"
        >
          <input
            type="checkbox"
            checked={value[choice.key]}
            onChange={(e) =>
              onChange({ ...value, [choice.key]: e.target.checked })
            }
            className="accent-accent mt-0.5 size-4 shrink-0"
          />
          <span className="flex flex-col gap-0.5">
            <span>{choice.label}</span>
            <span className="text-muted text-xs leading-relaxed">
              {HINTS[choice.key]}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

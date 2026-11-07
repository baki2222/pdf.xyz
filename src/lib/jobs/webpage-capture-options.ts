/**
 * Webpage to PDF's capture options — what happens to the live page between
 * loading it and printing it. Webpage to PDF only: HTML to PDF and EPUB to
 * PDF never read these keys.
 *
 * Feature-scoped on purpose (bundle rule, 2026-11-07): only the Webpage to
 * PDF panel, the job API's intake check and the worker import this module,
 * never `./html-render-options`, which three tool pages share.
 *
 * Every default is the render as it ran before these options existed, so a
 * client that sends none of these keys gets nothing new:
 *   - `hideOverlays` (off) — hide cookie-consent windows and pop-ups that
 *     cover the screen (`@/lib/workers/html-render/overlays` says exactly
 *     what is hidden). Off by default because it can hide real content;
 *   - `printStyles` (on) — print with the site's print stylesheet, as every
 *     render did. Off, Chromium is told to use SCREEN media before measuring
 *     and printing, so the PDF shows the page's screen layout (audit
 *     webpage-to-pdf#3).
 */
import { apiError, type ParseResult } from "./responses";

export interface WebpageCaptureOptions {
  hideOverlays: boolean;
  printStyles: boolean;
}

export const DEFAULT_WEBPAGE_CAPTURE_OPTIONS: WebpageCaptureOptions = {
  hideOverlays: false,
  printStyles: true,
};

/**
 * The panel's checkboxes, in the order it draws them. The FAQ and guide
 * quote these same labels (through {@link WEBPAGE_CAPTURE_LABELS}).
 */
export const WEBPAGE_CAPTURE_CHOICES: readonly {
  key: keyof WebpageCaptureOptions;
  label: string;
}[] = [
  { key: "hideOverlays", label: "Hide cookie notices and pop-ups" },
  { key: "printStyles", label: "Use the site's print styles" },
];

/** Each checkbox's label by option key. */
export const WEBPAGE_CAPTURE_LABELS = Object.fromEntries(
  WEBPAGE_CAPTURE_CHOICES.map((c) => [c.key, c.label]),
) as Readonly<Record<keyof WebpageCaptureOptions, string>>;

/**
 * The share of the window a pinned (`position: fixed` or `sticky`) element
 * must cover for "Hide cookie notices and pop-ups" to hide it. Here, not in
 * the worker's `overlays` module, so the panel can state it without shipping
 * the worker's selector list.
 */
export const OVERLAY_MIN_SHARE = 0.5;

/** The panel's group legend. */
export const WEBPAGE_CAPTURE_GROUP_LABEL = "Capture";

const KEYS = Object.keys(
  DEFAULT_WEBPAGE_CAPTURE_OPTIONS,
) as readonly (keyof WebpageCaptureOptions)[];

/**
 * Parse a `webpage-to-pdf` job's capture options. Strict, like the layout
 * parser: a non-boolean value is refused with its field named, never
 * coerced. Keys it does not own are left alone.
 */
export function parseWebpageCaptureOptions(
  options: Record<string, unknown>,
): ParseResult<WebpageCaptureOptions> {
  const value = { ...DEFAULT_WEBPAGE_CAPTURE_OPTIONS };
  for (const key of KEYS) {
    const raw = options[key];
    if (raw === undefined) continue;
    if (typeof raw !== "boolean") {
      const message = `\`options.${key}\` must be a boolean.`;
      return {
        ok: false,
        error: apiError("invalid_request", message, [
          { field: `options.${key}`, message },
        ]),
      };
    }
    value[key] = raw;
  }
  return { ok: true, value };
}

/** Only what differs from the defaults, so an untouched panel sends nothing new. */
export function webpageCaptureOptionsBag(
  options: WebpageCaptureOptions,
): Record<string, unknown> {
  const bag: Record<string, unknown> = {};
  for (const key of KEYS)
    if (options[key] !== DEFAULT_WEBPAGE_CAPTURE_OPTIONS[key])
      bag[key] = options[key];
  return bag;
}

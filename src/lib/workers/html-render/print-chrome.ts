import { HTML_DOCUMENT_URL } from "./document-url";

/**
 * What Chromium's DEFAULT print header and footer stamp on every page, read
 * back out of the text a user receives.
 *
 * The CLI this renderer used until 2026-09 (`--print-to-pdf`, no
 * `--no-pdf-header-footer`) printed the date and the page `<title>` along the
 * top of every page, and the document's URL and a page count along the bottom.
 * For an upload that URL was the worker's own copy of it,
 * `file:///tmp/pdfxyz-html-XXXXXX/input.html`: an invoice converted here went
 * out with a print date, its tab title and our temp layout on it.
 *
 * One predicate, used by BOTH instruments that can see the output: the local
 * real-Chromium test (`native.chromium.test.ts`, where the pre-fix argv is its
 * positive control) and the production proof (`scripts/worker-prove-tools.ts`),
 * so the proof run against the hand-built worker image asks exactly the
 * question the local test showed can fail.
 */
export interface PrintChromeContext {
  /** The page's `<title>` — text that appears ONLY in the header. */
  title?: string;
  /** The rendered URL (webpage-to-pdf) — text that appears ONLY in the footer. */
  sourceUrl?: string;
}

const SERVED_HOST = new URL(HTML_DOCUMENT_URL).host;

const FIXED_MARKERS: readonly { marker: RegExp; what: string }[] = [
  { marker: /file:\/\//i, what: "a file:// URL (the worker's copy)" },
  { marker: /pdfxyz-html-/, what: "the worker's temp directory" },
  {
    marker: new RegExp(SERVED_HOST.replace(/\./g, "\\.")),
    what: "the address the upload is served from",
  },
  // Chromium's header date, en-US short form: "9/27/26, 1:42 AM".
  {
    marker: /\b\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\b/,
    what: "a print date",
  },
];

/** Each piece of print header/footer found in `text`; empty when there is none. */
export function printChromeLeaks(
  text: string,
  context: PrintChromeContext = {},
): string[] {
  const found = FIXED_MARKERS.filter((m) => m.marker.test(text)).map(
    (m) => m.what,
  );
  const title = context.title?.trim();
  if (title && text.includes(title)) found.push("the page <title>");
  const url = context.sourceUrl?.replace(/\/+$/, "");
  if (url && (text.includes(url) || containsElidedUrl(text, url)))
    found.push("the page URL");
  return found;
}

/**
 * Chromium draws the footer URL in an HTML template that truncates overflow
 * with an ellipsis, so a URL longer than the footer prints as its PREFIX and
 * "…" — and the whole-URL check above misses it. Found 2026-10-08: on CI's
 * Linux Chromium the pre-fix control's `file:///tmp/…` footer was not found
 * as "the page URL", while Windows (a shorter temp path) printed it whole. A
 * long webpage URL in production elides the same way, so this is the guard's
 * blind spot, not the test's.
 *
 * The prefix must be long enough to name THIS url rather than any URL:
 * {@link ELIDED_PREFIX_MIN} characters (`file:///tmp/pdfxyz-html-` alone is
 * 24, a web origin plus path is longer).
 */
export const ELIDED_PREFIX_MIN = 24;

export function containsElidedUrl(text: string, url: string): boolean {
  const min = Math.min(ELIDED_PREFIX_MIN, url.length - 1);
  if (min < 1) return false;
  for (const match of text.matchAll(/…|\.\.\./g)) {
    const before = text.slice(
      Math.max(0, match.index - url.length),
      match.index,
    );
    for (let k = before.length; k >= min; k--) {
      if (url.startsWith(before.slice(before.length - k))) return true;
    }
  }
  return false;
}

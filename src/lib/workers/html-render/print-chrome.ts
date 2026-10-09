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

/**
 * Each piece of print header/footer found in `text`; empty when there is none.
 *
 * Every check also runs on the text with its whitespace removed. On CI's Linux
 * Chromium (2026-10-08) the footer read `fi le:///tmp/pdfxyz-isolation-…/chrome.html`:
 * the URL was printed WHOLE, but the extractor split the "fi" ligature, so
 * neither "the page URL" nor the `file://` marker matched — on the pre-fix
 * positive control, where both must. Windows extracted it unbroken. A
 * production webpage URL drawn in the same font splits the same way, so this
 * was a blind spot of the detector the production proof uses, not of the test.
 */
export function printChromeLeaks(
  text: string,
  context: PrintChromeContext = {},
): string[] {
  const squeezed = text.replace(/\s+/g, "");
  const inEither = (test: (t: string) => boolean) =>
    test(text) || test(squeezed);
  const found = FIXED_MARKERS.filter((m) =>
    inEither((t) => m.marker.test(t)),
  ).map((m) => m.what);
  const title = context.title?.trim();
  const squeezedTitle = title?.replace(/\s+/g, "");
  if (title && (text.includes(title) || squeezed.includes(squeezedTitle!)))
    found.push("the page <title>");
  const url = context.sourceUrl?.replace(/\/+$/, "");
  if (url && inEither((t) => t.includes(url) || containsElidedUrl(t, url)))
    found.push("the page URL");
  return found;
}

/**
 * Chromium's header/footer template can also truncate an overflowing URL with
 * an ellipsis, printing its PREFIX and "…". That shape has NOT been observed in
 * our runs (the 2026-10-08 CI miss was the ligature split above, which an
 * earlier version of this comment wrongly blamed on elision); it is accepted
 * defensively and pinned by print-chrome.test.ts.
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

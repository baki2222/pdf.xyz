/**
 * Webpage to PDF's record of where and when (audit webpage-to-pdf#7):
 *
 *   - "Add the address and date" (off by default): `Page.printToPDF` draws
 *     {@link stampFooterTemplate} at the foot of every page — the address
 *     the job asked for and the capture time in UTC — and an EMPTY header,
 *     because Chromium's default header is the date and the page's <title>,
 *     which this never prints. The bottom margin is raised to at least
 *     {@link STAMP_MIN_MARGIN_INCHES} so the line has room when Margins is
 *     None or Small (a page's own CSS `@page` margin can still take that
 *     room while Page size is "As the page sets it");
 *   - bookmarks from the page's headings, on every webpage render
 *     ({@link WEBPAGE_OUTLINE_PARAMS}, Chromium's `generateDocumentOutline`).
 *
 * Pure — no Node built-in — so the tool page's copy can read it.
 */

/** Chromium builds the PDF's bookmarks from the page's h1-h6. */
export const WEBPAGE_OUTLINE_PARAMS = {
  generateDocumentOutline: true,
} as const;

/** The least bottom margin, in inches, a stamped page prints with. */
export const STAMP_MIN_MARGIN_INCHES = 0.4;

/** A header template that draws nothing: Chromium's default is title + date. */
export const STAMP_EMPTY_HEADER = "<span></span>";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "8 November 2026, 14:03 UTC" — the worker's clock, in UTC. */
export function stampDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCDate()} ${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}, ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())} UTC`;
}

/** The words of the stamp line, before HTML escaping. */
export function stampText(url: string, now: Date): string {
  return `Captured from ${url} on ${stampDate(now)}`;
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/**
 * The footer template: one line, the address escaped as text (never markup),
 * cut with an ellipsis rather than wrapped past the margin.
 */
export function stampFooterTemplate(url: string, now: Date): string {
  return `<div style="width:100%;padding:0 0.4in;font:8px sans-serif;color:#444;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(stampText(url, now))}</div>`;
}

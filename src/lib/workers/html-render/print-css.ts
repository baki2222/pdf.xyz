/**
 * Does the page being captured ship print styles? (review of audit wave 2
 * webpage-to-pdf#5, 2026-11-28.)
 *
 * Webpage to PDF starts on the Desktop screen width, which lays the print out
 * 1280 CSS px wide and shrinks it to the paper (`htmlPrintGeometry`'s scale,
 * about 0.56 on A4). That is right for a site drawn only for screens, and
 * wrong for one with a print stylesheet: a `12pt` written for paper came out
 * at 6.72pt. So while "Use the site's print styles" is ticked and the page
 * has print styles, the print is laid out at the PAPER's width
 * (`viewport: "auto"`, the layout every render had before the Desktop start);
 * the chosen screen width still decides the window the page loads into.
 * `print-css.chromium.test.ts` reads the font size back from the PDF.
 *
 * "Has print styles" is read from two places, so a sheet from another origin
 * (which page script cannot read) is seen too:
 *   - every stylesheet the worker FETCHED for the page ({@link cssHasPrintRules}
 *     on its text: an `@media … print`, an `@page`, or an `@import … print`);
 *   - the page itself, in an isolated world ({@link PRINT_CSS_IN_PAGE_SCRIPT}):
 *     a `<link>` or `<style>` whose `media` names print, or a `<style>` whose
 *     text has such a rule.
 *
 * A false "yes" (an `@media not print`, a rule inside a comment) prints the
 * paper-width layout, as every render did before the Desktop start; a false
 * "no" is what the Desktop start does to every page.
 */

/** `@media … print …`, `@page`, `@import url(…) print`. Case-insensitive. */
const PRINT_RULE = /@media[^{;]*\bprint\b|@page\b|@import[^;]*\bprint\b/i;

/** The most of a fetched stylesheet read for print rules (first 2 MB). */
export const PRINT_CSS_SCAN_BYTES = 2 * 1024 * 1024;

export function cssHasPrintRules(text: string): boolean {
  return PRINT_RULE.test(text);
}

/** {@link cssHasPrintRules} on a fetched body, read as UTF-8. */
export function cssBytesHavePrintRules(body: Uint8Array): boolean {
  const head =
    body.byteLength > PRINT_CSS_SCAN_BYTES
      ? body.subarray(0, PRINT_CSS_SCAN_BYTES)
      : body;
  return cssHasPrintRules(new TextDecoder("utf-8").decode(head));
}

/**
 * Evaluated in an isolated world after the page has run: true when a
 * `<link rel=stylesheet>` or `<style>` names print in its `media`, or a
 * `<style>` holds a print rule. The pattern is {@link PRINT_RULE}'s source.
 */
export const PRINT_CSS_IN_PAGE_SCRIPT = `(() => {
  const rule = new RegExp(${JSON.stringify(PRINT_RULE.source)}, "i");
  const named = (el) => /\\bprint\\b/i.test(el.getAttribute("media") || "");
  const links = document.querySelectorAll('link[rel~="stylesheet" i]');
  const styles = document.querySelectorAll("style");
  for (const el of links) if (named(el)) return true;
  for (const el of styles)
    if (named(el) || rule.test(el.textContent || "")) return true;
  return false;
})()`;

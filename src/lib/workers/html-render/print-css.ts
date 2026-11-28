/**
 * Does the page being captured ship print styles that lay it out for paper?
 * (review of audit wave 2 webpage-to-pdf#5, 2026-11-28.)
 *
 * Webpage to PDF starts on the Desktop screen width, which lays the print out
 * 1280 CSS px wide and shrinks it to the paper (`htmlPrintGeometry`'s scale,
 * about 0.56 on A4). That is right for a site drawn only for screens, and
 * wrong for one with a print stylesheet: a `12pt` written for paper came out
 * at 6.72pt. So while "Use the site's print styles" is ticked and the page
 * has such print styles, the print is laid out at the PAPER's width
 * (`viewport: "auto"`, the layout every render had before the Desktop start);
 * the chosen screen width still decides the window the page loads into.
 * `print-css.chromium.test.ts` reads the font size back from the PDF.
 *
 * Not any print rule at all (verifier of lane w2r, 2026-11-28): Bootstrap 5's
 * `@media print{.d-print-none{display:none!important}}` or a theme's
 * `@media print{nav{display:none}}` only hide things, and switching those
 * sites to the paper width printed their narrow layout at the screen's 16px,
 * the very defect #5 named. The signal is one of:
 *   - an `@page` rule (it names the paper);
 *   - a whole stylesheet for print: `@import … print`, or a `<link>` whose
 *     `media` names print (from another origin its text cannot be read);
 *   - inside an `@media … print` block (not `not print`), a declaration of
 *     `font-size`, `font` or `zoom`, or of `width`, `min-width` or
 *     `max-width` with a value that is not a percentage (`img{max-width:100%}`,
 *     which print resets ship, only keeps images inside the page).
 *
 * It is read from two places, so a sheet from another origin is seen too:
 *   - every stylesheet the worker FETCHED for the page ({@link cssHasPrintRules}
 *     on its text);
 *   - the page itself, in an isolated world: {@link PRINT_CSS_IN_PAGE_SCRIPT}
 *     hands back the `<style>` texts and {@link inPageHasPrintRules} reads them
 *     with the same {@link cssHasPrintRules}.
 *
 * A false "yes" prints the paper-width layout, as every render did before the
 * Desktop start; a false "no" is what the Desktop start does to every page.
 */

/** A paper rule or a whole sheet for print: `@page`, `@import … print`. */
const PAPER_RULE = /@page\b|@import[^;]*\bprint\b/i;
/** `@media <prelude> {`; the prelude is then checked for `print` and `not`. */
const MEDIA_OPEN = /@media([^{;]*)\{/gi;
/** A declaration that sizes the type or a box, with its value. */
const SIZING_DECLARATION =
  /(?:^|[;{\s])(font-size|font|zoom|(?:min-|max-)?width)\s*:\s*([^;}]*)/gi;
const COMMENT = /\/\*[\s\S]*?\*\//g;

/** The text between the `{` at `open` and its matching `}` (or the end). */
function blockAt(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

function sizesSomething(block: string): boolean {
  for (const m of block.matchAll(SIZING_DECLARATION)) {
    const property = m[1]!.toLowerCase();
    if (!property.endsWith("width") || !m[2]!.includes("%")) return true;
  }
  return false;
}

/** The most of a fetched stylesheet read for print rules (first 2 MB). */
export const PRINT_CSS_SCAN_BYTES = 2 * 1024 * 1024;

export function cssHasPrintRules(text: string): boolean {
  const css = text.replace(COMMENT, "");
  if (PAPER_RULE.test(css)) return true;
  for (const m of css.matchAll(MEDIA_OPEN)) {
    const prelude = m[1]!;
    if (!/\bprint\b/i.test(prelude) || /\bnot\b/i.test(prelude)) continue;
    if (sizesSomething(blockAt(css, m.index + m[0].length - 1))) return true;
  }
  return false;
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
 * Evaluated in an isolated world after the page has run: `true` when a
 * `<link rel=stylesheet>` names print in its `media`; otherwise every
 * `<style>`'s text (one whose `media` names print wrapped in
 * `@media print{…}`), at most {@link PRINT_CSS_SCAN_BYTES} characters in all,
 * for {@link inPageHasPrintRules} to read in the worker.
 */
export const PRINT_CSS_IN_PAGE_SCRIPT = `(() => {
  const named = (el) => /\\bprint\\b/i.test(el.getAttribute("media") || "");
  const links = document.querySelectorAll('link[rel~="stylesheet" i]');
  const styles = document.querySelectorAll("style");
  for (const el of links) if (named(el)) return true;
  const texts = [];
  let left = ${PRINT_CSS_SCAN_BYTES};
  for (const el of styles) {
    if (left <= 0) break;
    const raw = (el.textContent || "").slice(0, left);
    left -= raw.length;
    texts.push(named(el) ? "@media print{" + raw + "}" : raw);
  }
  return texts;
})()`;

/** Reads {@link PRINT_CSS_IN_PAGE_SCRIPT}'s answer in the worker. */
export function inPageHasPrintRules(value: unknown): boolean {
  if (value === true) return true;
  return (
    Array.isArray(value) &&
    value.some((t) => typeof t === "string" && cssHasPrintRules(t))
  );
}

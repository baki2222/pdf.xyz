/**
 * What /privacy §9 says about the site's own protections.
 *
 * Until 2026-10-10 §9 promised "a strict Content Security Policy" while the
 * served script-src carried 'unsafe-inline' (and 'wasm-unsafe-eval'), and
 * said "a deployment with no scanner refuses to start" — true only when an
 * opt-in flag is set, which strict mode does not imply.
 *
 * `CSP_ALLOWS_INLINE_SCRIPTS` is a statement about the served header, and
 * `privacy-truth.test.tsx` reads the header the real `next.config.mjs`
 * produces and fails when the two disagree — so tightening the policy turns
 * this red until the sentence is rewritten to say so, and loosening it
 * cannot leave a promise behind.
 *
 * Copy: walked by `copyFiles()` (`src/lib/privacy`).
 */
export const CSP_ALLOWS_INLINE_SCRIPTS = true;

export const CSP_SENTENCE =
  "The site sends a Content Security Policy that limits where scripts, styles, connections and frames may come from — though it does allow inline scripts, which the site's framework uses — along with related protections against common web attacks.";

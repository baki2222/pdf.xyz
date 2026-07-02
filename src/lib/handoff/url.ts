/**
 * Pure URL helpers for the `?handoff=<id>` token that carries a workspace →
 * tool hand-off. Extracting the string logic here (out of the React hook that
 * touches `window`/`history`) makes the two guarantees the receiving runner
 * depends on directly unit-testable:
 *
 *  - **Read** only a well-formed token (validated by {@link looksLikeHandoffId});
 *    a malformed or absent param yields null.
 *  - **Strip** the token from the address bar reliably, preserving the path,
 *    hash, and every other query param, so a reload can't replay a consumed
 *    claim and the token never lingers in a shareable/logged URL.
 *
 * The hook keeps only the thin `window` glue; all the parsing/rewriting that is
 * easy to get subtly wrong lives here.
 */

import { looksLikeHandoffId } from "./ids";

/** The single query parameter that names a hand-off record. */
export const HANDOFF_PARAM = "handoff";

/**
 * Read a validated hand-off id from a URL query string (e.g. `location.search`).
 * Returns null for a missing, malformed, or non-token value — never throws.
 */
export function readHandoffId(search: string): string | null {
  try {
    const id = new URLSearchParams(search).get(HANDOFF_PARAM);
    return id && looksLikeHandoffId(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Return `href` with the `handoff` param removed and everything else — path,
 * other query params, and hash — preserved. Returns the input unchanged when
 * there is no token to strip or when it can't be parsed, so callers can compare
 * by identity to decide whether a history rewrite is even needed.
 */
export function stripHandoffFromUrl(href: string): string {
  try {
    const url = new URL(href);
    if (!url.searchParams.has(HANDOFF_PARAM)) return href;
    url.searchParams.delete(HANDOFF_PARAM);
    return url.toString();
  } catch {
    return href;
  }
}

/**
 * Pure URL helpers for the `?handoff=<id>` token — how a hand-off's token
 * travelled to the next page until 2026-10-20, and still read (then
 * stripped) when an address names one. Launches no longer write it: the
 * token now goes in this tab's sessionStorage (`./carry`). Extracting the
 * string logic here (out of the React hook that touches
 * `window`/`history`) makes the two guarantees the receiving runner
 * depends on directly unit-testable:
 *
 *  - **Read** only a well-formed token (validated by {@link looksLikeHandoffId});
 *    a malformed or absent param yields null.
 *  - **Strip** the token from the address bar reliably, preserving the path,
 *    hash, and every other query param, so a reload can't replay a consumed
 *    claim and the token does not stay in the address a reader copies or
 *    bookmarks.
 *
 * WHY IT LEFT THE ADDRESS (2026-10-17, then 2026-10-20). An in-app
 * navigation fetches the new page's payload from the server with the
 * address it is going to — `GET /tools/x?handoff=h_…&_rsc=…` — so while
 * launches put the token here it reached the server in that request's URL,
 * and whatever logs requests (the host's access logs) held it. Off this
 * device it opened nothing (it only names a record in this browser's own
 * IndexedDB, single-use and short-lived), but it had no reason to be
 * there. Launches now navigate to the plain address and carry the token in
 * this tab's sessionStorage, which no request sends;
 * `e2e/handoff-transport.spec.ts` reads every request URL of a hop and
 * finds no `handoff=`. An address that still names a token — typed, or
 * kept from before — sends it to the server as any URL does. Analytics
 * never see it (`@/lib/analytics/ga4`, `ga4-gate`).
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

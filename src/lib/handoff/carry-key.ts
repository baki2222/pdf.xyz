/**
 * Where a hand-off's token travels from the page that stashed the files to
 * the page that claims them: this tab's sessionStorage, under one key, as
 * `{ path, id }` — the page it is addressed to and the token. Not the
 * address bar: a navigation's payload fetch carries its URL to the server,
 * and the token with it (`./url` has the history).
 *
 * Alone in its module, with the one read the job-steps row needs, so that
 * row (`TicketRail`, on every tool page's first load) and `/privacy`'s
 * registry (`@/lib/browser-storage`) can name it without the hand-off
 * library. The claim (`./carry`) validates and consumes; this only looks.
 */
export const HANDOFF_CARRY_KEY = "pdfxyz.handoff";

/**
 * The token carried to `pathname`, as stored: unvalidated, not consumed.
 * Null when nothing is carried, when it is addressed to another page, or
 * when storage cannot be read.
 */
export function peekCarriedHandoff(pathname: string): string | null {
  try {
    const raw = window.sessionStorage.getItem(HANDOFF_CARRY_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const { path, id } = value as { path?: unknown; id?: unknown };
    return path === pathname && typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

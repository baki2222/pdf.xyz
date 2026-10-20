/**
 * Where a page's file went: written onto the page's OWN history entry as
 * the files leave for another tool (`launchWithFiles`), read when that
 * entry is shown again — Back, or a reload of it.
 *
 * The page keeps no copy of what it sent (the next tool claimed it, and a
 * page's files live only while it is open), so Back used to land on an
 * empty tool with no word of where the file had gone. The entry now says,
 * and the runner shows it (`HandoffProblem`) until it is dismissed.
 *
 * History state, not sessionStorage: it belongs to the one entry, so a NEW
 * visit to the same tool (a link, the address bar) says nothing. It holds
 * the tool's slug and a count — never a file, its name or its size.
 * `e2e/handoff-transport.spec.ts` holds Back, a reload, Dismiss, two hops
 * and the plain-visit control.
 */

const KEY = "pdfxyzWentOnTo";

export interface Departure {
  /** The tool the files went on to. */
  readonly slug: string;
  /** How many files went. */
  readonly count: number;
}

function current(): Record<string, unknown> {
  const state: unknown = window.history.state;
  return state && typeof state === "object"
    ? (state as Record<string, unknown>)
    : {};
}

/**
 * Note on this entry that its files went on to `slug`. Keeps the router's
 * own state (it is spread back), and changes no address.
 */
export function markDeparture(departure: Departure): void {
  try {
    window.history.replaceState(
      { ...current(), [KEY]: { slug: departure.slug, count: departure.count } },
      "",
    );
  } catch {
    // No history to write to: Back then shows the plain tool, as before.
  }
}

/** This entry's departure, or null. */
export function readDeparture(): Departure | null {
  try {
    const value = current()[KEY];
    if (!value || typeof value !== "object") return null;
    const { slug, count } = value as { slug?: unknown; count?: unknown };
    return typeof slug === "string" &&
      typeof count === "number" &&
      Number.isInteger(count) &&
      count > 0
      ? { slug, count }
      : null;
  } catch {
    return null;
  }
}

/** Forget this entry's departure (the visitor dismissed it). */
export function forgetDeparture(): void {
  try {
    const state = current();
    if (!(KEY in state)) return;
    const rest = { ...state };
    delete rest[KEY];
    window.history.replaceState(rest, "");
  } catch {
    // Nothing to forget with.
  }
}

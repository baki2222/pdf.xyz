/**
 * Claim the hand-off carried to this page, for any page that receives
 * files: a tool runner (`useToolHandoff`) or the workspace. The token comes
 * from this tab's sessionStorage (`./carry`), where every launch puts it;
 * an address that still names one (`?handoff=`, how launches carried it
 * until 2026-10-20) is read as before, and stripped.
 *
 * A lib module of its own, apart from the runner hook, on purpose: the
 * workspace claims too, and a module the workspace shares ONLY with the tool
 * pages is split by the bundler into a chunk every tool page then fetches
 * once the shared set passes 20 kB of source. The hook brings pdf-lib's
 * loader (to warm the engine); this brings nothing a tool page does not
 * already load from the hand-off library.
 */
import {
  claimHandoff,
  handoffEntriesToFiles,
  purgeExpiredHandoffs,
  readHandoffId,
  readOrigin,
  readPending,
  readTrail,
  stripHandoffFromUrl,
  type HandoffFileEntry,
  type HandoffOrigin,
  type PendingStep,
} from "./index";
import { takeCarriedHandoff } from "./carry";

/** The router call the strip needs — the App Router's `replace`. */
export interface ReplacingRouter {
  replace(href: string, options?: { scroll?: boolean }): void;
}

export type HandoffStatus =
  | "idle" // no handoff in the URL → behave as a normal picker
  | "loading" // claiming from local storage
  | "ready" // files claimed and ready to preload
  | "expired" // the handoff was missing/expired/unreadable
  | "incompatible"; // claimed, but none of the files work with this tool

interface ClaimBase {
  /** Eligible files to preload; non-empty only when `status === "ready"`. */
  files: File[];
  /** Files dropped because they aren't compatible with this tool. */
  skipped: number;
  /** Total files the handoff carried (eligible + skipped). */
  claimed: number;
  /** Tool slugs the job has already been through, oldest first. */
  trail: string[];
  /** A step to take after this tool, when the job planned one. */
  pending: PendingStep | null;
}

/**
 * What a claim found: the files, and — once a record was read — where they
 * came from. Discriminated, so a page that shows "ready" files always has an
 * origin to name, and one that read no record never invents one.
 */
export type ClaimedHandoff =
  | (ClaimBase & { status: "idle" | "loading" | "expired"; origin: null })
  | (ClaimBase & { status: "ready" | "incompatible"; origin: HandoffOrigin });

export const IDLE: ClaimedHandoff = {
  status: "idle",
  files: [],
  skipped: 0,
  claimed: 0,
  origin: null,
  trail: [],
  pending: null,
};
export const LOADING: ClaimedHandoff = { ...IDLE, status: "loading" };
const EXPIRED: ClaimedHandoff = { ...IDLE, status: "expired" };

/**
 * The validated id carried to this page — taken (so removed) from this
 * tab's sessionStorage, else read from the address bar — or null.
 */
function readArrivingHandoffId(): string | null {
  try {
    return (
      takeCarriedHandoff(window.location.pathname) ??
      readHandoffId(window.location.search)
    );
  } catch {
    return null;
  }
}

/**
 * Drop the `?handoff=` param from the address bar without a full navigation.
 *
 * This needs *both* calls below, not either alone:
 *
 *  - `history.replaceState` lands synchronously, so the address bar is correct
 *    even on a hard/full page load — where `router.replace` alone is too late:
 *    the App Router hasn't finished mounting its client instance yet, so the
 *    call is dropped rather than applied.
 *  - `router.replace` syncs the App Router's own `canonicalUrl` state, which a
 *    plain `history.replaceState` never touches. On a soft, in-app navigation
 *    (e.g. from `/workspace`) Next re-applies its stale canonical URL to the
 *    address bar on the next router action (a link prefetch, another
 *    `router.push`), silently clobbering a history-only strip back to the
 *    `?handoff=...` URL.
 *  - On a hard/full page load, Next also re-syncs its canonical URL back onto
 *    the address bar some time *after* hydration finishes — even after both
 *    calls above land — clobbering the strip a second time with the stale
 *    `?handoff=...` URL. That re-sync isn't on a single predictable frame (it
 *    can land ~1s later), so a bounded series of follow-up strips is
 *    scheduled after mount to catch it whenever it happens.
 */
const LATE_SYNC_RETRY_DELAYS_MS = [0, 50, 150, 300, 600, 1000, 1500];
function stripUrlOnce(): string | null {
  try {
    const stripped = stripHandoffFromUrl(window.location.href);
    if (stripped === window.location.href) return null;
    window.history.replaceState(window.history.state, "", stripped);
    return stripped;
  } catch {
    // history/URL can be unavailable in exotic embeddings — safe to ignore.
    return null;
  }
}

function stripHandoffParam(router: ReplacingRouter): void {
  const stripped = stripUrlOnce();
  if (!stripped) return;
  try {
    const url = new URL(stripped);
    router.replace(`${url.pathname}${url.search}${url.hash}`, {
      scroll: false,
    });
  } catch {
    // URL parsing failed — nothing more to do.
  }
  // Defeat Next's late canonical-URL re-sync after hydration by re-applying
  // the strip a few more times over the following ~1.5s, whenever it happens.
  for (const delay of LATE_SYNC_RETRY_DELAYS_MS) {
    setTimeout(() => {
      stripUrlOnce();
    }, delay);
  }
}

/**
 * Claim the hand-off carried to this page for `target` — a tool slug, or
 * the workspace's reserved target — and keep the files `select` returns.
 *
 * ONE claim for every page that receives files. Returns null, without
 * touching the hand-off store, when nothing is carried here; the carried
 * token is removed, and an address's stripped, either way, so a reload
 * cannot replay it. A record addressed to another
 * target reads as expired (it is still consumed: single-use is the store's
 * rule, and a token that reached the wrong page is spent). The record's
 * provenance comes back with the files — read through `./origin`'s readers,
 * so a record from before origins existed reads as the workspace.
 */
export function claimArrival(
  target: string,
  select: (entries: HandoffFileEntry[]) => HandoffFileEntry[],
  router: ReplacingRouter,
): Promise<ClaimedHandoff> | null {
  const id = readArrivingHandoffId();
  stripHandoffParam(router);
  if (!id) return null; // no token → idle (normal file picker), no storage touch

  // We're already opening the store to claim; sweep any expired records too.
  void purgeExpiredHandoffs();
  return claimHandoff(id)
    .then((record): ClaimedHandoff => {
      if (!record || record.toolSlug !== target) return EXPIRED;
      const claimed = record.files.length;
      const files = handoffEntriesToFiles(select(record.files));
      const skipped = claimed - files.length;
      return {
        status: files.length === 0 ? "incompatible" : "ready",
        files,
        skipped,
        claimed,
        origin: readOrigin(record.origin),
        trail: readTrail(record.trail),
        pending: readPending(record.pending),
      };
    })
    .catch(() => EXPIRED);
}

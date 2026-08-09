"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  claimHandoff,
  eligibleFilesFor,
  handoffEntriesToFiles,
  purgeExpiredHandoffs,
  readHandoffId,
  stripHandoffFromUrl,
} from "@/lib/handoff";
import { warmPdfLib } from "@/lib/pdf/pdf-lib";

/**
 * Client hook that lets a tool runner receive files handed off from `/workspace`.
 * On mount it reads a `?handoff=<id>` token from the URL, claims the matching
 * record from the browser-local handoff store (single-use, so it's consumed),
 * and narrows the files to the ones this tool can actually open.
 *
 * Everything stays in the browser — the token references origin-private storage,
 * never a server. The `?handoff` param is stripped immediately so a reload can't
 * retry a consumed/expired claim and the URL stays clean and shareable-free.
 *
 * The strip applies through `window.history.replaceState`, the App Router's
 * `router.replace`, and a follow-up `replaceState` scheduled for the next
 * frame — see {@link stripHandoffParam} for why all three are needed across
 * a hard page load and an in-app soft navigation.
 */

export type HandoffStatus =
  | "idle" // no handoff in the URL → behave as a normal picker
  | "loading" // claiming from local storage
  | "ready" // files claimed and ready to preload
  | "expired" // the handoff was missing/expired/unreadable
  | "incompatible"; // claimed, but none of the files work with this tool

export interface ToolHandoff {
  status: HandoffStatus;
  /** Eligible files to preload; non-empty only when `status === "ready"`. */
  files: File[];
  /** Files dropped because they aren't compatible with this tool. */
  skipped: number;
  /** Total files the handoff carried (eligible + skipped). */
  claimed: number;
  /** Dismiss an expired/incompatible notice and fall back to the picker. */
  dismiss: () => void;
}

const IDLE: Omit<ToolHandoff, "dismiss"> = {
  status: "idle",
  files: [],
  skipped: 0,
  claimed: 0,
};

/** Read a validated handoff id from the current address bar, or null. */
function readHandoffIdFromLocation(): string | null {
  try {
    return readHandoffId(window.location.search);
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

function stripHandoffParam(router: ReturnType<typeof useRouter>): void {
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
 * @param slug the tool this runner implements, or `undefined` to disable the
 *   hook (used when a parent already claimed the handoff and passes it down).
 */
export function useToolHandoff(slug: string | undefined): ToolHandoff {
  const router = useRouter();
  const [state, setState] = useState<Omit<ToolHandoff, "dismiss">>(IDLE);
  // Claims exactly once, even under React StrictMode's double-invoked effects.
  const startedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!slug || startedRef.current) return;
    startedRef.current = true;

    const id = readHandoffIdFromLocation();
    stripHandoffParam(router);
    if (!id) return; // no token → stay idle (normal file picker), no storage touch

    // We're already opening the store to claim; sweep any expired records too.
    void purgeExpiredHandoffs();
    queueMicrotask(() => {
      if (mountedRef.current) {
        setState((prev) => ({ ...prev, status: "loading" }));
      }
    });
    claimHandoff(id)
      .then((record) => {
        if (!mountedRef.current) return;
        if (!record || record.toolSlug !== slug) {
          setState({ status: "expired", files: [], skipped: 0, claimed: 0 });
          return;
        }
        const claimed = record.files.length;
        const files = handoffEntriesToFiles(eligibleFilesFor(slug, record.files));
        const skipped = claimed - files.length;
        if (files.length > 0) {
          // Files are about to repopulate a runner without touching the
          // Dropzone, so this is the flow's file-pick moment: start the engine
          // download now rather than paying it at run-click (the one gap the
          // pdf-lib deferral left open — TASK-05 §3c).
          warmPdfLib();
        }
        setState(
          files.length === 0
            ? { status: "incompatible", files: [], skipped, claimed }
            : { status: "ready", files, skipped, claimed },
        );
      })
      .catch(() => {
        if (mountedRef.current) {
          setState({ status: "expired", files: [], skipped: 0, claimed: 0 });
        }
      });
  }, [slug, router]);

  const dismiss = useCallback(() => setState(IDLE), []);

  return { ...state, dismiss };
}

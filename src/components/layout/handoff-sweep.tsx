"use client";

import { useEffect } from "react";

/**
 * Deletes expired hand-offs on every page, once the page is idle — which is
 * what makes `/privacy` true: "An unopened hand-off … is deleted from this
 * browser the next time a pdf.xyz page opens." Before this, expired bytes
 * were only swept when someone opened the workspace or arrived at a tool
 * with a hand-off, so a file passed to a tool that never opened stayed in
 * the browser indefinitely.
 *
 * Costs the page nothing up front: it renders nothing, and the storage code
 * loads on idle in its own chunk. It never creates the hand-off database
 * (`purgeExpiredIfPresent`), so a visitor who never handed a file anywhere
 * has nothing stored. WP-07's drop layer was to own this; it can absorb it.
 */
export function HandoffSweep() {
  useEffect(() => {
    let cancelled = false;
    const sweep = () => {
      if (cancelled) return;
      void import("@/lib/handoff/sweep")
        .then(({ purgeExpiredIfPresent }) => purgeExpiredIfPresent())
        .catch(() => {
          // Best effort: the next page load tries again.
        });
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(sweep, { timeout: 4000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(handle);
      };
    }
    const timer = window.setTimeout(sweep, 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);
  return null;
}

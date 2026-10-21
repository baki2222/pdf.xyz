"use client";

import { useEffect } from "react";

/**
 * Mounts the tab signal (`./tab-signal-engine`, spec C.2) on every page: a
 * run that finishes while this tab is hidden says so in the tab's title and
 * icon. Fetched after hydration rather than shipped in the root layout's
 * chunk, which every page loads first: it only ever answers the END of a
 * run of three seconds or more, and it is here long before one can end.
 * Renders nothing.
 */
export function TabSignal() {
  useEffect(() => {
    let live = true;
    let stop: (() => void) | undefined;
    import("./tab-signal-engine").then(
      (m) => {
        if (live) stop = m.startTabSignal();
      },
      () => {
        // Not loaded (offline, a replaced deploy): the tab just says nothing.
      },
    );
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  return null;
}

"use client";

import { useEffect, useState } from "react";

/**
 * One app-level ARIA live region, plus the imperative call that speaks into it.
 *
 * WHY THIS IS NOT `useAnnouncer`
 * `runner-kit.tsx` already exports a `useAnnouncer()` hook that returns a
 * `role="status"` node for the caller to render, and two runners use it — for
 * "Moved file to position 3" and "Removed file". It cannot be used for the thing
 * that matters. A runner renders `{announcer}` inside its EDITOR branch, and the
 * completed run takes an early return several lines above it (merge's runner
 * returns its result panel before any branch that renders `{announcer}`). The
 * region is therefore UNMOUNTED at the exact moment there is an outcome to
 * announce. The infrastructure existed, read correctly, and was dead
 * precisely where it was needed.
 *
 * A region mounted at the root cannot be unmounted by any branch below it, which
 * is the whole point. Announcements are the FALLBACK path — when an outcome is
 * shown, focus moves to it and the screen reader reads it there (see
 * `useOutcomeFocus`). This speaks when moving focus would be wrong: the user has
 * moved on, or the surface has no element to focus.
 */

type Listener = (message: string) => void;

/**
 * A Set, not a single slot. `vitest.config.ts` runs with `isolate: false`, so
 * the module registry is shared across test files in a worker — a lone listener
 * variable leaks the last-mounted region between files and produces passes that
 * have nothing to do with the code under test.
 */
const listeners = new Set<Listener>();

/**
 * Speak `message` in the app's live region.
 *
 * Safe to call when nothing is mounted (server render, a unit test that renders
 * a component in isolation): the message is dropped rather than throwing. It is
 * a courtesy channel, never the only way an outcome is conveyed — the outcome is
 * always also on screen.
 */
export function announceOutcome(message: string): void {
  for (const listener of listeners) listener(message);
}

/** Test seam, mirroring `resetTelemetry` in `src/lib/telemetry/track.ts`. */
export function resetAnnouncer(): void {
  listeners.clear();
}

/**
 * The region itself. Mounted once, in the root layout.
 *
 * The clear-then-set is load-bearing, not a flourish. Assistive tech reacts to
 * MUTATIONS of a live region's contents, so writing the identical string twice
 * is silent — and identical strings are the normal case here, since running the
 * same tool twice produces the same sentence ("PDF rotated"). Without the clear,
 * a user hears the first run and nothing after.
 */
export function LiveRegion() {
  const [shown, setShown] = useState("");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listener: Listener = (message) => {
      setShown("");
      timer = setTimeout(() => setShown(message), 50);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {shown}
    </p>
  );
}

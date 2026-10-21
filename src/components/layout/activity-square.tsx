"use client";

import { useEffect, useState } from "react";
import { subscribeActivity, type ActivityState } from "@/lib/activity/bus";

/**
 * The masthead's registration square, reporting the page's activity (M16):
 * `data-activity` is the bus's state — hollow and turning while a run is
 * busy, a single ring when it is done, leaning while a file is held over the
 * page. Every state reads without its motion (the CSS lives in the "Motion
 * (continued)" region of `globals.css`). Rendered `idle` on the server, so
 * hydration matches; the masthead mounts before any run can start.
 *
 * STATE, NOT `useSyncExternalStore`. A store subscription re-renders
 * synchronously, and the bus reports `done` in the same tick a runner sets
 * its result. With the square on a store, the section below the runner
 * jumped as a run ended — CLS 0.0215-0.0463 on Compare PDF and PDF to
 * Markdown in `e2e/continue-chain.spec.ts` (main: 0, and 0 with the reports
 * taken out of `useAsyncRun`); with a state update from the listener, which
 * React batches with the runner's own, 0 again. Measured, not explained:
 * keep it a state.
 */
export function ActivitySquare({ className }: { className: string }) {
  const [activity, setActivity] = useState<ActivityState>("idle");
  useEffect(() => subscribeActivity((a) => setActivity(a.state)), []);
  return <span data-activity={activity} className={className} aria-hidden />;
}

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { subscribeActivity, type ActivityState } from "@/lib/activity/bus";

/**
 * The masthead logo's P, reporting the page's activity (M16): `data-activity`
 * is the bus's state — the P's corner folds down and back and the P stays
 * hollow while a run is busy, one ring leaves its outline when it is done,
 * and it leans while a file is held over the page. Every state reads without
 * its motion (the CSS lives in the "Motion (continued)" region of
 * `globals.css`). An SVG group inside the logo, so the P keeps its place in
 * the name; the paths are the server's, passed through as children. Rendered
 * `idle` on the server, so hydration matches; the masthead mounts before any
 * run can start.
 *
 * WAS `ActivitySquare`, the same state on the retired accent square.
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
export function ActivityMark({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  const [activity, setActivity] = useState<ActivityState>("idle");
  useEffect(() => subscribeActivity((a) => setActivity(a.state)), []);
  return (
    <g data-activity={activity} className={className}>
      {children}
    </g>
  );
}

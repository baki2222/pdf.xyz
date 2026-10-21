/**
 * What this page is doing, in one word, for the surfaces that report it
 * without being part of the work: the masthead logo's P (M16) and a hidden
 * tab's title (`TabSignal`). Spec E.11.
 *
 * Fed by exactly three hooks — `useAsyncRun`, `useBatchRunner`,
 * `useWorkerJob` — and by the drop layer (`drag`). `activity-reach.test.ts`
 * holds every panel a tool page mounts to one of the three, and each of them
 * to a call here. Module-level state with a reset for tests (vitest runs with
 * `isolate:false`). Nothing here leaves the tab.
 */
export type ActivityState = "idle" | "drag" | "busy" | "done" | "failed";

export interface Activity {
  state: ActivityState;
  /** When this state began (`performance.now()`). */
  since: number;
  /** For `done` and `failed`: how long the run that ended took. */
  ranMs?: number;
}

type Listener = (activity: Activity) => void;

const IDLE: Activity = { state: "idle", since: 0 };
let current: Activity = IDLE;
const listeners = new Set<Listener>();

/**
 * Report a change. A drag, or its end, never hides a run in progress; a
 * second `busy` keeps the first one's start; an end with no run in progress
 * is not news.
 */
export function reportActivity(state: ActivityState): void {
  const now = performance.now();
  const busy = current.state === "busy";
  if (state === current.state && state !== "busy") return;
  if (busy && (state === "drag" || state === "idle" || state === "busy"))
    return;
  if ((state === "done" || state === "failed") && !busy) return;
  current =
    state === "done" || state === "failed"
      ? { state, since: now, ranMs: now - current.since }
      : { state, since: now };
  for (const listener of listeners) listener(current);
}

/**
 * A run that was stopped — canceled, superseded, or no longer waited for —
 * ends without news: back to idle, with no `done` or `failed` to report.
 */
export function cancelActivity(): void {
  if (current.state !== "busy") return;
  current = { state: "idle", since: performance.now() };
  for (const listener of listeners) listener(current);
}

export function currentActivity(): Activity {
  return current;
}

/** Listen for changes; returns the unsubscribe. */
export function subscribeActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetActivityForTests(): void {
  current = IDLE;
  listeners.clear();
}

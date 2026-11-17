import { pollsInFlight } from "@/lib/workers/job-polling";

/**
 * A worker poll loop must not outlive the test file that started it.
 *
 * The suite runs with `isolate: false` (`vitest.config.ts`): one thread runs
 * file after file in one realm, so a `pollJobToTerminal` loop a file leaves
 * running keeps reading `/api/jobs/<id>` through whatever `fetch` is on
 * `globalThis` when each read starts — the next file's stub. It found one on
 * 2026-11-17: `html-render-worker-panel.test.tsx` answered every request,
 * `POST /api/jobs` included, with the worker's status. That "job" has no id
 * and no status, so it is never terminal, and its panel's run went on
 * polling `/api/jobs/undefined` for up to 150 reads after the test ended.
 * `worker-batch-handoff.dom.test.tsx`, which counts every request a hand-off
 * makes, failed 3 to 6 of its tests for requests it never made — whenever
 * the two files shared a thread, which on CI (parallel workers) they had not.
 *
 * Registered by `./setup.ts` after every FILE, so the red names the file
 * that leaked the loop, not the one its requests landed in.
 * `poll-leak-guard.test.ts` holds the predicate to a planted leak (positive
 * control) and the wiring to the setup files every project runs.
 */

/**
 * The timers this guard waits with, captured before any test can install
 * fake ones: a guard that waited on a faked `setTimeout` would hang the file
 * instead of failing it.
 */
const realSetTimeout = globalThis.setTimeout;
const realDateNow = Date.now.bind(Date);

/**
 * How long a loop may take to notice it was stopped. An aborted loop returns
 * at its next read, after one poll interval (800 ms by default); a loop
 * nobody stopped is still polling after any grace at all.
 */
export const POLL_LEAK_GRACE_MS = 2_000;

/** Loops still in flight after `graceMs`, read every 25 ms until then. */
export async function pollsLeftAfter(
  graceMs: number,
  count: () => number = pollsInFlight,
): Promise<number> {
  const deadline = realDateNow() + graceMs;
  while (count() > 0 && realDateNow() < deadline)
    await new Promise<void>((resolve) => realSetTimeout(resolve, 25));
  return count();
}

/** Throws when a poll loop started in this file is still running after the grace. */
export async function assertNoPollLeft(
  graceMs: number = POLL_LEAK_GRACE_MS,
  count: () => number = pollsInFlight,
): Promise<void> {
  const left = await pollsLeftAfter(graceMs, count);
  if (left > 0)
    throw new Error(
      `${left} worker poll loop(s) (pollJobToTerminal) still running ${graceMs} ms after this file's last test. ` +
        "They will poll /api/jobs/<id> through the NEXT file's fetch stub. " +
        "Answer POST /api/jobs with a job that ends (or a refusal), or abort the run before the test ends.",
    );
}

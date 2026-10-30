/**
 * The door to `./job-run` — the worker run's upload, polling and error
 * reader — fetched on demand, the way `loadPdfLib` is for pdf-lib.
 *
 * {@link warmJobRun} starts the download without awaiting it: a worker
 * panel's chosen file (`ChosenFileTarget`) and Compress PDF's arriving file
 * call it, so the chunk is in hand by the time Run is pressed and the run
 * is no slower than when it was static. {@link loadJobRun} is what a client
 * awaits as its run begins; it reuses the one download.
 *
 * A failed download (offline, a deploy that replaced the chunk) rejects, as
 * the `fetch` right after it would have: every caller is a run that a
 * rejected fetch already ends in "lost connection" (`useWorkerJob`), and the
 * next attempt fetches again rather than replaying the failure.
 */
type JobRun = typeof import("./job-run");

let pending: Promise<JobRun> | null = null;

export function loadJobRun(): Promise<JobRun> {
  pending ??= import("./job-run").catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

/** Start fetching the run's code; fire-and-forget, never surfaces a failure. */
export function warmJobRun(): void {
  loadJobRun().catch(() => {});
}

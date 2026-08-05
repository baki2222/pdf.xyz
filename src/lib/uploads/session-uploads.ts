/**
 * Did this browser session ever send file bytes to the secure worker?
 *
 * The crash fallbacks (`ErrorBoundary`, `app/error.tsx`, `app/global-error.tsx`)
 * used to reassure the user unconditionally that no upload had happened. On the
 * thirteen `/tools/[slug]` boundaries that wrap a secure-worker panel that
 * sentence can be false: the panel uploads, then crashes rendering the result,
 * and the product states — in its own voice — that the upload it just performed
 * never happened. Same family as the malware claim removed in #33.
 *
 * This is deliberately the smallest thing that can answer the question: a
 * module-level flag, set once, never cleared outside tests. Scope is the JS
 * module instance, which is exactly the page session the fallback is describing
 * — a full reload starts a new session and correctly forgets.
 *
 * The flag is raised BEFORE the bytes go out, not after the upload succeeds. A
 * PUT that errors half-way may still have put bytes on the wire, so "the upload
 * failed" does not license the claim that the file never left the device.
 * Reserving a slot (`POST /api/uploads`) sends no file content and does not
 * raise it.
 *
 * Server-side this is always `false`: uploads are issued from the browser, so
 * nothing on the server ever calls {@link markUploadStarted}.
 */

let uploadStarted = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Record that file bytes have begun leaving the device. Call immediately before
 * issuing the upload request — see the note above on why "before", not "after".
 */
export function markUploadStarted(): void {
  if (uploadStarted) return;
  uploadStarted = true;
  notify();
}

/** Whether {@link markUploadStarted} has been called in this module instance. */
export function hasUploadedThisSession(): boolean {
  return uploadStarted;
}

/**
 * Subscribe to changes, for `useSyncExternalStore`. The flag only ever goes
 * false → true once, so this fires at most once per page — but a fallback that
 * is already mounted when an upload begins should not keep showing the stale
 * reassurance, and a real subscription is what makes that impossible.
 */
export function subscribeToUploadFlag(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Test-only reset. Production never clears the flag — an upload that happened
 * stays happened for as long as the page lives. Subscribers are notified so a
 * component still mounted from a previous case does not hold a stale snapshot.
 */
export function resetUploadedThisSessionForTests(): void {
  uploadStarted = false;
  notify();
}

/**
 * A worker panel's file input, once the panel can RUN.
 *
 * Until WP-10 a panel mounted its drop zone only after the status check said
 * the worker was ready, so "the file input exists" meant "the panel can run",
 * and every panel test waited for the input and then pressed Run. The drop
 * zone renders at once now (on the server too) and only Run waits — so a test
 * that waited for the input pressed a Run that was still off, and read the
 * silence as a failure of whatever it was testing. This waits for the
 * property the old wait stood for: the status slot in its `run` state.
 */
export const WORKER_READY = '[data-slot="worker-status"][data-state="run"]';

export function readyFileInput(): HTMLInputElement | null {
  if (!document.querySelector(WORKER_READY)) return null;
  return document.querySelector<HTMLInputElement>('input[type="file"]');
}

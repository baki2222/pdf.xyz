/**
 * The address's query, as the header's links read it — WITHOUT
 * `useSearchParams()`, which in a prerendered page bails its boundary out of
 * the server render (`<!--$!-->`, `src/deploy/own-panel-first-load.test.ts`;
 * the ticket rail reads the address the same way, for the same reason).
 *
 * A page that rewrites its own query without navigating (`/tools`'s
 * explorer, through `history.replaceState`) says so with
 * {@link announceLocation}; Back and Forward are `popstate`.
 */
export const LOCATION_EVENT = "pdfxyz:location";

/** Tell the header the query changed in place. */
export function announceLocation(): void {
  window.dispatchEvent(new Event(LOCATION_EVENT));
}

/** Hear every in-place change of the query; returns the unsubscribe. */
export function subscribeLocation(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  window.addEventListener(LOCATION_EVENT, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(LOCATION_EVENT, listener);
  };
}

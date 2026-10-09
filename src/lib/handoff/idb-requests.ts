/**
 * The three IndexedDB helpers the hand-off store and the sweep both use —
 * a leaf, so the sweep every page runs on idle loads these and nothing of
 * the store.
 */

/** The browser's IndexedDB, or null where it is absent or refused. */
export function defaultFactory(): IDBFactory | null {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null
      ? indexedDB
      : null;
  } catch {
    // Accessing `indexedDB` can throw in sandboxed/partitioned contexts.
    return null;
  }
}

/** Promisify an IDBRequest. */
export function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/** Wait for a transaction to finish, or fail. */
export function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

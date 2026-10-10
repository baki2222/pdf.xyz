import { HANDOFF_DB_NAME, HANDOFF_STORE } from "./db-name";
import { defaultFactory, finished, promisifyRequest } from "./idb-requests";
import type { HandoffRecord } from "./types";

/**
 * The sweep every page runs on idle (`HandoffSweep` in the root layout):
 * delete expired hand-offs without ever creating the database. Its own
 * module, so tool pages and the workspace — which open the store — do not
 * carry it, and the idle chunk does not carry the store.
 */

/**
 * Open the database only if it already exists. Opening a database that does
 * not exist CREATES it; aborting the upgrade that creation needs deletes it
 * again before anything is stored, so the browser is left as it was.
 */
function openIfPresent(factory: IDBFactory): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(HANDOFF_DB_NAME);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = (event) => {
      if (event.oldVersion === 0) request.transaction?.abort();
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = (event) => {
      // An aborted creation is the expected outcome here, not an error.
      event.preventDefault?.();
      resolve(null);
    };
    request.onblocked = () => resolve(null);
  });
}

/**
 * Delete every expired hand-off — or one with no expiry at all — and return
 * how many went. Run on every page (`HandoffSweep` in the root layout), which
 * is what makes `/privacy` true: an unopened hand-off is deleted from this
 * browser the next time a pdf.xyz page opens. It never creates the database,
 * so a visitor who never handed a file anywhere has nothing stored. Never
 * throws.
 */
export async function purgeExpiredIfPresent(
  now: number = Date.now(),
  factory: IDBFactory | null = defaultFactory(),
): Promise<number> {
  if (!factory) return 0;
  const db = await openIfPresent(factory);
  if (!db) return 0;
  try {
    if (!db.objectStoreNames.contains(HANDOFF_STORE)) return 0;
    const tx = db.transaction(HANDOFF_STORE, "readwrite");
    const done = finished(tx);
    const store = tx.objectStore(HANDOFF_STORE);
    const records = await promisifyRequest<Partial<HandoffRecord>[]>(
      store.getAll(),
    );
    let removed = 0;
    for (const record of records) {
      const expiry = record.expiresAt;
      if (typeof expiry === "number" && now < expiry) continue;
      if (typeof record.id !== "string") continue;
      store.delete(record.id);
      removed += 1;
    }
    await done;
    return removed;
  } catch {
    return 0;
  } finally {
    db.close();
  }
}

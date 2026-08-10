/**
 * IndexedDB-backed handoff storage. IndexedDB is the only browser-native store
 * that holds `Blob`/`File` objects directly (via structured clone), which is
 * exactly what a file handoff needs — so file bytes live in the origin's private
 * IndexedDB and never touch localStorage, cookies, or any server.
 *
 * The wrapper is deliberately tiny (one object store keyed by handoff id) and
 * fully guarded: any failure to open or transact rejects, and the store layer
 * degrades to memory so the app never crashes on a storage error.
 */

import type { HandoffBackend } from "./backend";
import type { HandoffRecord } from "./types";

const DB_NAME = "pdfxyz-handoff";
const DB_VERSION = 1;
const STORE = "handoffs";

/** True when this runtime exposes a usable IndexedDB. */
export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    // Accessing `indexedDB` can throw in sandboxed/partitioned contexts.
    return false;
  }
}

/** Promisify an IDBRequest. */
function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** Open (once) the handoff database, creating the object store on first use. */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  }).catch((err) => {
    // Reset so a later attempt can retry a transient failure.
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

/** Run `fn` inside a transaction on the handoff store and await completion. */
async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE, mode);
    } catch (err) {
      reject(err);
      return;
    }
    const store = tx.objectStore(STORE);
    let result: T;
    Promise.resolve(fn(store))
      .then((value) => {
        result = value;
      })
      .catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () =>
      reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** IndexedDB implementation of {@link HandoffBackend}. */
export class IndexedDbHandoffBackend implements HandoffBackend {
  async put(record: HandoffRecord): Promise<void> {
    await withStore("readwrite", (store) =>
      promisifyRequest(store.put(record)),
    );
  }

  async get(id: string): Promise<HandoffRecord | undefined> {
    return withStore("readonly", (store) =>
      promisifyRequest<HandoffRecord | undefined>(store.get(id)),
    );
  }

  async delete(id: string): Promise<void> {
    await withStore("readwrite", (store) => promisifyRequest(store.delete(id)));
  }

  async getAll(): Promise<HandoffRecord[]> {
    return withStore("readonly", (store) =>
      promisifyRequest<HandoffRecord[]>(store.getAll()),
    );
  }

  async clear(): Promise<void> {
    await withStore("readwrite", (store) => promisifyRequest(store.clear()));
  }
}

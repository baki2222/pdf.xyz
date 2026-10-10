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
import { HANDOFF_DB_NAME, HANDOFF_STORE } from "./db-name";
import { defaultFactory, finished, promisifyRequest } from "./idb-requests";
import type { HandoffRecord } from "./types";

/**
 * The database's name lives in `./db-name` — registered in
 * `src/lib/browser-storage.ts`, which `/privacy` renders and
 * `browser-storage.test.ts` holds to every place the code opens it.
 */
export { HANDOFF_DB_NAME };
const DB_VERSION = 1;

/** True when this runtime exposes a usable IndexedDB. */
export function isIndexedDbAvailable(): boolean {
  return defaultFactory() !== null;
}

/** One open connection per factory (the page has one; tests make many). */
const connections = new WeakMap<IDBFactory, Promise<IDBDatabase>>();

/** Open (once) the handoff database, creating the object store on first use. */
function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  const open = connections.get(factory);
  if (open) return open;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(HANDOFF_DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HANDOFF_STORE)) {
        db.createObjectStore(HANDOFF_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  }).catch((err) => {
    // Forget it so a later attempt can retry a transient failure.
    connections.delete(factory);
    throw err;
  });
  connections.set(factory, opening);
  return opening;
}

/** Run `fn` inside a transaction on the handoff store and await completion. */
async function withStore<T>(
  factory: IDBFactory,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb(factory);
  const tx = db.transaction(HANDOFF_STORE, mode);
  const done = finished(tx);
  const result = await fn(tx.objectStore(HANDOFF_STORE));
  await done;
  return result;
}

/** IndexedDB implementation of {@link HandoffBackend}. */
export class IndexedDbHandoffBackend implements HandoffBackend {
  private readonly factory: IDBFactory | null;

  /** `factory` is the browser's IndexedDB unless a test supplies one. */
  constructor(factory: IDBFactory | null = defaultFactory()) {
    this.factory = factory;
  }

  private store<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => Promise<T> | T,
  ): Promise<T> {
    if (!this.factory) return Promise.reject(new Error("no IndexedDB"));
    return withStore(this.factory, mode, fn);
  }

  async put(record: HandoffRecord): Promise<void> {
    await this.store("readwrite", (store) =>
      promisifyRequest(store.put(record)),
    );
  }

  async get(id: string): Promise<HandoffRecord | undefined> {
    return this.store("readonly", (store) =>
      promisifyRequest<HandoffRecord | undefined>(store.get(id)),
    );
  }

  async delete(id: string): Promise<void> {
    await this.store("readwrite", (store) =>
      promisifyRequest(store.delete(id)),
    );
  }

  async getAll(): Promise<HandoffRecord[]> {
    return this.store("readonly", (store) =>
      promisifyRequest<HandoffRecord[]>(store.getAll()),
    );
  }

  async clear(): Promise<void> {
    await this.store("readwrite", (store) => promisifyRequest(store.clear()));
  }
}

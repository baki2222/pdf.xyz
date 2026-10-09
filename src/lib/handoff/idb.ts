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

/**
 * The database's name — registered in `src/lib/browser-storage.ts`, which
 * `/privacy` renders and `browser-storage.test.ts` holds to every place the
 * code opens it.
 */
export const HANDOFF_DB_NAME = "pdfxyz-handoff";
const DB_VERSION = 1;
const STORE = "handoffs";

/** The browser's IndexedDB, or null where it is absent or refused. */
function defaultFactory(): IDBFactory | null {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null
      ? indexedDB
      : null;
  } catch {
    // Accessing `indexedDB` can throw in sandboxed/partitioned contexts.
    return null;
  }
}

/** True when this runtime exposes a usable IndexedDB. */
export function isIndexedDbAvailable(): boolean {
  return defaultFactory() !== null;
}

/** Promisify an IDBRequest. */
function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
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
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
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

/** Wait for a transaction to finish, or fail. */
function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** Run `fn` inside a transaction on the handoff store and await completion. */
async function withStore<T>(
  factory: IDBFactory,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb(factory);
  const tx = db.transaction(STORE, mode);
  const done = finished(tx);
  const result = await fn(tx.objectStore(STORE));
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
    if (!db.objectStoreNames.contains(STORE)) return 0;
    const tx = db.transaction(STORE, "readwrite");
    const done = finished(tx);
    const store = tx.objectStore(STORE);
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

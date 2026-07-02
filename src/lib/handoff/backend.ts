/**
 * Storage backend abstraction for handoffs. The {@link HandoffStore} operates
 * over this small async interface so the lifecycle logic (TTL, single-use claim,
 * purge) can be unit-tested against an in-memory fake, while the browser uses a
 * real IndexedDB backend (see `./idb`).
 */

import type { HandoffRecord } from "./types";

export interface HandoffBackend {
  put(record: HandoffRecord): Promise<void>;
  get(id: string): Promise<HandoffRecord | undefined>;
  delete(id: string): Promise<void>;
  getAll(): Promise<HandoffRecord[]>;
  clear(): Promise<void>;
}

/**
 * A simple Map-backed backend. Used in unit tests and as the graceful fallback
 * when IndexedDB is unavailable (SSR, private modes) — in that case handoffs
 * simply don't survive a hard reload, and the receiving runner shows its honest
 * "handoff expired / pick files" state.
 */
export class MemoryHandoffBackend implements HandoffBackend {
  private readonly map = new Map<string, HandoffRecord>();

  async put(record: HandoffRecord): Promise<void> {
    this.map.set(record.id, record);
  }

  async get(id: string): Promise<HandoffRecord | undefined> {
    return this.map.get(id);
  }

  async delete(id: string): Promise<void> {
    this.map.delete(id);
  }

  async getAll(): Promise<HandoffRecord[]> {
    return [...this.map.values()];
  }

  async clear(): Promise<void> {
    this.map.clear();
  }
}

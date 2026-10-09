/**
 * The handoff lifecycle, expressed over a pluggable {@link HandoffBackend} with
 * an injectable clock and id factory so every rule — TTL expiry, single-use
 * claim, purge-on-access, explicit delete/clear — is deterministic and testable
 * without a real IndexedDB or wall clock.
 *
 * Guarantees a receiving runner can rely on:
 *  - **Single-use:** {@link HandoffStore.claim} deletes the record before it
 *    returns it, so the same bytes can never be replayed twice.
 *  - **Expiry:** every read purges expired records; an expired id claims as null.
 *  - **Fail-safe:** backend errors are swallowed into null / no-op results, so a
 *    storage failure degrades to the normal file picker, never a thrown error.
 */

import type { HandoffBackend } from "./backend";
import type { HandoffMeta } from "./origin";
import { newHandoffId } from "./ids";
import {
  DEFAULT_HANDOFF_TTL_MS,
  isHandoffExpired,
  makeHandoffRecord,
} from "./record";
import type { HandoffFileEntry, HandoffRecord } from "./types";

export interface HandoffStoreOptions {
  backend: HandoffBackend;
  /** Returns the current ms epoch. Injected for deterministic tests. */
  now?: () => number;
  /** Returns a fresh opaque id. Injected for deterministic tests. */
  idFactory?: () => string;
  /** Default TTL for new handoffs. */
  ttlMs?: number;
}

export class HandoffStore {
  private readonly backend: HandoffBackend;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly ttlMs: number;

  constructor(options: HandoffStoreOptions) {
    this.backend = options.backend;
    this.now = options.now ?? (() => Date.now());
    this.idFactory = options.idFactory ?? newHandoffId;
    this.ttlMs = options.ttlMs ?? DEFAULT_HANDOFF_TTL_MS;
  }

  /**
   * Persist a new handoff for `toolSlug` and return the created record. Expired
   * records are purged first so the store can't accumulate stale bytes. Returns
   * null if the backend write fails (caller falls back to the file picker).
   * `meta.origin` is required: the receiving page says where the files came
   * from, and only the creator knows.
   */
  async create(
    toolSlug: string,
    files: HandoffFileEntry[],
    meta: HandoffMeta,
  ): Promise<HandoffRecord | null> {
    await this.purgeExpired();
    const record = makeHandoffRecord({
      ...meta,
      id: this.idFactory(),
      toolSlug,
      files,
      now: this.now(),
      ttlMs: this.ttlMs,
    });
    try {
      await this.backend.put(record);
      return record;
    } catch {
      return null;
    }
  }

  /**
   * Read a handoff **without** consuming it. Expired records are deleted and
   * reported as null. Used for tests and non-destructive inspection.
   */
  async peek(id: string): Promise<HandoffRecord | null> {
    let record: HandoffRecord | undefined;
    try {
      record = await this.backend.get(id);
    } catch {
      return null;
    }
    if (!record) return null;
    if (isHandoffExpired(record, this.now())) {
      await this.safeDelete(id);
      return null;
    }
    return record;
  }

  /**
   * Consume a handoff: return it and delete it in the same step (single-use).
   * An unknown or expired id yields null. The delete runs even if the record is
   * live, so bytes never linger after a successful claim.
   */
  async claim(id: string): Promise<HandoffRecord | null> {
    const record = await this.peek(id);
    if (!record) return null;
    await this.safeDelete(id);
    return record;
  }

  /** Explicitly delete one handoff. Never throws. */
  async delete(id: string): Promise<void> {
    await this.safeDelete(id);
  }

  /** Delete every handoff. Never throws. */
  async clear(): Promise<void> {
    try {
      await this.backend.clear();
    } catch {
      // ignore — best effort
    }
  }

  /** Delete all expired handoffs. Returns how many were removed. Never throws. */
  async purgeExpired(): Promise<number> {
    let all: HandoffRecord[];
    try {
      all = await this.backend.getAll();
    } catch {
      return 0;
    }
    const now = this.now();
    const expired = all.filter((record) => isHandoffExpired(record, now));
    for (const record of expired) {
      await this.safeDelete(record.id);
    }
    return expired.length;
  }

  private async safeDelete(id: string): Promise<void> {
    try {
      await this.backend.delete(id);
    } catch {
      // ignore — best effort
    }
  }
}

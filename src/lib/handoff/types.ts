/**
 * Typed model for the local workspace → tool **handoff**: the mechanism that
 * carries staged File bytes from `/workspace` to a live in-browser tool runner
 * within the same browser, without ever touching a server.
 *
 * Privacy note: unlike the workspace persistence layer (which stores *no* file
 * data at all), a handoff intentionally holds the file bytes — that is its whole
 * job. Those bytes live only in the browser's own origin-private storage
 * (IndexedDB), are **single-use** (deleted the instant a tool claims them),
 * carry a short **TTL**, and are purged on access. Nothing is uploaded. See
 * `./store` for the lifecycle guarantees and `docs/SECURITY.md` for the model.
 */

import type { HandoffOrigin, PendingStep } from "./origin";

/**
 * One file inside a handoff. Bytes are held as a {@link Blob} (structured-clone
 * safe, so IndexedDB stores it natively) alongside the metadata needed to
 * reconstruct a real `File` on the receiving side.
 */
export interface HandoffFileEntry {
  /** Original file name, e.g. "contract.pdf". */
  name: string;
  /** Size in bytes (mirrors `blob.size`, kept explicit for summaries). */
  size: number;
  /** MIME type as reported by the browser; may be an empty string. */
  type: string;
  /** The raw bytes. A `File` is a `Blob`, so File handles slot in directly. */
  blob: Blob;
}

/**
 * A complete handoff: the target tool, timing metadata, and the files. Persisted
 * as-is into IndexedDB (Blobs included) and read back by the claiming runner.
 *
 * The three provenance fields are optional ON THE RECORD because records stored
 * before they existed may still be claimed; a claim reads them through
 * `readOrigin`/`readTrail`/`readPending` (`./origin`), which also refuse a
 * malformed value. Every CREATOR must supply an origin — see `HandoffMeta`.
 */
export interface HandoffRecord {
  /** Opaque, unguessable id; also the IndexedDB primary key and URL token. */
  id: string;
  /**
   * Slug of the tool this handoff targets, e.g. "merge-pdf" — or a reserved
   * target that is not a tool (`workspace`, `parked`; see `./origin`).
   */
  toolSlug: string;
  /** Client-clock ms epoch when the handoff was created. */
  createdAt: number;
  /** Client-clock ms epoch after which the handoff is considered expired. */
  expiresAt: number;
  /** The files being handed off, in the order the user queued them. */
  files: HandoffFileEntry[];
  /** Where the files came from: the workspace, a drop, a result, a remedy. */
  origin?: HandoffOrigin;
  /** Tool slugs this job has already been through, oldest first. */
  trail?: string[];
  /** A step to take after the target tool, with any files set aside for it. */
  pending?: PendingStep;
}

/**
 * A byte-free projection of a {@link HandoffRecord} — safe to log, inspect, or
 * surface in the UI without exposing document contents.
 */
export interface HandoffSummary {
  id: string;
  toolSlug: string;
  createdAt: number;
  expiresAt: number;
  fileCount: number;
  totalBytes: number;
}

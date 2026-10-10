/**
 * Typed model for the anonymous local workspace — the single source of truth for
 * everything the browser-only workspace tracks: staged files, the selected tool,
 * a short activity log, and a lightweight batch queue.
 *
 * Privacy note: this model holds file *metadata only* — no raw bytes are ever
 * stored here. The staging UI reads a File's name/size/type; for PDFs it may also
 * read the bytes *locally, in the browser* once to count pages (see `pageCount`),
 * but that read never leaves the device and nothing byte-level is retained here.
 * The persistence layer (`./storage`) narrows this even further: not even this
 * metadata is written to disk — only tool preferences + a name-free activity log.
 */

import type { FileFacts } from "@/lib/intent/facts";

/** Coarse file family, derived from name/MIME, used for summaries + suggestions. */
export type FileFamily =
  "pdf" | "image" | "word" | "excel" | "powerpoint" | "text" | "other";

/** Every {@link FileFamily}, in a stable display order. */
export const FILE_FAMILIES: readonly FileFamily[] = [
  "pdf",
  "image",
  "word",
  "excel",
  "powerpoint",
  "text",
  "other",
] as const;

/** A document staged in the workspace — safe metadata about a local file. */
export interface WorkspaceFile {
  /**
   * Stable id, unique within a session, derived from name+size+mtime so that
   * re-adding the same file de-duplicates. Kept in memory only; never persisted.
   */
  id: string;
  /** Original file name. */
  name: string;
  /** Size in bytes; 0 when unknown. */
  size: number;
  /** Raw MIME type as reported by the browser; may be an empty string. */
  mime: string;
  /** Short uppercase label for display, e.g. "PDF", "JPG". */
  kind: string;
  /** Coarse family for suggestion + summary logic. */
  family: FileFamily;
  /** Client-clock ms epoch when the file was staged. */
  addedAt: number;
  /**
   * Page count, filled in asynchronously for PDFs via a best-effort *local*
   * parse (the probe, through `facts`). Undefined while pending, or when the file
   * isn't a PDF or couldn't be read. Never persisted.
   */
  pageCount?: number;
  /**
   * What this tab measured: the format its bytes declare and, for a PDF, the
   * probe's findings (pages, form fields, its lock, scanned pages). Memory
   * only, like the file itself — never persisted (`./storage` writes no file
   * field at all).
   */
  facts?: FileFacts;
}

/** What a recorded activity entry represents. */
export type WorkspaceActionKind =
  "opened-tool" | "queued-batch" | "cleared-files";

/**
 * A recorded workspace activity. Deliberately free of file names or sizes so it
 * is safe to persist across sessions — labels are tool-oriented and the only
 * file signal is an aggregate `fileCount`.
 */
export interface WorkspaceAction {
  id: string;
  kind: WorkspaceActionKind;
  /** Human-readable label, e.g. "Opened Merge PDF". Never contains a file name. */
  label: string;
  /** Slug of the tool involved, when applicable. */
  toolSlug?: string;
  /** Aggregate count of files involved, when applicable. */
  fileCount?: number;
  /** Client-clock ms epoch. */
  at: number;
}

/**
 * Lightweight batch queue: the chosen tool plus the staged file ids enqueued.
 * Readiness is *derived* from the tool's capability (see `planBatch`), never
 * stored, so it can't go stale when the tool selection changes.
 */
export interface BatchQueue {
  /** Slug of the tool the batch will run, or null when unset. */
  toolSlug: string | null;
  /** Ids of staged files (subset of `WorkspaceState.files`) in the queue. */
  fileIds: string[];
}

/** The complete in-memory workspace state. */
export interface WorkspaceState {
  files: WorkspaceFile[];
  selectedToolSlug: string | null;
  recentActions: WorkspaceAction[];
  batch: BatchQueue;
}

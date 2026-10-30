/**
 * Pure state model for the anonymous local workspace, expressed as a reducer over
 * plain data — no React, no DOM, no storage. This keeps the whole staging + tool
 * selection + activity + batch-queue surface unit-testable and deterministic:
 * every id and timestamp is supplied by the caller, never generated in here.
 */

import type { FileFacts } from "@/lib/intent/facts";
import type {
  BatchQueue,
  WorkspaceAction,
  WorkspaceFile,
  WorkspaceState,
} from "./types";

/** Cap on the retained activity log so a long session can't grow state unbounded. */
export const MAX_RECENT_ACTIONS = 8;

/** A fresh, empty workspace. */
export function emptyWorkspace(): WorkspaceState {
  return {
    files: [],
    selectedToolSlug: null,
    recentActions: [],
    batch: { toolSlug: null, fileIds: [] },
  };
}

export type WorkspaceEvent =
  /** Add newly staged files, de-duplicating by id. */
  | { type: "add-files"; files: WorkspaceFile[] }
  /** Remove one staged file (also dropping it from the batch queue). */
  | { type: "remove-file"; id: string }
  /** Attach a locally-parsed page count to a staged PDF (no-op if it's gone). */
  | { type: "set-page-count"; id: string; pageCount: number }
  /**
   * Attach what this tab measured about a staged file (no-op if it's gone);
   * a PDF's page count comes with it, from the same probe.
   */
  | { type: "set-facts"; id: string; facts: FileFacts }
  /** Clear all staged files and the batch items, keeping tool preferences + log. */
  | { type: "clear-files" }
  /** Set (or clear) the highlighted tool. */
  | { type: "select-tool"; slug: string | null }
  /** Prepend an activity entry, capped at {@link MAX_RECENT_ACTIONS}. */
  | { type: "record-action"; action: WorkspaceAction }
  /** Choose the tool the batch queue targets. */
  | { type: "set-batch-tool"; slug: string | null }
  /** Enqueue staged files into the batch (only ids that exist and aren't queued). */
  | { type: "add-to-batch"; ids: string[] }
  /** Remove one file from the batch queue. */
  | { type: "remove-from-batch"; id: string }
  /** Empty the batch queue (keeps the chosen batch tool). */
  | { type: "clear-batch" }
  /** Seed persisted preferences on mount, without touching in-memory files. */
  | {
      type: "hydrate";
      selectedToolSlug: string | null;
      batchToolSlug: string | null;
      recentActions: WorkspaceAction[];
    }
  /** Reset everything to a fresh, empty workspace (the "clear session" control). */
  | { type: "reset" };

/** Drop ids from a batch fileId list, preserving order. */
function pruneBatch(
  batch: BatchQueue,
  keep: (id: string) => boolean,
): BatchQueue {
  const fileIds = batch.fileIds.filter(keep);
  return fileIds.length === batch.fileIds.length
    ? batch
    : { ...batch, fileIds };
}

export function workspaceReducer(
  state: WorkspaceState,
  event: WorkspaceEvent,
): WorkspaceState {
  switch (event.type) {
    case "add-files": {
      if (event.files.length === 0) return state;
      const seen = new Set(state.files.map((f) => f.id));
      const incoming = event.files.filter((f) => !seen.has(f.id));
      if (incoming.length === 0) return state;
      return { ...state, files: [...state.files, ...incoming] };
    }

    case "remove-file": {
      const files = state.files.filter((f) => f.id !== event.id);
      if (files.length === state.files.length) return state;
      return {
        ...state,
        files,
        batch: pruneBatch(state.batch, (id) => id !== event.id),
      };
    }

    case "set-page-count": {
      // Ignore non-positive counts and files that are no longer staged; keep
      // referential identity when nothing actually changes.
      if (!Number.isInteger(event.pageCount) || event.pageCount <= 0)
        return state;
      let changed = false;
      const files = state.files.map((f) => {
        if (f.id !== event.id || f.pageCount === event.pageCount) return f;
        changed = true;
        return { ...f, pageCount: event.pageCount };
      });
      return changed ? { ...state, files } : state;
    }

    case "set-facts": {
      const probe =
        event.facts.pdf?.state === "checked" ? event.facts.pdf.probe : null;
      const pages = probe?.pages ?? null;
      let changed = false;
      const files = state.files.map((f) => {
        if (f.id !== event.id || f.facts === event.facts) return f;
        changed = true;
        return {
          ...f,
          facts: event.facts,
          ...(pages !== null && pages > 0 ? { pageCount: pages } : {}),
        };
      });
      return changed ? { ...state, files } : state;
    }

    case "clear-files": {
      if (state.files.length === 0 && state.batch.fileIds.length === 0)
        return state;
      return {
        ...state,
        files: [],
        batch: { ...state.batch, fileIds: [] },
      };
    }

    case "select-tool": {
      if (state.selectedToolSlug === event.slug) return state;
      return { ...state, selectedToolSlug: event.slug };
    }

    case "record-action": {
      return {
        ...state,
        recentActions: [event.action, ...state.recentActions].slice(
          0,
          MAX_RECENT_ACTIONS,
        ),
      };
    }

    case "set-batch-tool": {
      if (state.batch.toolSlug === event.slug) return state;
      return { ...state, batch: { ...state.batch, toolSlug: event.slug } };
    }

    case "add-to-batch": {
      const staged = new Set(state.files.map((f) => f.id));
      const queued = new Set(state.batch.fileIds);
      const additions: string[] = [];
      for (const id of event.ids) {
        // `queued` accumulates so a duplicate id within the same call is added once.
        if (staged.has(id) && !queued.has(id)) {
          queued.add(id);
          additions.push(id);
        }
      }
      if (additions.length === 0) return state;
      return {
        ...state,
        batch: {
          ...state.batch,
          fileIds: [...state.batch.fileIds, ...additions],
        },
      };
    }

    case "remove-from-batch": {
      const batch = pruneBatch(state.batch, (id) => id !== event.id);
      return batch === state.batch ? state : { ...state, batch };
    }

    case "clear-batch": {
      if (state.batch.fileIds.length === 0) return state;
      return { ...state, batch: { ...state.batch, fileIds: [] } };
    }

    case "hydrate": {
      return {
        ...state,
        selectedToolSlug: event.selectedToolSlug,
        batch: { ...state.batch, toolSlug: event.batchToolSlug },
        recentActions: event.recentActions.slice(0, MAX_RECENT_ACTIONS),
      };
    }

    case "reset": {
      const isEmpty =
        state.files.length === 0 &&
        state.selectedToolSlug === null &&
        state.recentActions.length === 0 &&
        state.batch.toolSlug === null &&
        state.batch.fileIds.length === 0;
      return isEmpty ? state : emptyWorkspace();
    }

    default:
      return state;
  }
}

// ── Batch planning (pure, injectable) ──────────────────────────────────────

/** What a tool can do, from the caller's perspective — injected so this module
 *  stays decoupled from the catalog and is trivially testable. */
export interface BatchToolInfo {
  /** True when the tool has a working in-browser runner. */
  live: boolean;
  /** True when the tool's path goes through a secure worker (server/hybrid/ai). */
  usesWorker: boolean;
  /**
   * How a live tool receives handed-off files. `single` tools work on one PDF at
   * a time (so a batch opens the first queued file), while `collect`/`batch`
   * tools take the whole set. Omitted/`none` is treated as a whole-set launch.
   */
  handoff?: "collect" | "batch" | "single" | "stage" | "none";
}

export type BatchStatus =
  | "empty" // nothing chosen yet
  | "needs-tool" // files queued, no tool
  | "needs-files" // tool chosen, no files
  | "ready" // live collect/batch tool + files → launch the whole set in-browser
  | "single" // live single-file tool + files → opens with the first queued file
  | "worker-disabled" // worker tool, backend not enabled here
  | "unavailable"; // tool has no in-browser runner yet (and isn't a server tool)

export interface BatchPlan {
  toolSlug: string | null;
  fileIds: string[];
  status: BatchStatus;
  /** True only when the batch can actually be launched now (live tool + files). */
  ready: boolean;
}

/**
 * Resolve the batch queue to an honest, actionable status. `resolve` maps a tool
 * slug to its capability; an unknown slug (undefined) is treated as unavailable.
 */
export function planBatch(
  batch: BatchQueue,
  resolve: (slug: string) => BatchToolInfo | undefined,
): BatchPlan {
  const { toolSlug, fileIds } = batch;
  const base = { toolSlug, fileIds };

  if (!toolSlug) {
    return {
      ...base,
      status: fileIds.length === 0 ? "empty" : "needs-tool",
      ready: false,
    };
  }
  const info = resolve(toolSlug);
  if (!info) return { ...base, status: "unavailable", ready: false };
  if (fileIds.length === 0)
    return { ...base, status: "needs-files", ready: false };
  if (info.live) {
    const status: BatchStatus = info.handoff === "single" ? "single" : "ready";
    return { ...base, status, ready: true };
  }
  if (info.usesWorker)
    return { ...base, status: "worker-disabled", ready: false };
  return { ...base, status: "unavailable", ready: false };
}

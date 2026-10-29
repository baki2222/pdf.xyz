/**
 * Pure state model for the Organize Pages editor: the working page list plus a
 * bounded undo/redo history, expressed as a reducer over plain data. No React,
 * no DOM, no pdf-lib — so the whole edit/undo/redo surface is unit-testable.
 *
 * Every edit (move, rotate, duplicate, delete, reverse, reset) pushes the prior
 * state onto `past` and clears `future`; `undo`/`redo` walk the two stacks. A
 * no-op edit (one that wouldn't change the list) is dropped so it never dirties
 * the history or disables Redo unexpectedly.
 */

import { normalizeAngle } from "@/lib/pdf/rotation";
import type { Rotation } from "@/lib/pdf/types";
import { reorder } from "./list-utils";

/** One entry in the working page list. */
export interface OrganizeItem {
  /** Stable key for React and drag/keyboard focus; unique within a session. */
  uid: string;
  /** Index of the source page this entry renders (duplicates repeat one). */
  sourceIndex: number;
  /** Absolute rotation applied on export. */
  rotation: Rotation;
  /**
   * An inserted empty page of this upright size (points) rather than a source
   * page; `sourceIndex` is then -1 and means nothing.
   */
  blank?: { width: number; height: number };
}

/** A page's size in points, upright (before any rotation the plan applies). */
export interface PageSize {
  width: number;
  height: number;
}

/**
 * The size a new blank page takes to match `neighbour` AS SHOWN: the
 * neighbour's upright size (`sizes[sourceIndex]`, or its own if it is a
 * blank) turned by the neighbour's rotation. The blank itself is upright.
 */
export function blankSizeLike(
  neighbour: OrganizeItem,
  sizes: readonly PageSize[],
): PageSize | null {
  const base = neighbour.blank ?? sizes[neighbour.sourceIndex];
  if (!base) return null;
  return neighbour.rotation % 180 === 90
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height };
}

export interface OrganizeHistory {
  past: OrganizeItem[][];
  present: OrganizeItem[];
  future: OrganizeItem[][];
}

/** Cap the undo depth so a long editing session can't grow state unbounded. */
export const MAX_HISTORY = 100;

export type OrganizeAction =
  | { type: "move"; from: number; to: number }
  // uid-addressed moves keep keyboard reordering correct under key-repeat: the
  // source position is resolved against the *current* list, never a stale index.
  | { type: "moveUidBy"; uid: string; delta: number }
  | { type: "moveUidTo"; uid: string; index: number }
  | { type: "rotate"; index: number; delta: number }
  | { type: "duplicate"; index: number; uid: string }
  | { type: "delete"; index: number }
  // `sizes`: every source page's upright size, so the blank can match the
  // tile it is inserted beside (see `blankSizeLike`).
  | {
      type: "insertBlank";
      index: number;
      side: "before" | "after";
      uid: string;
      sizes: readonly PageSize[];
    }
  | { type: "reverse" }
  | { type: "reset"; items: OrganizeItem[] }
  | { type: "undo" }
  | { type: "redo" };

export function initHistory(present: OrganizeItem[]): OrganizeHistory {
  return { past: [], present, future: [] };
}

export function canUndo(history: OrganizeHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: OrganizeHistory): boolean {
  return history.future.length > 0;
}

/** Structural equality on the fields that matter for export + rendering. */
function sameItems(a: OrganizeItem[], b: OrganizeItem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every(
    (item, i) =>
      item.uid === b[i]!.uid &&
      item.sourceIndex === b[i]!.sourceIndex &&
      item.rotation === b[i]!.rotation,
  );
}

/**
 * Apply an edit to the working list, returning the next list or `null` when the
 * action isn't a list edit (undo/redo) or can't be applied. Never mutates input.
 */
function applyEdit(
  items: OrganizeItem[],
  action: OrganizeAction,
): OrganizeItem[] | null {
  switch (action.type) {
    case "move":
      return reorder(items, action.from, action.to);
    case "moveUidBy": {
      const from = items.findIndex((item) => item.uid === action.uid);
      if (from === -1) return items;
      return reorder(items, from, from + action.delta);
    }
    case "moveUidTo": {
      const from = items.findIndex((item) => item.uid === action.uid);
      if (from === -1) return items;
      return reorder(items, from, action.index);
    }
    case "rotate":
      return items.map((item, i) =>
        i === action.index
          ? { ...item, rotation: normalizeAngle(item.rotation + action.delta) }
          : item,
      );
    case "duplicate": {
      const source = items[action.index];
      if (!source) return items;
      const next = items.slice();
      next.splice(action.index + 1, 0, { ...source, uid: action.uid });
      return next;
    }
    case "delete": {
      // Never delete the last page OF THE DOCUMENT — an output of only
      // inserted blanks has nothing of the PDF left, and the engine refuses it.
      const target = items[action.index];
      if (!target) return items;
      if (!target.blank && sourcePageCount(items) <= 1) return items;
      return items.filter((_, i) => i !== action.index);
    }
    case "insertBlank": {
      const neighbour = items[action.index];
      const size = neighbour && blankSizeLike(neighbour, action.sizes);
      if (!size) return items;
      const next = items.slice();
      next.splice(action.index + (action.side === "after" ? 1 : 0), 0, {
        uid: action.uid,
        sourceIndex: -1,
        rotation: 0,
        blank: size,
      });
      return next;
    }
    case "reverse":
      return items.slice().reverse();
    case "reset":
      return action.items;
    default:
      return null;
  }
}

/** How many entries are pages of the document (not inserted blanks). */
export function sourcePageCount(items: readonly OrganizeItem[]): number {
  return items.reduce((n, item) => (item.blank ? n : n + 1), 0);
}

/** Push a new present onto the history, trimming `past` to `MAX_HISTORY`. */
function commit(
  history: OrganizeHistory,
  next: OrganizeItem[],
): OrganizeHistory {
  const past = [...history.past, history.present];
  return {
    past:
      past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past,
    present: next,
    future: [],
  };
}

export function organizeReducer(
  history: OrganizeHistory,
  action: OrganizeAction,
): OrganizeHistory {
  if (action.type === "undo") {
    if (!canUndo(history)) return history;
    const previous = history.past[history.past.length - 1]!;
    return {
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future],
    };
  }
  if (action.type === "redo") {
    if (!canRedo(history)) return history;
    const next = history.future[0]!;
    return {
      past: [...history.past, history.present],
      present: next,
      future: history.future.slice(1),
    };
  }

  const next = applyEdit(history.present, action);
  // Drop no-op edits so they don't clutter history or clear a valid redo stack.
  if (next === null || sameItems(next, history.present)) return history;
  return commit(history, next);
}

/**
 * Has the working list diverged from its initial state? Compared by page
 * identity + rotation (uid is ignored, since a fresh reset re-keys nothing).
 */
export function isDirty(
  items: OrganizeItem[],
  initial: OrganizeItem[],
): boolean {
  if (items.length !== initial.length) return true;
  return items.some(
    (item, i) =>
      item.sourceIndex !== initial[i]?.sourceIndex ||
      item.rotation !== initial[i]?.rotation,
  );
}

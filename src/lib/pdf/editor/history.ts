import type { EditorObject } from "./model";
import type { PageRef } from "./pages";

/**
 * Undo/redo for the editor, as commands over the ordered object list.
 *
 * A command is a set of CHANGES, each naming one object id with its value
 * before and after (null = absent). Applying writes every `after`; reverting
 * writes every `before` — so add, delete, move, resize, restyle and retype are
 * one shape, and a multi-object move is one step. An absent object that
 * returns goes back to the index it held (`at`), so z-order survives an undo
 * of a delete.
 *
 * Consecutive commands with the same `coalesce` key merge (arrow-key nudges,
 * a slider dragged through twenty values) into one undo step, keeping the
 * FIRST `before` and the LAST `after`.
 *
 * Pure: every function returns new arrays and never mutates its inputs.
 */

export interface Change {
  id: string;
  before: EditorObject | null;
  after: EditorObject | null;
  /** Index the object held before it was removed / will be inserted at. */
  at: number;
}

export interface Command {
  label: string;
  changes: Change[];
  /** Merge with the previous command when both carry the same key. */
  coalesce?: string;
  /**
   * A page operation (`pages.ts`): the page list before and after. The
   * reducer writes `after` on do and `before` on undo, in the same step as
   * the object changes that keep everything on its page.
   */
  pages?: { before: PageRef[]; after: PageRef[] };
}

export interface History {
  past: Command[];
  future: Command[];
}

export const HISTORY_LIMIT = 200;

export const EMPTY_HISTORY: History = { past: [], future: [] };

function write(
  objects: EditorObject[],
  id: string,
  value: EditorObject | null,
  at: number,
): EditorObject[] {
  const index = objects.findIndex((o) => o.id === id);
  if (value === null) {
    return index < 0 ? objects : objects.filter((_, i) => i !== index);
  }
  if (index >= 0) {
    const next = objects.slice();
    next[index] = value;
    return next;
  }
  const next = objects.slice();
  next.splice(Math.min(Math.max(0, at), next.length), 0, value);
  return next;
}

/** Apply (`"do"`) or revert (`"undo"`) a command. */
export function runCommand(
  objects: EditorObject[],
  command: Command,
  direction: "do" | "undo",
): EditorObject[] {
  let next = objects;
  if (direction === "do") {
    for (const change of command.changes) {
      next = write(next, change.id, change.after, change.at);
    }
  } else {
    // Reverse order, so inserts and removals unwind the way they wound.
    for (let i = command.changes.length - 1; i >= 0; i -= 1) {
      const change = command.changes[i]!;
      next = write(next, change.id, change.before, change.at);
    }
  }
  return next;
}

/** Build a command from a before/after pair of objects (same id). */
export function changeOf(
  objects: readonly EditorObject[],
  before: EditorObject | null,
  after: EditorObject | null,
): Change {
  const id = (before ?? after)!.id;
  const index = objects.findIndex((o) => o.id === id);
  return { id, before, after, at: index < 0 ? objects.length : index };
}

export type StackMove = "forward" | "backward" | "front" | "back";

/**
 * Z-order: move the objects `ids` within their page's stack. The list's
 * order IS the drawing order (overlay and export), so a move is the object
 * taken out and put back at another index — two changes for the same id,
 * which `runCommand` replays in order and unwinds in reverse. "Forward" and
 * "backward" step past the next object ON THE SAME PAGE; objects on other
 * pages never draw over each other.
 */
export function stackChanges(
  objects: readonly EditorObject[],
  ids: readonly string[],
  move: StackMove,
): Change[] {
  const picked = new Set(ids);
  let order = objects.slice();
  const pages = new Set(
    objects.filter((o) => picked.has(o.id)).map((o) => o.page),
  );
  for (const page of pages) {
    const mine = order.filter((o) => o.page === page);
    const slots = mine.map((o) => order.indexOf(o));
    let stack = mine.slice();
    const isPicked = (o: EditorObject) => picked.has(o.id);
    if (move === "front") {
      stack = [...stack.filter((o) => !isPicked(o)), ...stack.filter(isPicked)];
    } else if (move === "back") {
      stack = [...stack.filter(isPicked), ...stack.filter((o) => !isPicked(o))];
    } else if (move === "forward") {
      for (let i = stack.length - 2; i >= 0; i -= 1) {
        if (isPicked(stack[i]!) && !isPicked(stack[i + 1]!)) {
          [stack[i], stack[i + 1]] = [stack[i + 1]!, stack[i]!];
        }
      }
    } else {
      for (let i = 1; i < stack.length; i += 1) {
        if (isPicked(stack[i]!) && !isPicked(stack[i - 1]!)) {
          [stack[i], stack[i - 1]] = [stack[i - 1]!, stack[i]!];
        }
      }
    }
    // The page's objects keep the list slots they had, in their new order.
    const next = order.slice();
    slots.forEach((slot, i) => {
      next[slot] = stack[i]!;
    });
    order = next;
  }
  // Out of the old list highest index first, into the new one lowest first:
  // each `at` is right at the moment it is applied, in both directions.
  const moved = order.filter((o, i) => objects[i] !== o);
  const removals = moved
    .map((o) => ({ o, at: objects.indexOf(o) }))
    .sort((a, b) => b.at - a.at)
    .map(({ o, at }) => ({ id: o.id, before: o, after: null, at }));
  const inserts = moved
    .map((o) => ({ o, at: order.indexOf(o) }))
    .sort((a, b) => a.at - b.at)
    .map(({ o, at }) => ({ id: o.id, before: null, after: o, at }));
  return [...removals, ...inserts];
}

function merge(previous: Command, next: Command): Command {
  const changes = previous.changes.map((c) => ({ ...c }));
  for (const change of next.changes) {
    const existing = changes.find((c) => c.id === change.id);
    if (existing) existing.after = change.after;
    else changes.push(change);
  }
  return { ...previous, label: next.label, changes };
}

/**
 * Do a new command: apply it, push it, and clear the redo stack. Returns the
 * new objects and history. A command with no changes is a no-op.
 */
export function commit(
  objects: EditorObject[],
  history: History,
  command: Command,
): { objects: EditorObject[]; history: History } {
  if (command.changes.length === 0 && !command.pages) {
    return { objects, history };
  }
  const next = runCommand(objects, command, "do");
  const last = history.past[history.past.length - 1];
  const past =
    command.coalesce && last?.coalesce === command.coalesce
      ? [...history.past.slice(0, -1), merge(last, command)]
      : [...history.past, command];
  return {
    objects: next,
    history: { past: past.slice(-HISTORY_LIMIT), future: [] },
  };
}

export function undo(
  objects: EditorObject[],
  history: History,
): { objects: EditorObject[]; history: History; command: Command | null } {
  const command = history.past[history.past.length - 1];
  if (!command) return { objects, history, command: null };
  return {
    objects: runCommand(objects, command, "undo"),
    history: {
      past: history.past.slice(0, -1),
      future: [command, ...history.future],
    },
    command,
  };
}

export function redo(
  objects: EditorObject[],
  history: History,
): { objects: EditorObject[]; history: History; command: Command | null } {
  const command = history.future[0];
  if (!command) return { objects, history, command: null };
  return {
    objects: runCommand(objects, command, "do"),
    history: {
      past: [...history.past, { ...command, coalesce: undefined }],
      future: history.future.slice(1),
    },
    command,
  };
}

/** Stop the last command from absorbing the next one with the same key. */
export function sealHistory(history: History): History {
  const last = history.past[history.past.length - 1];
  if (!last?.coalesce) return history;
  return {
    ...history,
    past: [...history.past.slice(0, -1), { ...last, coalesce: undefined }],
  };
}

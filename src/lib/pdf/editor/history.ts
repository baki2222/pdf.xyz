import type { EditorObject } from "./model";

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
  if (command.changes.length === 0) return { objects, history };
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

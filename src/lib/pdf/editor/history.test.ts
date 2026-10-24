import { describe, expect, it } from "vitest";
import {
  EMPTY_HISTORY,
  HISTORY_LIMIT,
  changeOf,
  commit,
  redo,
  sealHistory,
  undo,
  type Command,
  type History,
} from "./history";
import {
  DEFAULT_TEXT_STYLE,
  moveObject,
  resizeObject,
  type EditorObject,
  type ShapeObject,
  type TextBoxObject,
} from "./model";

const rect = (id: string, x = 10): ShapeObject => ({
  id,
  kind: "shape",
  shape: "rect",
  page: 0,
  x,
  y: 20,
  width: 50,
  height: 30,
  stroke: "#000000",
  strokeWidth: 2,
  fill: null,
  opacity: 1,
});

const text = (id: string, words: string): TextBoxObject => ({
  id,
  kind: "text",
  page: 0,
  x: 5,
  y: 5,
  width: 200,
  text: words,
  ...DEFAULT_TEXT_STYLE,
});

function add(objects: EditorObject[], history: History, obj: EditorObject) {
  return commit(objects, history, {
    label: "Add",
    changes: [changeOf(objects, null, obj)],
  });
}

function update(
  objects: EditorObject[],
  history: History,
  next: EditorObject,
  label = "Edit",
  coalesce?: string,
) {
  const before = objects.find((o) => o.id === next.id)!;
  const command: Command = {
    label,
    changes: [changeOf(objects, before, next)],
    coalesce,
  };
  return commit(objects, history, command);
}

describe("undo / redo over the object list", () => {
  it("undoes and redoes add, move, resize, edit and delete, in order", () => {
    let s = { objects: [] as EditorObject[], history: EMPTY_HISTORY };
    const snapshots: EditorObject[][] = [s.objects];

    s = add(s.objects, s.history, rect("a"));
    snapshots.push(s.objects);
    s = add(s.objects, s.history, text("t", "hello"));
    snapshots.push(s.objects);
    s = update(s.objects, s.history, moveObject(s.objects[0]!, 15, 5), "Move");
    snapshots.push(s.objects);
    const a = s.objects[0]!;
    s = update(
      s.objects,
      s.history,
      resizeObject(
        a,
        { x: 25, y: 25, width: 50, height: 30 },
        {
          x: 25,
          y: 25,
          width: 120,
          height: 90,
        },
      ),
      "Resize",
    );
    snapshots.push(s.objects);
    s = update(s.objects, s.history, {
      ...(s.objects[1] as TextBoxObject),
      text: "hello world",
    });
    snapshots.push(s.objects);
    s = commit(s.objects, s.history, {
      label: "Delete",
      changes: [changeOf(s.objects, s.objects[0]!, null)],
    });
    snapshots.push(s.objects);

    expect(s.objects.map((o) => o.id)).toEqual(["t"]);
    expect(s.history.past).toHaveLength(6);

    // Undo all the way back, checking every intermediate state.
    for (let i = snapshots.length - 2; i >= 0; i -= 1) {
      const u = undo(s.objects, s.history);
      s = { objects: u.objects, history: u.history };
      expect(s.objects, `after undo to state ${i}`).toEqual(snapshots[i]);
    }
    expect(undo(s.objects, s.history).command).toBeNull();

    // Redo all the way forward.
    for (let i = 1; i < snapshots.length; i += 1) {
      const r = redo(s.objects, s.history);
      s = { objects: r.objects, history: r.history };
      expect(s.objects, `after redo to state ${i}`).toEqual(snapshots[i]);
    }
    expect(redo(s.objects, s.history).command).toBeNull();
  });

  it("puts an undeleted object back at its z-order position", () => {
    let s = { objects: [] as EditorObject[], history: EMPTY_HISTORY };
    for (const id of ["a", "b", "c"]) s = add(s.objects, s.history, rect(id));
    s = commit(s.objects, s.history, {
      label: "Delete",
      changes: [changeOf(s.objects, s.objects[1]!, null)],
    });
    expect(s.objects.map((o) => o.id)).toEqual(["a", "c"]);
    const u = undo(s.objects, s.history);
    expect(u.objects.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("a new command clears the redo stack", () => {
    let s = add([], EMPTY_HISTORY, rect("a"));
    s = add(s.objects, s.history, rect("b"));
    const u = undo(s.objects, s.history);
    expect(u.history.future).toHaveLength(1);
    const next = add(u.objects, u.history, rect("c"));
    expect(next.history.future).toHaveLength(0);
    expect(redo(next.objects, next.history).command).toBeNull();
  });

  it("coalesces nudges into one step, and sealing ends the run", () => {
    let s = add([], EMPTY_HISTORY, rect("a", 10));
    for (let i = 0; i < 5; i += 1) {
      s = update(
        s.objects,
        s.history,
        moveObject(s.objects[0]!, 1, 0),
        "Nudge",
        "nudge:a",
      );
    }
    expect(s.history.past).toHaveLength(2);
    expect((s.objects[0] as ShapeObject).x).toBe(15);
    const u = undo(s.objects, s.history);
    expect((u.objects[0] as ShapeObject).x).toBe(10);

    // Sealed: the next nudge is its own step.
    s = { ...s, history: sealHistory(s.history) };
    s = update(
      s.objects,
      s.history,
      moveObject(s.objects[0]!, 1, 0),
      "Nudge",
      "nudge:a",
    );
    expect(s.history.past).toHaveLength(3);
  });

  it("moves several objects as one step", () => {
    let s = add([], EMPTY_HISTORY, rect("a", 10));
    s = add(s.objects, s.history, rect("b", 100));
    s = commit(s.objects, s.history, {
      label: "Move",
      changes: s.objects.map((o) =>
        changeOf(s.objects, o, moveObject(o, 7, 0)),
      ),
    });
    expect(s.objects.map((o) => (o as ShapeObject).x)).toEqual([17, 107]);
    const u = undo(s.objects, s.history);
    expect(u.objects.map((o) => (o as ShapeObject).x)).toEqual([10, 100]);
  });

  it("an empty command is not a step", () => {
    const s = commit([], EMPTY_HISTORY, { label: "Nothing", changes: [] });
    expect(s.history.past).toHaveLength(0);
  });

  it("keeps at most HISTORY_LIMIT steps", () => {
    let s = add([], EMPTY_HISTORY, rect("a", 0));
    for (let i = 0; i < HISTORY_LIMIT + 20; i += 1) {
      s = update(s.objects, s.history, moveObject(s.objects[0]!, 1, 0));
    }
    expect(s.history.past).toHaveLength(HISTORY_LIMIT);
  });

  it("never mutates the lists it is given", () => {
    const objects = [rect("a")];
    const frozen = JSON.stringify(objects);
    const s = update(objects, EMPTY_HISTORY, moveObject(objects[0]!, 5, 5));
    undo(s.objects, s.history);
    expect(JSON.stringify(objects)).toBe(frozen);
  });
});

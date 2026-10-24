import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  initHistory,
  isDirty,
  MAX_HISTORY,
  organizeReducer,
  type OrganizeHistory,
  type OrganizeItem,
} from "./organize-history";

/** Build a fresh working list of `n` source pages, all unrotated. */
function items(n: number): OrganizeItem[] {
  return Array.from({ length: n }, (_, i) => ({
    uid: `s${i}`,
    sourceIndex: i,
    rotation: 0 as const,
  }));
}

/** Compact "sourceIndex@rotation" view of the present list, for assertions. */
function view(history: OrganizeHistory): string[] {
  return history.present.map((it) => `${it.sourceIndex}@${it.rotation}`);
}

describe("organizeReducer — edits", () => {
  it("moves a page and records history", () => {
    const start = initHistory(items(3));
    const moved = organizeReducer(start, { type: "move", from: 0, to: 2 });
    expect(view(moved)).toEqual(["1@0", "2@0", "0@0"]);
    expect(canUndo(moved)).toBe(true);
    expect(canRedo(moved)).toBe(false);
  });

  it("applies absolute, normalized rotation to one page", () => {
    const start = initHistory(items(2));
    let h = organizeReducer(start, { type: "rotate", index: 1, delta: 90 });
    h = organizeReducer(h, { type: "rotate", index: 1, delta: 270 });
    expect(view(h)).toEqual(["0@0", "1@0"]); // 90 + 270 = 360 → 0
    h = organizeReducer(h, { type: "rotate", index: 0, delta: -90 });
    expect(view(h)).toEqual(["0@270", "1@0"]); // -90 normalizes to 270
  });

  it("duplicates a page with the caller-supplied uid, just after it", () => {
    const start = initHistory(items(2));
    const dup = organizeReducer(start, {
      type: "duplicate",
      index: 0,
      uid: "d1",
    });
    expect(dup.present.map((i) => i.uid)).toEqual(["s0", "d1", "s1"]);
    expect(dup.present[1]!.sourceIndex).toBe(0);
  });

  it("deletes a page but refuses to empty the document", () => {
    const start = initHistory(items(2));
    const one = organizeReducer(start, { type: "delete", index: 0 });
    expect(view(one)).toEqual(["1@0"]);
    const stillOne = organizeReducer(one, { type: "delete", index: 0 });
    expect(view(stillOne)).toEqual(["1@0"]); // no-op: last page kept
    expect(canUndo(stillOne)).toBe(canUndo(one)); // history unchanged by the no-op
  });

  it("inserts a blank page before or after a tile, sized like that tile as shown", () => {
    // Page 0 is 200×300 upright; page 1 is 400×250 and turned a quarter in
    // the plan, so a reader sees it 250 wide and 400 tall.
    const sizes = [
      { width: 200, height: 300 },
      { width: 400, height: 250 },
    ];
    let h = initHistory(items(2));
    h = organizeReducer(h, { type: "rotate", index: 1, delta: 90 });
    h = organizeReducer(h, {
      type: "insertBlank",
      index: 1,
      side: "after",
      uid: "b1",
      sizes,
    });
    h = organizeReducer(h, {
      type: "insertBlank",
      index: 0,
      side: "before",
      uid: "b2",
      sizes,
    });
    expect(h.present.map((i) => i.uid)).toEqual(["b2", "s0", "s1", "b1"]);
    expect(h.present[0]!.blank).toEqual({ width: 200, height: 300 });
    expect(h.present[3]!.blank).toEqual({ width: 250, height: 400 });
    expect(h.present[3]!.rotation).toBe(0);
    // A blank next to a blank is sized like it, and undo takes it out.
    const next = organizeReducer(h, {
      type: "insertBlank",
      index: 3,
      side: "after",
      uid: "b3",
      sizes,
    });
    expect(next.present[4]!.blank).toEqual({ width: 250, height: 400 });
    expect(organizeReducer(next, { type: "undo" }).present).toEqual(h.present);
  });

  it("never deletes the document's last page, even with blanks beside it", () => {
    let h = initHistory(items(1));
    h = organizeReducer(h, {
      type: "insertBlank",
      index: 0,
      side: "after",
      uid: "b1",
      sizes: [{ width: 100, height: 100 }],
    });
    const same = organizeReducer(h, { type: "delete", index: 0 });
    expect(same).toBe(h);
    // The blank itself can go.
    expect(
      organizeReducer(h, { type: "delete", index: 1 }).present.map(
        (i) => i.uid,
      ),
    ).toEqual(["s0"]);
  });

  it("reverses the whole list", () => {
    const start = initHistory(items(3));
    const rev = organizeReducer(start, { type: "reverse" });
    expect(view(rev)).toEqual(["2@0", "1@0", "0@0"]);
  });

  it("moves a page by uid, resolving its current position (key-repeat safe)", () => {
    const start = initHistory(items(3)); // uids s0,s1,s2
    let h = organizeReducer(start, { type: "moveUidBy", uid: "s0", delta: 1 });
    expect(h.present.map((i) => i.uid)).toEqual(["s1", "s0", "s2"]);
    // A second nudge resolves s0's *new* index, not the stale one.
    h = organizeReducer(h, { type: "moveUidBy", uid: "s0", delta: 1 });
    expect(h.present.map((i) => i.uid)).toEqual(["s1", "s2", "s0"]);
    // Clamped: nudging past the end is a no-op that doesn't touch history.
    const clamped = organizeReducer(h, {
      type: "moveUidBy",
      uid: "s0",
      delta: 1,
    });
    expect(clamped).toBe(h);
  });

  it("moves a page by uid to an absolute index", () => {
    const start = initHistory(items(3));
    const h = organizeReducer(start, {
      type: "moveUidTo",
      uid: "s2",
      index: 0,
    });
    expect(h.present.map((i) => i.uid)).toEqual(["s2", "s0", "s1"]);
  });

  it("ignores uid moves for an unknown page", () => {
    const start = initHistory(items(2));
    expect(
      organizeReducer(start, { type: "moveUidBy", uid: "nope", delta: 1 }),
    ).toBe(start);
  });

  it("drops no-op moves so they never dirty history", () => {
    const start = initHistory(items(3));
    const same = organizeReducer(start, { type: "move", from: 1, to: 1 });
    expect(same).toBe(start);
    expect(canUndo(same)).toBe(false);
  });
});

describe("organizeReducer — undo/redo", () => {
  it("undoes and redoes an edit", () => {
    const start = initHistory(items(3));
    const moved = organizeReducer(start, { type: "move", from: 0, to: 2 });
    const undone = organizeReducer(moved, { type: "undo" });
    expect(view(undone)).toEqual(["0@0", "1@0", "2@0"]);
    expect(canRedo(undone)).toBe(true);
    const redone = organizeReducer(undone, { type: "redo" });
    expect(view(redone)).toEqual(["1@0", "2@0", "0@0"]);
  });

  it("is a no-op at the ends of the timeline", () => {
    const start = initHistory(items(2));
    expect(organizeReducer(start, { type: "undo" })).toBe(start);
    expect(organizeReducer(start, { type: "redo" })).toBe(start);
  });

  it("clears the redo stack once a new edit is made", () => {
    const start = initHistory(items(3));
    const moved = organizeReducer(start, { type: "move", from: 0, to: 1 });
    const undone = organizeReducer(moved, { type: "undo" });
    expect(canRedo(undone)).toBe(true);
    const edited = organizeReducer(undone, { type: "reverse" });
    expect(canRedo(edited)).toBe(false);
  });

  it("walks a multi-step timeline correctly", () => {
    let h = initHistory(items(3));
    h = organizeReducer(h, { type: "reverse" }); // [2,1,0]
    h = organizeReducer(h, { type: "delete", index: 0 }); // [1,0]
    expect(view(h)).toEqual(["1@0", "0@0"]);
    h = organizeReducer(h, { type: "undo" }); // back to [2,1,0]
    expect(view(h)).toEqual(["2@0", "1@0", "0@0"]);
    h = organizeReducer(h, { type: "undo" }); // back to [0,1,2]
    expect(view(h)).toEqual(["0@0", "1@0", "2@0"]);
    expect(canUndo(h)).toBe(false);
  });
});

describe("organizeReducer — history bound", () => {
  it("caps the undo depth at MAX_HISTORY", () => {
    let h = initHistory(items(2));
    for (let i = 0; i < MAX_HISTORY + 25; i++) {
      h = organizeReducer(h, { type: "rotate", index: 0, delta: 90 });
    }
    expect(h.past.length).toBe(MAX_HISTORY);
  });
});

describe("isDirty", () => {
  const initial = items(3);

  it("is false for the initial list", () => {
    expect(isDirty(items(3), initial)).toBe(false);
  });

  it("is true after a reorder or a rotation or a length change", () => {
    const start = initHistory(initial);
    expect(
      isDirty(
        organizeReducer(start, { type: "move", from: 0, to: 2 }).present,
        initial,
      ),
    ).toBe(true);
    expect(
      isDirty(
        organizeReducer(start, { type: "rotate", index: 0, delta: 90 }).present,
        initial,
      ),
    ).toBe(true);
    expect(
      isDirty(
        organizeReducer(start, { type: "delete", index: 0 }).present,
        initial,
      ),
    ).toBe(true);
  });
});

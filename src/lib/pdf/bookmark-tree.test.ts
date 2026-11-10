import { describe, expect, it } from "vitest";
import { BOOKMARK_DEPTH_MAX } from "./bookmark-labels";
import {
  countAll,
  depthOf,
  find,
  allNodes,
  indent,
  insertAfter,
  insertChild,
  move,
  movesFor,
  outdent,
  pageBookmarks,
  remove,
  rename,
  type BookmarkNode,
  type Tree,
} from "./bookmark-tree";

const node = (id: string, children: BookmarkNode[] = []): BookmarkNode => ({
  id,
  title: id.toUpperCase(),
  target: { kind: "page", page: 1 },
  open: false,
  children,
});

/** The tree as nested ids: `a(b,c)`. */
const ids = (items: Tree): string =>
  items
    .map((n) => (n.children.length ? `${n.id}(${ids(n.children)})` : n.id))
    .join(",");

const sample = (): Tree => [
  node("a", [node("a1"), node("a2")]),
  node("b"),
  node("c"),
];

describe("bookmark tree edits", () => {
  it("move swaps within the level and stops at its ends", () => {
    expect(ids(move(sample(), "b", -1))).toBe("b,a(a1,a2),c");
    expect(ids(move(sample(), "a2", -1))).toBe("a(a2,a1),b,c");
    expect(ids(move(sample(), "c", 1))).toBe("a(a1,a2),b,c");
    expect(movesFor(sample(), "a")).toMatchObject({ up: false, down: true });
    expect(movesFor(sample(), "c")).toMatchObject({ up: true, down: false });
  });

  it("indent nests under the previous sibling and opens it; outdent follows the parent", () => {
    const nested = indent(sample(), "b");
    expect(ids(nested)).toBe("a(a1,a2,b),c");
    expect(find(nested, "a")!.open).toBe(true);
    expect(ids(indent(sample(), "a"))).toBe("a(a1,a2),b,c");
    expect(ids(outdent(sample(), "a1"))).toBe("a(a2),a1,b,c");
    expect(ids(outdent(sample(), "b"))).toBe("a(a1,a2),b,c");
    expect(movesFor(sample(), "a1")).toMatchObject({
      indent: false,
      outdent: true,
    });
    expect(movesFor(sample(), "a2")).toMatchObject({
      indent: true,
      outdent: true,
    });
  });

  it("indent is refused past the depth limit", () => {
    let deep: BookmarkNode = node("leaf");
    for (let i = 0; i < BOOKMARK_DEPTH_MAX - 2; i += 1)
      deep = node(`d${i}`, [deep]);
    const tree: Tree = [node("first"), deep];
    expect(depthOf(tree)).toBe(BOOKMARK_DEPTH_MAX - 1);
    expect(movesFor(tree, deep.id).indent).toBe(true);
    const deeper = indent(tree, deep.id);
    expect(depthOf(deeper)).toBe(BOOKMARK_DEPTH_MAX);
    const tree2: Tree = [node("x", [node("first")]), node("y", [deep])];
    expect(movesFor(tree2, deep.id).indent).toBe(false);
    expect(indent(tree2, deep.id)).toBe(tree2);
  });

  it("remove takes the subtree; insert after and as a child; counts", () => {
    expect(ids(remove(sample(), "a"))).toBe("b,c");
    expect(ids(insertAfter(sample(), "a1", node("n")))).toBe("a(a1,n,a2),b,c");
    const child = insertChild(sample(), "b", node("n"));
    expect(ids(child)).toBe("a(a1,a2),b(n),c");
    expect(find(child, "b")!.open).toBe(true);
    expect(countAll(sample())).toBe(5);
    expect(depthOf(sample())).toBe(2);
    expect(allNodes(sample()).map((f) => `${f.node.id}:${f.depth}`)).toEqual([
      "a:1",
      "a1:2",
      "a2:2",
      "b:1",
      "c:1",
    ]);
  });

  it("edits never change the tree they were given", () => {
    const tree = sample();
    const snapshot = JSON.stringify(tree);
    rename(tree, "a1", "x");
    move(tree, "b", -1);
    indent(tree, "b");
    outdent(tree, "a1");
    remove(tree, "a");
    insertChild(tree, "c", node("n"));
    expect(JSON.stringify(tree)).toBe(snapshot);
  });

  it("page bookmarks: one per page, or one every N pages", () => {
    let n = 0;
    const next = () => `g${n++}`;
    expect(pageBookmarks(3, 1, next).map((b) => [b.title, b.target])).toEqual([
      ["Page 1", { kind: "page", page: 1 }],
      ["Page 2", { kind: "page", page: 2 }],
      ["Page 3", { kind: "page", page: 3 }],
    ]);
    expect(pageBookmarks(12, 5, next).map((b) => b.title)).toEqual([
      "Page 1",
      "Page 6",
      "Page 11",
    ]);
    expect(pageBookmarks(2, 0, next)).toHaveLength(2);
  });
});

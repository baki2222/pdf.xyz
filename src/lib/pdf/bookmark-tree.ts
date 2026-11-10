/**
 * Edit PDF Bookmarks' outline as plain data, and every edit the panel makes
 * to it: rename, point at a page, add, delete, move, indent, outdent, open
 * or close, and bookmarks generated from page numbers. Pure functions over
 * an immutable tree — each returns a new tree, so the panel's undo history
 * is a list of trees.
 *
 * No pdf-lib, no DOM. The engine (`bookmarks.ts`) reads a PDF's outline into
 * this shape and writes this shape back; nothing here knows about objects.
 */

import { BOOKMARK_DEPTH_MAX } from "./bookmark-labels";

/** Where a bookmark goes. Only `page` can be authored; the rest are read. */
export type BookmarkTarget =
  | { kind: "page"; page: number }
  | { kind: "uri"; uri: string }
  | { kind: "named"; action: string }
  | { kind: "none" };

export interface BookmarkNode {
  /**
   * Stable within one reading: `b<n>` is the n-th item the engine read from
   * the file, in walk order (the writer re-reads the same bytes and finds
   * the same ids); anything else is new.
   */
  readonly id: string;
  readonly title: string;
  readonly target: BookmarkTarget;
  /** Shown expanded when the PDF opens (positive `/Count`). */
  readonly open: boolean;
  readonly children: readonly BookmarkNode[];
}

export type Tree = readonly BookmarkNode[];

/** Every node, depth first, with its depth (1 = top level). */
export function allNodes(
  items: Tree,
  depth = 1,
): { node: BookmarkNode; depth: number }[] {
  return items.flatMap((node) => [
    { node, depth },
    ...allNodes(node.children, depth + 1),
  ]);
}

/** How many bookmarks, at every level. */
export function countAll(items: Tree): number {
  return items.reduce((n, item) => n + 1 + countAll(item.children), 0);
}

/** How many levels deep (0 for an empty list). */
export function depthOf(items: Tree): number {
  return items.reduce((d, item) => Math.max(d, 1 + depthOf(item.children)), 0);
}

/** Where `id` sits: the index of each ancestor, then its own. */
export function pathOf(items: Tree, id: string): number[] | null {
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    if (item.id === id) return [i];
    const below = pathOf(item.children, id);
    if (below) return [i, ...below];
  }
  return null;
}

export function find(items: Tree, id: string): BookmarkNode | null {
  const at = pathOf(items, id);
  if (!at) return null;
  let list = items;
  let node: BookmarkNode | null = null;
  for (const i of at) {
    node = list[i]!;
    list = node.children;
  }
  return node;
}

/** The list at `parentPath` replaced by `edit(list)`. */
function editList(
  items: Tree,
  parentPath: readonly number[],
  edit: (list: BookmarkNode[]) => BookmarkNode[],
): Tree {
  if (parentPath.length === 0) return edit([...items]);
  const [head, ...rest] = parentPath;
  return items.map((item, i) =>
    i === head
      ? { ...item, children: editList(item.children, rest, edit) }
      : item,
  );
}

/** `id`'s node replaced by `edit(node)`. */
export function update(
  items: Tree,
  id: string,
  edit: (node: BookmarkNode) => BookmarkNode,
): Tree {
  const at = pathOf(items, id);
  if (!at) return items;
  return editList(items, at.slice(0, -1), (list) => {
    list[at.at(-1)!] = edit(list[at.at(-1)!]!);
    return list;
  });
}

export function rename(items: Tree, id: string, title: string): Tree {
  return update(items, id, (n) => ({ ...n, title }));
}

export function retarget(items: Tree, id: string, target: BookmarkTarget) {
  return update(items, id, (n) => ({ ...n, target }));
}

export function setOpen(items: Tree, id: string, open: boolean): Tree {
  return update(items, id, (n) => ({ ...n, open }));
}

/** `id` and everything below it, gone. */
export function remove(items: Tree, id: string): Tree {
  const at = pathOf(items, id);
  if (!at) return items;
  return editList(items, at.slice(0, -1), (list) => {
    list.splice(at.at(-1)!, 1);
    return list;
  });
}

/** `node` inserted right after `id`, at the same level. */
export function insertAfter(items: Tree, id: string, node: BookmarkNode) {
  const at = pathOf(items, id);
  if (!at) return [...items, node];
  return editList(items, at.slice(0, -1), (list) => {
    list.splice(at.at(-1)! + 1, 0, node);
    return list;
  });
}

/** `node` as `id`'s last child; `id` opens so the new row is visible. */
export function insertChild(items: Tree, id: string, node: BookmarkNode) {
  return update(items, id, (n) => ({
    ...n,
    open: true,
    children: [...n.children, node],
  }));
}

/** The moves the panel offers for `id`, each `false` where it cannot go. */
export function movesFor(items: Tree, id: string) {
  const at = pathOf(items, id);
  if (!at) {
    return { up: false, down: false, indent: false, outdent: false };
  }
  const index = at.at(-1)!;
  const parent = at.slice(0, -1);
  let siblings = items;
  for (const i of parent) siblings = siblings[i]!.children;
  return movesAt(siblings[index]!, at.length, index, siblings.length);
}

/**
 * What `node` can do from where it is: level `depth` (1 at the top), the
 * `index`th of `siblings`. Everything a move depends on is local, so a row
 * can ask without the whole tree.
 */
export function movesAt(
  node: BookmarkNode,
  depth: number,
  index: number,
  siblings: number,
) {
  // Indenting puts `node` (and what is below it) one level deeper.
  const deepest = depth + 1 + depthOf(node.children);
  return {
    up: index > 0,
    down: index < siblings - 1,
    indent: index > 0 && deepest <= BOOKMARK_DEPTH_MAX,
    outdent: depth > 1,
  };
}

/** The ids a reader sees, in order: nothing inside a closed bookmark. */
export function visibleIds(items: Tree): string[] {
  const out: string[] = [];
  const walk = (list: Tree) => {
    for (const n of list) {
      out.push(n.id);
      if (n.open) walk(n.children);
    }
  };
  walk(items);
  return out;
}

/** Swap `id` with the sibling before (`-1`) or after (`+1`) it. */
export function move(items: Tree, id: string, by: -1 | 1): Tree {
  const at = pathOf(items, id);
  if (!at) return items;
  const index = at.at(-1)!;
  return editList(items, at.slice(0, -1), (list) => {
    const other = index + by;
    if (other < 0 || other >= list.length) return list;
    [list[index], list[other]] = [list[other]!, list[index]!];
    return list;
  });
}

/**
 * `id` becomes the last child of the sibling before it, which opens so the
 * row stays in view.
 */
export function indent(items: Tree, id: string): Tree {
  if (!movesFor(items, id).indent) return items;
  const at = pathOf(items, id)!;
  const index = at.at(-1)!;
  return editList(items, at.slice(0, -1), (list) => {
    const node = list[index]!;
    const prev = list[index - 1]!;
    list.splice(index - 1, 2, {
      ...prev,
      open: true,
      children: [...prev.children, node],
    });
    return list;
  });
}

/** `id` leaves its parent and follows it, one level up. */
export function outdent(items: Tree, id: string): Tree {
  const at = pathOf(items, id);
  if (!at || at.length < 2) return items;
  const node = find(items, id)!;
  const parentPath = at.slice(0, -1);
  const without = remove(items, id);
  return editList(without, parentPath.slice(0, -1), (list) => {
    list.splice(parentPath.at(-1)! + 1, 0, node);
    return list;
  });
}

/**
 * One top-level bookmark per `every` pages — "Page 1", "Page 6", … — each
 * opening its page. `nextId` names each new node.
 */
export function pageBookmarks(
  pageCount: number,
  every: number,
  nextId: () => string,
): BookmarkNode[] {
  const step = Math.max(1, Math.floor(every));
  const out: BookmarkNode[] = [];
  for (let page = 1; page <= pageCount; page += step) {
    out.push({
      id: nextId(),
      title: `Page ${page}`,
      target: { kind: "page", page },
      open: false,
      children: [],
    });
  }
  return out;
}

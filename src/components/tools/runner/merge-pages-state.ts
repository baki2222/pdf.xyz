/**
 * Merge PDF's Arrange pages, as data (audit backlog #9, 2026-11-17). Pure: no
 * React, no DOM, no pdf-lib.
 *
 * ONE ordered list holds every page of every file, left-out pages included
 * (they keep their slot). The merged PDF is the kept pages, in list order.
 * Everything else the runner shows in page mode is DERIVED from that list,
 * never stored beside it: each file's Pages box (`rangeTextOf`), the file
 * order (`fileOrderOf`, by each file's first kept page), the page total, and
 * whether files interleave (`filesInterleave`). So the typed boxes and the
 * grid cannot drift: both are functions of the one list
 * (`merge-pages-state.test.ts` walks every page set of a 7-page file).
 *
 * Loaded with the grid, when Arrange pages is chosen, not with the page.
 */
import type { Rotation } from "@/lib/pdf/types";
import { interleavePages } from "@/lib/pdf/merge-order";
import { normalizeAngle } from "@/lib/pdf/rotation";
import { reorder } from "./list-utils";
import { pageListText } from "./page-picker-text";

export interface MergePage {
  /** `${fileId}:${pageIndex}`, stable across moves. */
  readonly key: string;
  readonly fileId: string;
  /** 0-based page in its file. */
  readonly pageIndex: number;
  /** The file's own viewer rotation for this page. */
  readonly source: Rotation;
  /** Absolute: what the merged page shows. Starts at `source`. */
  readonly rotation: Rotation;
  /** False = left out; it keeps its slot in the list. */
  readonly kept: boolean;
}

/** What the list needs of a file: its id and each page's own rotation. */
export interface PageFile {
  readonly id: string;
  readonly rotations: readonly Rotation[];
}

/** A file's Pages selection: 0-based pages, or `undefined` for every page. */
export type PageSelection = readonly number[] | undefined;

/** The file-level modes page mode can start from. */
export type SeedMode = "append" | "alternate";

function pagesOf(file: PageFile, selection: PageSelection): MergePage[] {
  const kept = selection ? new Set(selection) : null;
  return file.rotations.map((source, pageIndex) => ({
    key: `${file.id}:${pageIndex}`,
    fileId: file.id,
    pageIndex,
    source,
    rotation: source,
    kept: kept ? kept.has(pageIndex) : true,
  }));
}

/**
 * Page mode's first list: exactly what `mode` would merge, in its order,
 * with every left-out page after it, file by file. Untouched, it merges the
 * same pages in the same order as the mode it came from.
 */
export function seedPages(
  files: readonly PageFile[],
  mode: SeedMode,
  selections: readonly PageSelection[] = [],
  reverse: readonly boolean[] = [],
): MergePage[] {
  const all = files.map((file, i) => pagesOf(file, selections[i]));
  if (mode === "append") return all.flat();
  // As `mergeAlternating` takes them: each file's selection in page order,
  // turned round where Reverse is ticked, then one from each file in turn.
  const runs = all.map((pages, i) => {
    const kept = pages.filter((p) => p.kept);
    return reverse[i] ? kept.reverse() : kept;
  });
  return [...interleavePages(runs), ...all.flat().filter((p) => !p.kept)];
}

/** The kept pages, in merged order. */
export function keptPages(pages: readonly MergePage[]): MergePage[] {
  return pages.filter((p) => p.kept);
}

/** The 0-based pages of `fileId` that go in, in page-number order. */
export function keptSetOf(
  pages: readonly MergePage[],
  fileId: string,
): number[] {
  return pages
    .filter((p) => p.fileId === fileId && p.kept)
    .map((p) => p.pageIndex)
    .sort((a, b) => a - b);
}

/**
 * The file's Pages box, derived: `""` when every page goes in (the box then
 * shows its "All (1-N)" placeholder, as in file mode), else the kept set in
 * page-number order, e.g. `1, 3-4`. It never says the ORDER.
 */
export function rangeTextOf(
  pages: readonly MergePage[],
  fileId: string,
): string {
  const own = pages.filter((p) => p.fileId === fileId);
  const kept = own.filter((p) => p.kept);
  if (kept.length === own.length) return "";
  return pageListText(kept.map((p) => p.pageIndex));
}

/**
 * What typing in a file's Pages box does: flip `kept` IN PLACE. A page typed
 * back in returns to the slot it was left out at; a page typed away stays in
 * its slot, dimmed. Order and rotation never change. `undefined` (an empty
 * box) keeps every page; a set that keeps none is refused unchanged (empty
 * text parses as all, so typing cannot reach it).
 */
export function setFileKept(
  pages: readonly MergePage[],
  fileId: string,
  selection: PageSelection,
): MergePage[] {
  const set = selection ? new Set(selection) : null;
  if (set && !pages.some((p) => p.fileId === fileId && set.has(p.pageIndex)))
    return pages.slice();
  return pages.map((p) =>
    p.fileId !== fileId ? p : { ...p, kept: set ? set.has(p.pageIndex) : true },
  );
}

/** File ids in the order their first KEPT pages appear. */
export function fileOrderOf(pages: readonly MergePage[]): string[] {
  const order: string[] = [];
  for (const p of pages)
    if (p.kept && !order.includes(p.fileId)) order.push(p.fileId);
  return order;
}

/** True when some file's kept pages are not one unbroken run. */
export function filesInterleave(pages: readonly MergePage[]): boolean {
  const closed = new Set<string>();
  let previous: string | null = null;
  for (const p of pages) {
    if (!p.kept || p.fileId === previous) continue;
    if (closed.has(p.fileId)) return true;
    if (previous !== null) closed.add(previous);
    previous = p.fileId;
  }
  return false;
}

/**
 * True while the kept arrangement goes beyond what file mode can say: a page
 * turned from its own rotation, files interleaved, or a file's pages out of
 * page-number order.
 */
export function arrangementBeyondFiles(pages: readonly MergePage[]): boolean {
  if (pages.some((p) => p.rotation !== p.source)) return true;
  if (filesInterleave(pages)) return true;
  const last = new Map<string, number>();
  for (const p of keptPages(pages)) {
    const before = last.get(p.fileId);
    if (before !== undefined && p.pageIndex < before) return true;
    last.set(p.fileId, p.pageIndex);
  }
  return false;
}

/**
 * Bring the list in line with the file list: a removed file's pages go, a
 * new file's pages are appended at the end, file by file, kept and upright
 * as their source. Everything else keeps its slot, rotation and flag.
 */
export function syncFiles(
  pages: readonly MergePage[],
  files: readonly PageFile[],
): MergePage[] {
  const ids = new Set(files.map((f) => f.id));
  const present = new Set(pages.map((p) => p.fileId));
  return [
    ...pages.filter((p) => ids.has(p.fileId)),
    ...files
      .filter((f) => !present.has(f.id))
      .flatMap((f) => pagesOf(f, undefined)),
  ];
}

/** Each file's kept set follows its Pages selection; nothing moves. */
export function applyRanges(
  pages: readonly MergePage[],
  files: readonly PageFile[],
  selections: readonly PageSelection[],
): MergePage[] {
  return files.reduce<MergePage[]>(
    (list, file, i) => setFileKept(list, file.id, selections[i]),
    pages.slice(),
  );
}

/** Move the page `key` to `index` in the full list (left-out slots count). */
export function moveKeyTo(
  pages: readonly MergePage[],
  key: string,
  index: number,
): MergePage[] {
  const from = pages.findIndex((p) => p.key === key);
  if (from < 0) return pages.slice();
  return reorder(pages, from, index);
}

/** Move the page `key` by `delta` slots, addressed by key, not index. */
export function moveKeyBy(
  pages: readonly MergePage[],
  key: string,
  delta: number,
): MergePage[] {
  const from = pages.findIndex((p) => p.key === key);
  if (from < 0) return pages.slice();
  return reorder(pages, from, from + delta);
}

/** Turn the page `key` by a quarter-turn delta (90 or -90). */
export function rotateKey(
  pages: readonly MergePage[],
  key: string,
  delta: number,
): MergePage[] {
  return pages.map((p) =>
    p.key === key ? { ...p, rotation: normalizeAngle(p.rotation + delta) } : p,
  );
}

/** A file keeps at least one page: false for its last kept page. */
export function canLeaveOut(pages: readonly MergePage[], key: string): boolean {
  const page = pages.find((p) => p.key === key);
  if (!page?.kept) return false;
  return pages.some((p) => p.fileId === page.fileId && p.kept && p.key !== key);
}

/** Leave out or put back the page `key`; a file's last kept page stays. */
export function setKeptKey(
  pages: readonly MergePage[],
  key: string,
  kept: boolean,
): MergePage[] {
  if (!kept && !canLeaveOut(pages, key)) return pages.slice();
  return pages.map((p) => (p.key === key ? { ...p, kept } : p));
}

/**
 * Each file's pages together again, files in `fileIds` order, each keeping
 * its pages' relative order, rotations and flags (Sort in page mode).
 */
export function regroup(
  pages: readonly MergePage[],
  fileIds: readonly string[],
): MergePage[] {
  const listed = new Set(fileIds);
  return [
    ...fileIds.flatMap((id) => pages.filter((p) => p.fileId === id)),
    ...pages.filter((p) => !listed.has(p.fileId)),
  ];
}

/** True when two lists hold the same pages in the same state and order. */
export function samePages(
  a: readonly MergePage[],
  b: readonly MergePage[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (p, i) =>
        p.key === b[i]!.key &&
        p.kept === b[i]!.kept &&
        p.rotation === b[i]!.rotation,
    )
  );
}

/**
 * The engine's arguments for the list: the file ids to pass as `files` (in
 * the order their first pages appear, as `mergePdfs` requires) and the
 * `order`, a rotation only where a page was turned from its own.
 */
export function mergePayload(pages: readonly MergePage[]): {
  fileIds: string[];
  order: { file: number; page: number; rotation?: Rotation }[];
} {
  const fileIds = fileOrderOf(pages);
  const index = new Map(fileIds.map((id, i) => [id, i]));
  return {
    fileIds,
    order: keptPages(pages).map((p) => ({
      file: index.get(p.fileId)!,
      page: p.pageIndex,
      ...(p.rotation !== p.source ? { rotation: p.rotation } : {}),
    })),
  };
}

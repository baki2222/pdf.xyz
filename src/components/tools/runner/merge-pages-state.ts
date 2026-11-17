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
import { interleavePages, MERGE_MODE_LABEL } from "@/lib/pdf/merge-order";
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

/**
 * True when a list kept aside is one to come back to: it says something file
 * mode cannot (`arrangementBeyondFiles`). The runner shows its "kept" note on
 * this same predicate, so the note and the grid that comes back agree.
 */
export function resumesStash(
  stash: readonly MergePage[] | null,
): stash is readonly MergePage[] {
  return stash !== null && arrangementBeyondFiles(stash);
}

/**
 * Arrange pages chosen again after a file-level mode (review of 2026-11-17).
 * The list kept aside is used only while `resumesStash`: then the Pages boxes
 * apply, and so does the file order chosen meanwhile, unless files
 * interleave (an order of files cannot say where mixed pages go; the runner
 * says so on screen). Otherwise the list is seeded afresh from the mode
 * being left, exactly as on a first visit, so the untouched grid merges what
 * that mode merged. `seed` is that fresh list, or null when the stash was
 * resumed: what `stashOnLeave` compares against.
 */
export function enterPages(
  stash: readonly MergePage[] | null,
  files: readonly PageFile[],
  mode: SeedMode,
  selections: readonly PageSelection[],
  reverse: readonly boolean[],
): { pages: MergePage[]; seed: MergePage[] | null } {
  if (resumesStash(stash)) {
    const list = applyRanges(syncFiles(stash, files), files, selections);
    return {
      pages: filesInterleave(list)
        ? list
        : regroup(
            list,
            files.map((f) => f.id),
          ),
      seed: null,
    };
  }
  const pages = seedPages(files, mode, selections, reverse);
  return { pages, seed: pages };
}

/**
 * Leaving page mode: what to keep aside for the next visit. Kept only when
 * the user CHANGED something since the grid was seeded (re-review of
 * 2026-11-17). The property is the change, not the list's shape: an
 * Alternate seed interleaves files without anyone having arranged anything,
 * and keeping it made One after another come back in Alternate order under a
 * "kept" note. A resumed stash (`seed` null) is the user's own, so it stays.
 */
export function stashOnLeave(
  pages: readonly MergePage[],
  seed: readonly MergePage[] | null,
): MergePage[] | null {
  return seed !== null && samePages(pages, seed) ? null : pages.slice();
}

/**
 * "Reset to file order": the list as One after another would seed it, the
 * files in the order their first kept pages appear, each keeping its chosen
 * pages.
 */
export function fileSeedOf(
  pages: readonly MergePage[],
  files: readonly PageFile[],
): MergePage[] {
  const order = fileOrderOf(pages);
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  const sorted = [...files].sort((a, b) => rank(a.id) - rank(b.id));
  return seedPages(
    sorted,
    "append",
    sorted.map((file) => {
      const kept = keptSetOf(pages, file.id);
      return kept.length === file.rotations.length ? undefined : kept;
    }),
  );
}

/**
 * Why the options that need one first page per file are greyed out. Shown
 * only while files mix, which only page mode can do, so it loads with it
 * (review of 2026-11-17: a plain merge does not pay for page mode's words).
 */
export const MIXED_NOTE =
  "Your files' pages are mixed, so these options are off: a bookmark for each file, a contents page and blank pages after odd files. Keep each file's pages together to use them. Bookmarks already in your files are kept.";

/**
 * The runner's page-mode sentences. Each is shown only once page mode has
 * been chosen (the kept note only while a stash waits, which only page mode
 * leaves), so they load with it and a plain merge's first load does not
 * carry them (re-review of 2026-11-17).
 */
export const PAGE_MODE_COPY = {
  sortHint: "Sorting puts each file's pages back together.",
  intro:
    "Every page of every file in one grid. Drag a page anywhere, turn it, or leave it out. The merged PDF follows the grid, left to right, top to bottom.",
  kept: `Your page arrangement is kept. Choose ${MERGE_MODE_LABEL.pages} again to use it.`,
  keptMixed:
    " Its pages mix files, so the file order chosen here does not change it.",
  aside:
    "Use the Pages box to choose a file's pages; drag in the grid to set their order.",
  listLabel: "PDFs to merge, in the order their first pages appear",
  runBar: "Pages are combined in the order of the grid above.",
} as const;

/**
 * Leaving page mode: file mode says what it can of the arrangement, the
 * file order (by first kept page) and each file's pages, a Pages box still
 * being typed winning over the list's own text. Order inside a file, mixing
 * and turns wait in the stash for the next visit.
 */
export function fileModeItems<T extends { id: string; range: string }>(
  pages: readonly MergePage[],
  items: readonly T[],
  drafts: Readonly<Record<string, string>>,
): T[] {
  const order = fileOrderOf(pages);
  const at = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  return [...items]
    .sort((a, b) => at(a.id) - at(b.id))
    .map((item) => ({
      ...item,
      range: drafts[item.id] ?? rangeTextOf(pages, item.id),
    }));
}

/** What one Sort or Reset threw away, while it is undoable. */
export interface PagesUndo {
  readonly before: MergePage[];
  readonly after: MergePage[];
}

/**
 * One whole-list step in page mode (a Sort, Reset to file order, Undo): the
 * new list, the Undo it leaves, and what to announce. Built here, with page
 * mode, so a plain merge's first load does not carry its words or its logic
 * (re-review of 2026-11-17).
 */
export interface PagesStep {
  readonly pages: MergePage[];
  readonly undo: PagesUndo | null;
  readonly say: string;
}

const UNDO_OFFER = " Undo brings your order back.";

function replaceStep(
  pages: MergePage[],
  next: MergePage[],
  say: string,
): PagesStep {
  const lost = losesMixedOrder(pages, next);
  return {
    pages: next,
    undo: lost ? { before: pages, after: next } : null,
    say: lost ? say + UNDO_OFFER : say,
  };
}

/** A new file order in page mode: each file's pages together again. */
export function regroupStep(
  pages: MergePage[],
  fileIds: readonly string[],
): PagesStep {
  return replaceStep(
    pages,
    regroup(pages, fileIds),
    " Each file's pages are together again.",
  );
}

/** "Reset to file order" (`seed` is `fileSeedOf` the list). */
export function resetStep(pages: MergePage[], seed: MergePage[]): PagesStep {
  return replaceStep(pages, seed, "Reset to file order.");
}

/** Undo: the list as it was before the Sort or Reset. */
export function undoStep(undo: PagesUndo): PagesStep {
  return { pages: undo.before, undo: null, say: "Your page order is back." };
}

/** A Sort or Reset that throws away an order mixing files: Undo is offered. */
export function losesMixedOrder(
  pages: readonly MergePage[],
  next: readonly MergePage[],
): boolean {
  return filesInterleave(pages) && !samePages(pages, next);
}

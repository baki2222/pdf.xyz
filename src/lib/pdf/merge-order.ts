/**
 * Merge PDF's sort orders, as one pure function over the list the runner
 * holds. A leaf: no pdf-lib, no DOM.
 */

export const MERGE_SORTS = ["name-asc", "name-desc", "added"] as const;
export type MergeSort = (typeof MERGE_SORTS)[number];

export const MERGE_SORT_LABEL: Record<MergeSort, string> = {
  "name-asc": "Name A–Z",
  "name-desc": "Name Z–A",
  added: "As added",
};

/**
 * Names compare the way a file manager lists them: case-insensitive, and
 * numbers by value, so file2.pdf comes before file10.pdf.
 */
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/** A new array in `sort` order; ties keep the order the files were added. */
export function sortMergeItems<T extends { name: string; seq: number }>(
  items: readonly T[],
  sort: MergeSort,
): T[] {
  const bySeq = (a: T, b: T) => a.seq - b.seq;
  if (sort === "added") return [...items].sort(bySeq);
  const sign = sort === "name-asc" ? 1 : -1;
  return [...items].sort(
    (a, b) => sign * collator.compare(a.name, b.name) || bySeq(a, b),
  );
}

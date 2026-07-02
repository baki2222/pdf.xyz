/**
 * Pure page-selection helpers shared by the select/rotate runners. Selections
 * are immutable `Set<number>` of 0-based page indices; every helper returns a
 * new set (or a plain index list) so callers can drop them straight into React
 * state. No DOM, no pdf-lib — trivially unit-testable.
 */

/** Toggle a single index in/out of the selection. */
export function toggleIndex(
  selected: ReadonlySet<number>,
  index: number,
): Set<number> {
  const next = new Set(selected);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

/** The full selection [0, count). */
export function allIndices(count: number): Set<number> {
  const next = new Set<number>();
  for (let i = 0; i < Math.max(0, count); i++) next.add(i);
  return next;
}

/** Every page that is *not* currently selected, within [0, count). */
export function invertSelection(
  selected: ReadonlySet<number>,
  count: number,
): Set<number> {
  const next = new Set<number>();
  for (let i = 0; i < Math.max(0, count); i++) {
    if (!selected.has(i)) next.add(i);
  }
  return next;
}

/** Inclusive integer range between two indices, in ascending order. */
export function rangeInclusive(a: number, b: number): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

/**
 * Add the inclusive range between `anchor` and `index` to the selection,
 * clamped to [0, count). Powers shift-click / shift-space range selection.
 */
export function selectRange(
  selected: ReadonlySet<number>,
  anchor: number,
  index: number,
  count: number,
): Set<number> {
  const next = new Set(selected);
  for (const i of rangeInclusive(anchor, index)) {
    if (i >= 0 && i < count) next.add(i);
  }
  return next;
}

/** Is every page in [0, count) selected? (Empty documents count as false.) */
export function isAllSelected(
  selected: ReadonlySet<number>,
  count: number,
): boolean {
  return count > 0 && selected.size >= count;
}

/**
 * Pure list helpers shared across runners (and their state models). No React,
 * no DOM — kept separate from the client `runner-kit` so pure modules and unit
 * tests can use them without pulling in the component layer.
 */

/** Immutably move an item from one index to another, clamping the target. */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice();
  if (from < 0 || from >= next.length) return next;
  const clampedTo = Math.max(0, Math.min(to, next.length - 1));
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return list.slice();
  next.splice(clampedTo, 0, moved);
  return next;
}

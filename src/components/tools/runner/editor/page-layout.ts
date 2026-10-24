/**
 * Where each page sits in the scrolling column, computed — not measured — so
 * the column has its final height from the first frame (nothing below it
 * moves as pages render) and so virtualisation is a range query.
 */

export const PAGE_GAP = 16;
export const COLUMN_PAD = 16;

export interface PageSlot {
  index: number;
  top: number;
  width: number;
  height: number;
}

export function layoutPages(
  sizes: readonly { width: number; height: number }[],
  scale: number,
): { slots: PageSlot[]; height: number; width: number } {
  let top = COLUMN_PAD;
  let width = 0;
  const slots = sizes.map((size, index) => {
    const slot = {
      index,
      top,
      width: size.width * scale,
      height: size.height * scale,
    };
    top += slot.height + PAGE_GAP;
    width = Math.max(width, slot.width);
    return slot;
  });
  return {
    slots,
    height: top - PAGE_GAP + COLUMN_PAD,
    width: width + COLUMN_PAD * 2,
  };
}

/** Pages within `margin` px of the visible band — the ones worth rendering. */
export function pagesNear(
  slots: readonly PageSlot[],
  scrollTop: number,
  viewHeight: number,
  margin: number,
): number[] {
  const lo = scrollTop - margin;
  const hi = scrollTop + viewHeight + margin;
  return slots
    .filter((s) => s.top + s.height >= lo && s.top <= hi)
    .map((s) => s.index);
}

/** The page under the upper third of the view — the "current" page. */
export function currentPage(
  slots: readonly PageSlot[],
  scrollTop: number,
  viewHeight: number,
): number {
  const probe = scrollTop + viewHeight / 3;
  let current = 0;
  for (const s of slots) {
    if (s.top <= probe) current = s.index;
    else break;
  }
  return current;
}

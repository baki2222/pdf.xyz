/**
 * Which pages of a file a stamp goes on, and the number each one shows — pure
 * arithmetic, shared by Add Page Numbers and Header & Footer (engines,
 * previews and summaries), so no two of them can disagree about what Start on
 * page, First number, a blank cover or skipped last pages mean. Kept in its
 * own module so neither tool's chunk carries the other's engine.
 */

export interface PagePlanOptions {
  /** 1-based physical page stamping begins on (skips earlier pages). Default 1. */
  startPage?: number;
  /** The number the first counted page shows. Defaults to 1. */
  startAt?: number;
  /**
   * Leave the first page of the file unstamped while still counting it, so
   * page 2 shows the number after First number. Default false.
   */
  skipCover?: boolean;
  /**
   * Leave this many pages at the end unstamped. They are not counted, so
   * {total} is still the last number printed. Default 0.
   */
  skipLast?: number;
}

export interface NumberingPlan {
  /** Pages that get a stamp: 0-based index and the number it shows. */
  stamps: { index: number; n: number }[];
  /** The last number printed — what {total} becomes. */
  total: number;
}

/**
 * Counted pages run from Start on page to the last page before the skipped
 * tail; the cover (page 1 of the file) is counted but not stamped when
 * `skipCover` is set.
 */
export function numberingPlan(
  pageCount: number,
  options: PagePlanOptions = {},
): NumberingPlan {
  const startPage = Math.max(1, Math.floor(options.startPage ?? 1) || 1);
  const startAt = Math.floor(options.startAt ?? 1);
  const tail = Math.floor(options.skipLast ?? 0);
  const skipLast = Number.isNaN(tail)
    ? 0
    : Math.min(pageCount, Math.max(0, tail));
  const lastPage = pageCount - skipLast;
  const counted = Math.max(0, lastPage - (startPage - 1));
  const total = startAt + counted - 1;
  const stamps: { index: number; n: number }[] = [];
  for (let index = startPage - 1; index < lastPage; index += 1) {
    if (options.skipCover && index === 0) continue;
    stamps.push({ index, n: startAt + (index - (startPage - 1)) });
  }
  return { stamps, total };
}

/**
 * Smart defaults (redesign E.9): a choice the tool makes for the reader
 * because the files make the right one plain — each said with its reason
 * beside it, and each undone in one press.
 *
 *  - NATURAL ORDER. Files named "scan 1", "scan 10", "scan 2" are a sequence
 *    a file manager sorted as text; they are put in the order of their
 *    numbers — but only when EVERY name is the same stem with a number
 *    (case aside), and the drop order differs. A batch with mixed stems is a
 *    choice the reader made, and is left exactly as dropped.
 *  - RESOLUTION. A PDF longer than {@link LARGE_RASTER_PAGES} pages renders
 *    at Screen resolution: every page becomes an image in memory, and a long
 *    document at print resolution is the run most likely to exhaust a tab.
 *
 * Copy lives here; every number a sentence prints is a field of its input.
 */

/** Pages past which pdf-to-image chooses Screen. */
export const LARGE_RASTER_PAGES = 60;

/** The resolution a long PDF opens at. */
const LONG_PDF_RESOLUTION = "screen";

export interface NaturalOrder {
  /** Indexes into the names given, in their new order. */
  readonly order: readonly number[];
  /** Each name's number, in the new order. */
  readonly numbers: readonly number[];
}

/** "scan 10.pdf" → stem "scan |", number 10; the LAST number decides. */
function split(name: string): { stem: string; n: number } | null {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const match = /^(.*?)(\d+)(\D*)$/.exec(base);
  if (!match) return null;
  const n = Number(match[2]);
  if (!Number.isSafeInteger(n)) return null;
  return { stem: `${match[1]}|${match[3]}`.toLowerCase(), n };
}

/**
 * The order of `names` by the numbers in them, or null when it is not one
 * sequence or is already in order.
 */
export function naturalOrder(names: readonly string[]): NaturalOrder | null {
  if (names.length < 2) return null;
  const parts = names.map(split);
  const stem = parts[0]?.stem;
  if (parts.some((p) => !p || p.stem !== stem)) return null;
  const order = names
    .map((_, i) => i)
    // Array.prototype.sort is stable: equal numbers keep the drop order.
    .sort((a, b) => parts[a]!.n - parts[b]!.n);
  if (order.every((at, i) => at === i)) return null;
  return { order, numbers: order.map((i) => parts[i]!.n) };
}

/** The note beside a natural order: what was done, and the evidence. */
export function orderNote(numbers: readonly number[]): string {
  const shown = numbers.slice(0, 3).join(", ");
  return `Ordered by the numbers in the file names (${shown}${numbers.length > 3 ? ", …" : ""})`;
}

/**
 * The resolution a PDF of `pages` opens at, with its reason — or null. The
 * picker passes what it offers, so this module loads no raster code.
 */
export function defaultResolution(
  pages: number,
  offered: readonly { readonly id: string; readonly label: string }[],
): { readonly id: string; readonly reason: string } | null {
  if (!(pages > LARGE_RASTER_PAGES)) return null;
  const choice = offered.find((r) => r.id === LONG_PDF_RESOLUTION);
  if (!choice) return null;
  return {
    id: choice.id,
    reason: `${choice.label} resolution — this PDF has ${pages} pages`,
  };
}

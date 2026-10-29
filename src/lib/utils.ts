import { clsx, type ClassValue } from "clsx";

let observer: ((classes: string) => void) | null = null;

/**
 * Join conditional class names. It does NOT resolve Tailwind conflicts:
 * `cn("px-2", wide && "px-4")` ships both, and the stylesheet's order picks
 * one. Write one class per family per branch — `cn(wide ? "px-4" : "px-2")`.
 *
 * WAS `twMerge(clsx(...))` until 2026-10-29. tailwind-merge is ~8.5 KB gz,
 * and `cn()` put it in every page's first load; over the whole prerendered
 * site it changed 43 of 35,735 class attributes, all from a handful of
 * override sites, now written without the override. What keeps a new one
 * out: src/lib/cn-conflicts.test.ts (every call in src, every branch),
 * the class check in ssr-content.test.ts (every prerendered page), and
 * {@link observeClassesForTests} (every call the component suite makes).
 */
export function cn(...inputs: ClassValue[]) {
  const classes = clsx(inputs);
  observer?.(classes);
  return classes;
}

/**
 * Sees every class list `cn()` returns — the component suite's conflict
 * check (src/tests/setup.ts). Never set outside tests.
 */
export function observeClassesForTests(
  fn: ((classes: string) => void) | null,
): void {
  observer = fn;
}

/** Format a number with thousands separators (locale-stable for SSR). */
export function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

/** Human-readable byte size, e.g. 1536 -> "1.5 KB". */
export function formatBytes(bytes: number, decimals = 1) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(decimals)} ${units[i]}`;
}

/**
 * A byte CHANGE, signed: 1536 -> "+1.5 KB", -1536 -> "1.5 KB" behind a U+2212
 * MINUS SIGN (escaped below so it cannot be mistaken for a hyphen), 0 -> "0 B".
 * `formatBytes` is unsigned, so wrapping it in `Math.abs` alone turns a file
 * that shrank into one that grew.
 */
export function formatSignedBytes(delta: number, decimals = 1) {
  const sign = delta > 0 ? "+" : delta < 0 ? "\u2212" : "";
  return `${sign}${formatBytes(Math.abs(delta), decimals)}`;
}

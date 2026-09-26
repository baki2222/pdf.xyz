import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names and resolve Tailwind conflicts.
 * Usage: cn("px-2", condition && "px-4") -> "px-4"
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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

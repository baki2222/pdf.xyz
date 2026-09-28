/**
 * A byte ceiling as a person reads it.
 *
 * Upload refusals used to print the raw constant: "A file exceeds the
 * 104857600-byte per-file upload limit." Nobody reads that as 100 MB, and a
 * deployment that sets its own limit would print its own unreadable number.
 * Every refusal formats the constant it is enforcing through here instead, so
 * the figure is still the one the code enforces, in the unit the page states.
 *
 * Exact multiples print as whole units ("100 MB", "64 KB"), which is what the
 * limits are today. Anything else keeps one decimal rather than rounding a
 * ceiling to a number it is not. Import-free, so the client-side intake and the
 * server validator can both use it.
 */
const UNITS: readonly (readonly [string, number])[] = [
  ["GB", 1024 ** 3],
  ["MB", 1024 ** 2],
  ["KB", 1024],
];

export function formatByteLimit(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 bytes";
  for (const [unit, size] of UNITS) {
    if (bytes >= size) {
      return bytes % size === 0
        ? `${bytes / size} ${unit}`
        : `${(bytes / size).toFixed(1)} ${unit}`;
    }
  }
  return `${bytes} bytes`;
}

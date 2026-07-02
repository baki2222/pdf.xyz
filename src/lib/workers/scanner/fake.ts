/**
 * An **injectable fake scanner** for tests and for a future real provider's own
 * unit tests. It returns whatever verdict a test programs — `clean`, `infected`,
 * `error`, or a per-input function — so the executor's scan gate can be exercised
 * across every path WITHOUT shipping a real scanner runner.
 *
 * It reports itself `active: true` by default (a scanner IS present in the test),
 * which is exactly why it lives behind an explicit injection seam and is never
 * wired by the shipped runtime: only the no-op provider is. Node-free.
 */

import {
  scanClean,
  type MalwareScanCapability,
  type MalwareScanInput,
  type MalwareScanner,
  type MalwareScanResult,
} from "./types";

/** A fixed result, or a function computing one from the input (to record/branch). */
export type FakeScanBehavior =
  | MalwareScanResult
  | ((input: MalwareScanInput) => MalwareScanResult | Promise<MalwareScanResult>);

/** Options for {@link fakeScanner}. */
export interface FakeScannerOptions {
  /** Override the reported capability (default: an active `fake` provider). */
  readonly capability?: Partial<MalwareScanCapability>;
}

/**
 * Build a fake scanner. With no arguments it reports every input `clean`. Pass a
 * fixed {@link MalwareScanResult} (use the `scanInfected()`/`scanError()` builders)
 * or a function to compute the verdict per call (handy for recording the inputs it
 * was handed, or alternating results across attempts).
 */
export function fakeScanner(
  behavior: FakeScanBehavior = scanClean(),
  options: FakeScannerOptions = {},
): MalwareScanner {
  const capability: MalwareScanCapability = {
    active: true,
    provider: "fake",
    detail: "A fake malware scanner for tests/injection only; not a real scanner.",
    ...options.capability,
  };
  return {
    async scan(input) {
      return typeof behavior === "function" ? behavior(input) : behavior;
    },
    capability() {
      return capability;
    },
  };
}

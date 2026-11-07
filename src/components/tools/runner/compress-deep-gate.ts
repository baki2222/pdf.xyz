/**
 * The deep step's gate and Quality chip titles, shared by the single-file
 * panel (`./compress-runner`) and the batch (`./compress-batch`, audit
 * compress-pdf#5). Its own module so the batch does not import the runner
 * that imports it.
 */
import { DEEP_MONO_MIN_DPI } from "@/lib/pdf/offered-kinds";
import type { WorkerStatus } from "@/lib/workers/status";

/**
 * A Quality chip's title: the resolution colour and gray images are taken to,
 * and the one black-and-white images keep. The worker never sends mono below
 * DEEP_MONO_MIN_DPI (native.ts); the dom test composes this with its argv.
 */
export function qualityChipTitle(dpi: number): string {
  return `Colour and gray images: ${dpi} DPI. Black-and-white images: ${Math.max(dpi, DEEP_MONO_MIN_DPI)} DPI.`;
}

/**
 * True when the UI may offer the secure-worker deep compression flow.
 *
 * Local-dev reports native compression directly in `compress.deep`. Production and
 * staging are different: the web process never runs the processor, so its
 * `/api/worker/status` compression facet remains web-vantage/disabled even when a
 * separate worker daemon is observed and drainable. In that case the job API is
 * still the honest source of truth: it will run on the worker or return a typed
 * failure. Gate on configured storage+queue+drainability so staging can actually
 * use the secure worker instead of trapping users on browser-only lossless repack.
 */
export function canRunDeepCompression(
  status: WorkerStatus | null | undefined,
): boolean {
  if (!status) return false;
  if (status.localDevOnly) return status.compress.deep;
  return Boolean(
    status.providers.storage.ready &&
    status.providers.queue.ready &&
    status.daemon.drainable,
  );
}

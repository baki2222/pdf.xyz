import { JOB_LIMITS } from "@/lib/jobs/types";
import { HTML_RENDER_DEFAULT_MAX_INPUT_BYTES } from "./html-render/native-config";
import { HTML_RENDER_TOOLS } from "./html-render/tools";
import { OFFICE_CONVERSION_DEFAULT_MAX_INPUT_BYTES } from "./office-conversion/native-config";
import { OFFICE_TO_PDF_TOOLS } from "./office-conversion/tools";

/**
 * The per-file ceiling of a WORKER tool: the tighter of the worker's global
 * upload cap and the input limit of the engine that runs the tool.
 *
 * Until 2026-09-27 every worker tool's page, FAQ and upload gate used the
 * global cap alone — `JOB_LIMITS.maxFileBytes`, 100 MB. That is the first gate
 * a file meets, not the tightest it must pass: LibreOffice refuses above
 * 50 MB and Chromium above 20 MB. A 60 MB workbook was given an upload slot,
 * uploaded in full, malware-scanned, and then failed with a message that named
 * no number, on a page that had promised 100.
 *
 * A LEAF by construction — its imports are the jobs constants and each
 * engine's own `native-config.ts` and `tools.ts`, none of which import
 * anything — so the upload API (`@/lib/jobs/validation`), the browser job
 * driver (`@/lib/workers/pdf-security-client`) and the tool page
 * (`@/lib/tools/file-ceilings`) can all read the same number without the
 * browser bundle pulling a worker engine or the tool catalogue in.
 *
 * Only engines that BIND are listed — those whose default is below the global
 * cap. Every other engine's is at or above it, and that is not taken on trust:
 * `src/lib/tools/worker-engine-ceilings.test.ts` walks every engine the worker
 * daemon wires (`resolveProcessorDeps`) and fails if any stated ceiling
 * exceeds the engine that runs it — so an engine added with a lower limit, or
 * a default lowered in place, turns it red until it is listed here.
 *
 * Keyed by the id of the processor that owns the tools; the same test checks
 * each key against the worker's real routing.
 */
export const WORKER_ENGINE_FILE_CEILINGS = {
  "office-conversion": {
    tools: OFFICE_TO_PDF_TOOLS,
    bytes: OFFICE_CONVERSION_DEFAULT_MAX_INPUT_BYTES,
  },
  "html-render": {
    tools: HTML_RENDER_TOOLS,
    bytes: HTML_RENDER_DEFAULT_MAX_INPUT_BYTES,
  },
} as const satisfies Record<
  string,
  { readonly tools: readonly string[]; readonly bytes: number }
>;

/** What a worker job for `slug` is refused above, in bytes. */
export function workerFileCeilingBytes(slug: string): number {
  let ceiling: number = JOB_LIMITS.maxFileBytes;
  for (const engine of Object.values(WORKER_ENGINE_FILE_CEILINGS)) {
    if ((engine.tools as readonly string[]).includes(slug)) {
      ceiling = Math.min(ceiling, engine.bytes);
    }
  }
  return ceiling;
}

const MIB = 1024 * 1024;

/**
 * A byte ceiling the way a person reads one: "50 MB" for the defaults, which
 * are whole mebibytes; otherwise one decimal rounded DOWN, so an operator's
 * lowered override is never described as more than it accepts; and plain
 * bytes below 1 MB, so a small limit never prints as "0 MB".
 */
export function describeByteCeiling(bytes: number): string {
  if (bytes < MIB) return `${bytes.toLocaleString("en-US")} bytes`;
  const mb = bytes / MIB;
  return Number.isInteger(mb)
    ? `${mb} MB`
    : `${(Math.floor(mb * 10) / 10).toFixed(1)} MB`;
}

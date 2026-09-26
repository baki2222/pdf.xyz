import {
  HTML_RENDER_MAX_INPUT_BYTES,
  HTML_RENDER_TOOLS,
} from "@/lib/workers/html-render/native-config";
import {
  OFFICE_MAX_INPUT_BYTES,
  OFFICE_TO_PDF_TOOLS,
} from "@/lib/workers/office-conversion/native-config";

/**
 * Worker engines that refuse a file SMALLER than the upload gate lets through.
 *
 * Every worker-tier tool page used to state the upload gate's figure
 * (`JOB_LIMITS.maxFileBytes`, 100 MB). Two engines refuse well below it: the
 * Office converter at 50 MB and the HTML renderer at 20 MB. A 60 MB .docx
 * passed intake, uploaded in full, was scanned and queued, then failed with a
 * message that named no number, while the page and its FAQPage JSON-LD said
 * 100 MB.
 *
 * Each entry reads BOTH halves from the engine's own import-free config
 * module: the tools it serves and the default it enforces. There is no second
 * number to keep in step. Which engines belong here is not decided by this
 * list either: `file-ceilings.test.ts` resolves every worker native config and
 * fails if one with a default under the upload gate is missing.
 *
 * Import-free apart from those leaves, so the tool page (a client bundle) and
 * the upload validator (the server) can both read it.
 */
export const WORKER_ENGINE_CEILINGS: readonly {
  readonly engine: string;
  readonly tools: readonly string[];
  readonly bytes: number;
}[] = [
  {
    engine: "libreoffice",
    tools: OFFICE_TO_PDF_TOOLS,
    bytes: OFFICE_MAX_INPUT_BYTES,
  },
  {
    engine: "chromium",
    tools: HTML_RENDER_TOOLS,
    bytes: HTML_RENDER_MAX_INPUT_BYTES,
  },
];

/** The engine's own per-file ceiling for a worker tool, if it has one. */
export function workerEngineCeilingBytes(slug: string): number | undefined {
  return WORKER_ENGINE_CEILINGS.find((entry) => entry.tools.includes(slug))
    ?.bytes;
}

/**
 * Per-tool handoff capability: given a tool slug, decide whether staged files
 * can be handed off to its in-browser runner and in what shape. Pure, and
 * derived twice over: the MODE from the live-runner registry, the FILES from
 * the tool's catalogue `accept` row read through the one recogniser — and the
 * second is held to each runner's own check (`capability.test.ts`).
 *
 * Modes:
 *  - `collect`: the runner takes many files and combines them (merge).
 *  - `batch`  : the runner takes many files and processes each one (compress,
 *               and since batch plan P1 rotate, flatten, page numbers,
 *               watermark and split in half, through their settings batch;
 *               since P2 grayscale, PDF to JPG and PNG, extract images and
 *               text to PDF).
 *               Since batch plan P6 also every worker panel with a batch
 *               (`WORKER_BATCH_TOOLS`): the panel opens its batch list with
 *               the carried files, which wait there, staged as below, and
 *               go to our server one job each only when the reader presses
 *               the button under that list.
 *  - `single` : the runner works on exactly one file at a time (split,
 *               organize, extract/delete pages, PDF to text) — a handoff
 *               pre-loads the first eligible file.
 *  - `stage`  : a secure-worker or AI panel (every tool with no in-browser
 *               runner, which `tool-page-registry.test.ts` routes to a
 *               panel) that takes files and has no batch. It STAGES the
 *               first eligible file: the file waits in the panel, in this
 *               browser, and is uploaded only when the reader presses Run
 *               (WP-10).
 *  - `none`   : nothing to carry into — an unknown slug, or a tool that
 *               takes no file at all (webpage-to-pdf takes a URL).
 */

import { getRunnerKind, type RunnerKind } from "@/lib/pdf/registry";
import { getToolEntry } from "@/lib/tools/directory";
import type { WorkerBatchSlug } from "@/lib/batch/tools";
import {
  capabilityOfMode,
  filesTheToolOpens,
  type FileMetaLike,
  type HandoffCapability,
  type HandoffMode,
} from "./capability-core";

/*
 * The shape and the per-tool rules live in `./capability-core`, which a tool
 * page's first load uses with its OWN row, computed on the server; this
 * module adds the tables that answer for any slug. Re-exported so every
 * cross-tool caller keeps one import.
 */
export {
  takesOneFile,
  type HandoffCapability,
  type HandoffMode,
} from "./capability-core";

/** Runner kind → handoff mode. Every live runner maps to exactly one mode. */
const MODE_BY_KIND: Record<RunnerKind, HandoffMode> = {
  merge: "collect",
  compress: "batch",
  rotate: "batch",
  organize: "single",
  split: "single",
  "delete-pages": "single",
  "extract-pages": "single",
  "pdf-to-text": "single",
  "pdf-to-markdown": "single",
  "text-to-pdf": "batch",
  "markdown-to-pdf": "single",
  "image-to-pdf": "batch",
  "pdf-to-image": "batch",
  "page-numbers": "batch",
  watermark: "batch",
  "header-footer": "single",
  crop: "single",
  sign: "single",
  flatten: "batch",
  overlay: "single",
  grayscale: "batch",
  redact: "single",
  "fill-forms": "single",
  "create-forms": "single",
  annotate: "single",
  edit: "single",
  "extract-images": "batch",
  compare: "collect",
  scan: "batch",
  metadata: "single",
  resize: "single",
  "n-up": "single",
  "split-half": "batch",
  view: "single",
};

/** Resolve a tool slug to its handoff capability. */
export function handoffCapabilityFor(slug: string): HandoffCapability {
  const kind = getRunnerKind(slug);
  return capabilityOfMode(kind ? MODE_BY_KIND[kind] : stagedMode(slug));
}

/**
 * The worker panels that open a batch list for two or more files (batch plan
 * P3-P5): a hand-off to one carries every eligible file that fits one
 * hand-off (`handoffPayload` stops at `HANDOFF_MAX_TOTAL_BYTES`, as a staged
 * panel's one file did), and the batch caps them and lists the rest with the
 * reason (`capBatchFiles`), as a client batch does.
 *
 * Typed here rather than read from `WORKER_BATCH_TOOLS`, because this module
 * rides every tool page's first load and that registration (with the batch
 * limits behind it) does not: the type import is erased, so each entry is
 * held to a real worker batch at compile time for no bytes, and
 * `capability.test.ts` holds the set to the registration in both directions.
 * The type is free; the literal is not: ~78 B gz on every tool page's first
 * load (measured 2026-11-09, recorded beside the tool-page budget in
 * `bundle-budget.test.ts`) — UNTIL the same day, when this module left the
 * tool pages' first load (`./capability-core`; `lazy-chunks.test.ts` reads
 * every tool page for this list), so the literal now costs only the
 * surfaces that look up OTHER tools: the ticket, the workspace, a guide's
 * desk and a result's next steps.
 */
const WORKER_BATCHES: ReadonlySet<string> = new Set<WorkerBatchSlug>([
  "optimize-web",
  "repair-pdf",
  "pdf-to-pdfa",
  "word-to-pdf",
  "excel-to-pdf",
  "powerpoint-to-pdf",
  "epub-to-pdf",
  "pdf-to-word",
  "pdf-to-excel",
  "pdf-to-powerpoint",
  "protect-pdf",
  "unlock-pdf",
  "ocr-pdf",
]);

/**
 * A tool with no in-browser runner is a worker panel's; it stages a file
 * when its catalogue row takes files — every format but a lone `URL` — and
 * stages them all, as a batch, when the panel has one.
 */
function stagedMode(slug: string): HandoffMode {
  const accept = getToolEntry(slug)?.accept;
  if (!accept || accept.length === 0) return "none";
  if (accept.every((f) => f.toUpperCase() === "URL")) return "none";
  return WORKER_BATCHES.has(slug) ? "batch" : "stage";
}

/**
 * Filter a list of files to those a tool's runner can actually open: the
 * files whose format — read by `formatOf`, the one recogniser — is in the
 * tool's catalogue `accept` row.
 *
 * WAS a branch per slug (a regex for Text to PDF, another for Markdown, a MIME
 * list for the two image tools, `isLikelyPdf` for the rest): a second
 * statement of what `accept` already said, which nothing held to it. It
 * carried a `.docx` declared as a PDF to every PDF runner, and a `.md` typed
 * `text/plain` to Text to PDF. `capability.test.ts` now holds this to the row
 * for every runner-backed tool, and to each runner's OWN check — a carried
 * file must be one the runner opens.
 */
export function eligibleFilesFor<T extends FileMetaLike>(
  slug: string,
  files: T[],
): T[] {
  const accept = getToolEntry(slug)?.accept;
  if (!accept) return [];
  return filesTheToolOpens(accept, handoffCapabilityFor(slug), files);
}

import {
  workerPipelineStages,
  type PipelineStage,
  type PipelineTool,
} from "./capabilities";

/**
 * The "what happens to your file" stages for a status that may not be KNOWN
 * yet.
 *
 * Every worker panel passed `status?.scan.active ?? false`. Before the status
 * fetch resolves — which is every server render, so every page a crawler
 * reads, and every first paint — that `false` is not "unknown", it is a claim:
 * "Files are not scanned for malware here." Production scans every file. The
 * page said the opposite to anyone who did not wait for JavaScript.
 *
 * TWO BRANCHES FIXED THAT, and this module is what is left of one of them. The
 * wave-1 L03 branch wrote it with its own neutral "File checks" stage, found
 * by diffing the scanning and non-scanning lists. The integration branch had
 * meanwhile made `workerPipelineStages` itself tri-state (`null` = no
 * heartbeat observed) and per tool, with a "Safety checks" stage that names
 * the checks that hold either way and says the live worker reports the rest —
 * held to the code by `pipeline-honesty.test.ts`. That one was kept at the
 * merge (2026-09-28); the panels call `workerPipelineStages(status ?
 * status.scan.active : null, tool)` directly.
 *
 * What remains is the one thing this adds: it accepts `undefined`, so a
 * caller holding `status?.scan.active` cannot turn "unknown" into `false` on
 * the way in. No panel needs it today; it is kept as that adapter rather than
 * deleted here, and it is safe to delete once nothing imports it.
 */
export function pipelineStagesForStatus(
  malwareScanActive: boolean | null | undefined,
  tool: PipelineTool,
): readonly PipelineStage[] {
  return workerPipelineStages(malwareScanActive ?? null, tool);
}

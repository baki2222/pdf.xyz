import { workerPipelineStages, type PipelineStage } from "./capabilities";

/**
 * The "what happens to your file" stages for a status that may not be KNOWN
 * yet.
 *
 * `workerPipelineStages` takes a boolean, and every worker panel passed
 * `status?.scan.active ?? false`. Before the status fetch resolves — which is
 * every server render, so every page a crawler reads, and every first paint —
 * that `false` is not "unknown", it is a claim: "Files are not scanned for
 * malware here." Production scans every file. The page said the opposite to
 * anyone who did not wait for JavaScript.
 *
 * So `null`/`undefined` means "not known yet", and the stage that depends on
 * it becomes a neutral one that claims nothing either way. The stage is FOUND,
 * not named: it is whichever stage differs between the scanning and the
 * non-scanning list, so a stage added to either list later is handled without
 * this module being told.
 */
export const UNCONFIRMED_CHECKS_STAGE: PipelineStage = {
  id: "checks",
  title: "File checks",
  description: "Confirming which checks this deployment runs on each file…",
};

export function pipelineStagesForStatus(
  malwareScanActive: boolean | null | undefined,
): readonly PipelineStage[] {
  if (typeof malwareScanActive === "boolean")
    return workerPipelineStages(malwareScanActive);
  const scanning = workerPipelineStages(true);
  const notScanning = workerPipelineStages(false);
  return notScanning.map((stage, i) => {
    const other = scanning[i];
    return other &&
      other.id === stage.id &&
      other.title === stage.title &&
      other.description === stage.description
      ? stage
      : UNCONFIRMED_CHECKS_STAGE;
  });
}

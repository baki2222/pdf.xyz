import type { ToolInputKind } from "./types";

/**
 * File input or a single URL, decided from a catalog `accept` list alone. Only a
 * tool whose every accepted format is `URL` (webpage-to-pdf) takes an address
 * instead of uploads. One definition, read by `getToolInputKind`
 * (`./tool-capability`) and by `workerPipelineStages` (`./capabilities`), so
 * the job API and the page cannot disagree about which tools upload.
 *
 * Its own module, with nothing in it but the rule (2026-11-09): the pipeline
 * stages are in every worker tool page's first load and the slug lookup is
 * not, and each needs this.
 */
export function inputKindForAccept(accept: readonly string[]): ToolInputKind {
  const formats = accept.map((f) => f.toUpperCase());
  const onlyUrl = formats.length > 0 && formats.every((f) => f === "URL");
  return onlyUrl ? "url" : "file";
}

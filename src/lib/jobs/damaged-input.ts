/**
 * Which tools exist to ACCEPT a damaged PDF — defined once, read by every layer
 * that has to agree about it.
 *
 * repair-pdf's job is to take a truncated or broken file and recover it, so the
 * gates in front of it must not refuse the very damage it exists to fix. That fact
 * used to live in one place only — the qpdf structure engine's input floor — while
 * the tool page told every repair user that "malformed ones are rejected", and the
 * worker's soundness gate would refuse a truncated file for repair the moment an
 * operator switched on its opt-in `%%EOF` check. Three layers, one fact, three
 * independent spellings of it.
 *
 * Now the engine's input floor (`workers/pdf-structure/engine.ts`), the soundness
 * gate (`workers/soundness/check.ts`) and the pipeline copy
 * (`jobs/capabilities.ts#workerPipelineStages`) all ask this module.
 * `pipeline-honesty.test.ts` pins the relationship by RUNNING the engine and the
 * gate on a truncated PDF and comparing what they do with what the page says.
 *
 * A leaf on purpose: no imports, so the engine, the gate and the copy can all read
 * it without dragging each other along.
 */

const TOOLS_ACCEPTING_DAMAGED_PDF: ReadonlySet<string> = new Set([
  "repair-pdf",
]);

/** Does this tool exist to take a damaged PDF as its input? */
export function acceptsDamagedPdf(tool: string): boolean {
  return TOOLS_ACCEPTING_DAMAGED_PDF.has(tool);
}

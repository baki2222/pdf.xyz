/**
 * Production PDF→Office export deps.
 *
 * Text comes from the native `pdftotext` extractor (`@/lib/workers/pdf-text/
 * native`), injected only when the binary is genuinely present. They do NOT
 * use `@/lib/pdf/text`, whose pdfjs extractor loads the MAIN build: that one
 * constructs a `DOMMatrix` at import, so on the worker it threw before reading
 * a byte and every pdf-to-word/excel/powerpoint job failed with
 * `internal_error` while the processor still advertised itself as ready.
 *
 * PDF to PowerPoint also gets `scanPages` (`./page-scan`): pdfjs's LEGACY
 * build, which does run under Node, reading each page's pictures, positioned
 * text and drawing — and since 2026-10-17 PDF to Word reads its pictures
 * through the same reader. It is injected under the same presence-only rule — when
 * the legacy build and its canvas resolve here — and bounded by the same
 * timeout pdftotext runs under, and the output ceiling.
 *
 * And `repairPdf`: the worker's own Repair PDF engine — `runRepair` over the
 * native qpdf runner (`../pdf-structure`), not a second implementation — for
 * a PDF the page reader cannot read ahead. Present only where qpdf is; where
 * it is not, the engine refuses such a file instead of rebuilding it.
 */
import { resolveNativePdfTextConfig } from "@/lib/workers/pdf-text/native-config";
import {
  nativePdfOfficeExportDeps,
  type PdfTextSeams,
} from "@/lib/workers/pdf-text/native";
import { runRepair } from "@/lib/workers/pdf-structure/engine";
import {
  nativePdfStructureDeps,
  type QpdfStructureSeams,
} from "@/lib/workers/pdf-structure/native";
import type { PdfOfficeExportDeps } from "./engine";
import { scanPdfPages } from "./page-scan";
import { nodePdfjsAvailable } from "./pdfjs-node";

export function pdfOfficeExportDeps(
  env: Record<string, string | undefined> = process.env,
  seams: PdfTextSeams & {
    pdfjsAvailable?: () => boolean;
    /** qpdf's process and PATH probe, for the repair engine. */
    structure?: QpdfStructureSeams;
  } = {},
): PdfOfficeExportDeps {
  const base = nativePdfOfficeExportDeps(env, seams);
  const config = resolveNativePdfTextConfig(env);
  const available = (seams.pdfjsAvailable ?? (() => nodePdfjsAvailable()))();
  const structure = nativePdfStructureDeps(env, seams.structure);
  return {
    ...base,
    ...(available ? { scanPages: scanPdfPages } : {}),
    ...(structure.qpdf
      ? {
          repairPdf: async (bytes: Uint8Array) => {
            const run = await runRepair(bytes, structure);
            return run.ok ? run.output : null;
          },
        }
      : {}),
    limits: { ...base.limits, scanTimeoutMs: config.timeoutMs },
  };
}

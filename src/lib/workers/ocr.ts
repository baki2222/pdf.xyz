/**
 * OCR capability mapping for the worker layer.
 *
 * This is the OCR analogue of the compression capability in `./status.ts`: a
 * pure, dependency-injected function that turns the resolved {@link WorkerMode}
 * (plus, in the future, the OCR engines a worker advertises) into an honest,
 * client-safe statement of what OCR can do right now. It never reads a secret
 * and never claims a capability that isn't there.
 *
 * Honesty posture: **this build ships no OCR processing pipeline in any mode.**
 * OCR requires a native engine (OCRmyPDF/Tesseract) or a managed provider on a
 * secure worker, which the local-dev worker does not include. So the status
 * route deliberately passes no engines, and every environment reports OCR as
 * unavailable with a mode-specific reason. The `engines`-driven branch exists so
 * the capability flips on correctly — and is unit-testable — the moment a real
 * OCR processor is wired behind the adapter contract.
 */

import type { OcrLanguage } from "@/lib/jobs/ocr";
import { OCR_LANGUAGE_CODES } from "@/lib/jobs/ocr";
import type { WorkerMode } from "./mode";
import type { BinaryResolver } from "./compression/engine";

/** Native OCR engines a worker can use, in the order it prefers them. */
export const OCR_ENGINES = ["ocrmypdf", "tesseract"] as const;
export type OcrEngine = (typeof OCR_ENGINES)[number];

/** Which OCR engines are present on the host (presence only, never values). */
export type OcrEngineAvailability = Record<OcrEngine, boolean>;

/** Command names probed for each OCR engine. */
export const OCR_ENGINE_BINARIES: Record<OcrEngine, string> = {
  ocrmypdf: "ocrmypdf",
  tesseract: "tesseract",
};

/** Probe which OCR engines are installed, using an injected resolver. */
export function probeOcrEngines(resolve: BinaryResolver): OcrEngineAvailability {
  return {
    ocrmypdf: resolve(OCR_ENGINE_BINARIES.ocrmypdf),
    tesseract: resolve(OCR_ENGINE_BINARIES.tesseract),
  };
}

/** What the worker can do for the OCR tool in this environment, right now. */
export interface OcrCapability {
  /** True only when the worker can actually run OCR now. */
  available: boolean;
  /**
   * The OCR engine that would run the work (name only), or `null` when OCR is
   * unavailable. Presence only — never a path, version, or value.
   */
  engine: OcrEngine | null;
  /** Languages the processor can recognize when available; else empty. */
  languages: OcrLanguage[];
  /** One-line, client-safe explanation of the current OCR capability. */
  detail: string;
}

function unavailableDetail(mode: WorkerMode): string {
  switch (mode) {
    case "local-dev":
      return "The local-dev worker doesn't include an OCR processor. OCR needs a native engine (OCRmyPDF/Tesseract) on a secure worker, so it can't run here.";
    case "remote-configured":
      return "A worker backend is configured, but this build ships no OCR pipeline yet, so OCR is not available.";
    case "disabled":
    default:
      return "OCR needs a secure worker with a native OCR engine, which isn't enabled in this environment — nothing is uploaded and no text is produced here.";
  }
}

/**
 * Derive the client-facing OCR capability from the resolved mode and the OCR
 * engines a worker advertises. Never reads the environment or a secret; the
 * caller passes in exactly what was detected. With no engines (the state in
 * every environment this build runs in) OCR is reported unavailable, honestly.
 */
export function buildOcrCapability(
  mode: WorkerMode,
  engines?: OcrEngineAvailability,
): OcrCapability {
  const engine =
    mode === "disabled"
      ? null
      : (OCR_ENGINES.find((candidate) => engines?.[candidate]) ?? null);

  if (engine) {
    return {
      available: true,
      engine,
      languages: [...OCR_LANGUAGE_CODES],
      detail: `OCR runs on ${engine} on an encrypted, auto-deleting secure worker — inputs are wiped right after processing.`,
    };
  }

  return {
    available: false,
    engine: null,
    languages: [],
    detail: unavailableDetail(mode),
  };
}

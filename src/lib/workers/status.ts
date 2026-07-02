/**
 * The client-facing, presence-only view of the worker layer.
 *
 * The web app's UI can't read environment variables, so this is the honest seam
 * that tells the browser what the active worker can *actually* do right now —
 * without ever exposing a secret. It reports the resolved {@link WorkerMode} and,
 * for compression, whether the worker can run each profile in this environment.
 * `buildWorkerStatus` is pure and dependency-injected (it takes the probed native
 * tool availability), so every branch is unit-testable; the route
 * (`/api/worker/status`) is the only thing that performs the live PATH probe.
 */

import type { WorkerMode } from "./mode";
import {
  DEEP_COMPRESSION_TOOLS,
  type CompressionTool,
  type ToolAvailability,
} from "./compression/engine";
import { OCR_ENGINES, type OcrEngine, type OcrEngineAvailability } from "./ocr/engine";

/** What the worker can do for the Compress tool in this environment, right now. */
export interface CompressCapability {
  /** Worker can run a genuine lossless structural repack now. */
  lossless: boolean;
  /** Worker can run deep image compression now (a native engine is installed). */
  deep: boolean;
  /**
   * Native engines detected on the host, in preference order. Names only — this
   * reports the *presence* of a binary on PATH, never a path, version, or value.
   */
  engines: CompressionTool[];
}

/** What the worker can do for the OCR tool in this environment, right now. */
export interface OcrCapability {
  /** Can OCR a PDF into a searchable PDF / text sidecar (needs OCRmyPDF). */
  pdf: boolean;
  /** Can OCR an image (JPG/PNG) — OCRmyPDF or Tesseract satisfies this. */
  image: boolean;
  /** Installed OCR engines, names only, in preference order. */
  engines: OcrEngine[];
}

/** The honest, client-safe status of the worker layer. */
export interface WorkerStatus {
  mode: WorkerMode;
  /** True only when the worker can process at least one profile right now. */
  enabled: boolean;
  /** True when the active worker is the developer-only in-process one. */
  localDevOnly: boolean;
  /** One-line, client-safe explanation of the current capability. */
  detail: string;
  compress: CompressCapability;
  ocr: OcrCapability;
}

const NO_COMPRESS: CompressCapability = {
  lossless: false,
  deep: false,
  engines: [],
};

const NO_OCR: OcrCapability = {
  pdf: false,
  image: false,
  engines: [],
};

/** Derive the OCR capability from the probed engines (presence only). */
function ocrCapabilityFrom(engines?: OcrEngineAvailability): OcrCapability {
  const present = OCR_ENGINES.filter((engine) => engines?.[engine]);
  return {
    pdf: engines?.ocrmypdf ?? false,
    image: (engines?.ocrmypdf ?? false) || (engines?.tesseract ?? false),
    engines: present,
  };
}

/**
 * Derive the client-facing status from the resolved mode and (for local-dev)
 * the probed native tool availability. Never reads the environment or a secret;
 * callers pass in exactly what was detected.
 */
export function buildWorkerStatus(
  mode: WorkerMode,
  tools?: ToolAvailability,
  ocrEngines?: OcrEngineAvailability,
): WorkerStatus {
  if (mode === "local-dev") {
    const engines = DEEP_COMPRESSION_TOOLS.filter((tool) => tools?.[tool]);
    const deep = engines.length > 0;
    return {
      mode,
      enabled: true,
      localDevOnly: true,
      detail: deep
        ? `Local-dev worker enabled. Deep image compression runs on ${engines[0]}, on this machine — files are not sent to any third party.`
        : "Local-dev worker enabled, but no native engine (Ghostscript, qpdf, or mutool) is installed, so deep image compression can't run here. Install one to enable it.",
      compress: { lossless: true, deep, engines },
      ocr: ocrCapabilityFrom(ocrEngines),
    };
  }

  if (mode === "remote-configured") {
    return {
      mode,
      enabled: false,
      localDevOnly: false,
      detail:
        "A worker backend is configured, but this build ships no processing pipeline yet.",
      compress: { ...NO_COMPRESS },
      ocr: { ...NO_OCR },
    };
  }

  return {
    mode: "disabled",
    enabled: false,
    localDevOnly: false,
    detail:
      "No secure worker is configured in this environment. Deep image compression runs on an encrypted, auto-deleting worker when enabled.",
    compress: { ...NO_COMPRESS },
    ocr: { ...NO_OCR },
  };
}

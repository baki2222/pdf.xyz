/**
 * OCR capability mapping for the worker layer.
 *
 * This is the OCR analogue of the compression capability in `./status.ts`: a
 * pure, dependency-injected function that turns the resolved {@link WorkerMode}
 * (plus, in the future, the OCR engines a worker advertises) into an honest,
 * client-safe statement of what OCR can do right now. It never reads a secret
 * and never claims a capability that isn't there.
 *
 * Honesty posture: **OCR is a real, optional backend that runs OUT-OF-BAND on the
 * secure worker (Phase 23), never in-browser or in this web process.** A native
 * engine (OCRmyPDF/Tesseract) recognizes text on the isolated worker daemon when an
 * operator enables and installs it (`PDFXYZ_OCR`; see `@/lib/workers/ocr-native`).
 * The web app cannot run OCR itself and cannot observe the daemon's installed
 * engines, so this client-facing capability reports OCR as unavailable *in the
 * browser* with a mode-specific reason — it never claims a searchable PDF or text it
 * can't produce here. The `engines`-driven branch exists so the capability flips on
 * correctly — and is unit-testable — for any future in-app OCR surface, mirroring the
 * compression status probe.
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
      return "OCR runs on the out-of-band secure worker when its OCR backend is enabled and installed there. It isn't enabled in this environment, so OCR can't run here — nothing is uploaded and no text is produced.";
    case "disabled":
    default:
      return "OCR needs a secure worker with a native OCR engine, which isn't enabled in this environment — nothing is uploaded and no text is produced here.";
  }
}

/**
 * Derive the client-facing OCR capability from the resolved mode, the OCR engines a
 * worker advertises, and — when the caller can observe it — the recognition packs
 * actually installed there.
 *
 * Never reads the environment or a secret; the caller passes in exactly what was
 * detected. With no engines (the state in every environment this build runs in) OCR
 * is reported unavailable, honestly.
 *
 * `installedLanguages` is the honest signal. An engine binary being present says
 * nothing about which languages it can recognize: that needs a `traineddata` pack,
 * and Tesseract fails outright on a language it has no pack for. Reporting the
 * static allowlist regardless meant the status payload promised every advertised
 * language while the image shipped one, so a user could pick Spanish and be told
 * their file was the problem. When the caller supplies the observed packs, only the
 * intersection is reported — the languages that are BOTH offered by the product and
 * runnable here. Callers that cannot observe them (the web tier, which has no
 * worker filesystem) omit it and fall back to the advertised list, which is the
 * best it can honestly say from there.
 */
export function buildOcrCapability(
  mode: WorkerMode,
  engines?: OcrEngineAvailability,
  installedLanguages?: readonly string[],
  observedOnWorker?: boolean,
): OcrCapability {
  const engine =
    mode === "disabled"
      ? null
      : (OCR_ENGINES.find((candidate) => engines?.[candidate]) ?? null);

  // Nothing is installed in THIS process, but a live worker heartbeat reports OCR
  // enabled on the daemon that actually runs the jobs. That is the normal shape of
  // a production deployment: the engine is deliberately absent from the web tier,
  // so probing locally can only ever answer "no". Reporting unavailable on that
  // basis took a working tool dark — the OCR page showed "Not enabled" and offered
  // no uploader while real jobs succeeded through the queue.
  //
  // `engine` stays null because which engine the worker runs is genuinely not
  // observable from here, and naming one would be a guess.
  //
  // The languages, however, ARE observable now: the heartbeat carries the packs the
  // running image actually holds, so `installedLanguages` narrows the menu to what
  // will really run. It used to fall back to the advertised list unconditionally,
  // which meant the status endpoint promised every catalogued language while its own
  // detail string conceded the packs were unknowable — a user could pick one the
  // image had never installed and only discover it after uploading.
  if (!engine && observedOnWorker) {
    const observed = installedLanguages
      ? OCR_LANGUAGE_CODES.filter((code) => new Set(installedLanguages).has(code))
      : null;
    return {
      available: true,
      engine: null,
      languages: observed ?? [...OCR_LANGUAGE_CODES],
      detail: observed
        ? "OCR runs on the out-of-band secure worker, which reports it enabled in its liveness heartbeat — inputs are wiped right after processing. The languages listed are the recognition packs that worker actually has installed."
        : "OCR runs on the out-of-band secure worker, which reports it enabled in its liveness heartbeat — inputs are wiped right after processing. That worker is not reporting which language packs it holds, so this is the full catalogue; a language it lacks fails honestly instead of returning invented text.",
    };
  }

  if (engine) {
    const installed = installedLanguages ? new Set(installedLanguages) : null;
    const languages = installed
      ? OCR_LANGUAGE_CODES.filter((code) => installed.has(code))
      : [...OCR_LANGUAGE_CODES];
    return {
      available: true,
      engine,
      languages: [...languages],
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

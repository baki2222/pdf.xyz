/**
 * Server-side configuration for the **native OCR engine** — parsed from the
 * environment, validated for presence and shape only.
 *
 * This is the OCR analogue of `compression/native-config.ts`: a node-free leaf that
 * turns environment variables into a typed, bounded {@link NativeOcrConfig} the
 * Node-only runner (`ocr-native.ts`) consumes, and a presence-only
 * {@link NativeOcrCapability} the operator tooling can surface without ever exposing
 * a binary path, argument, or variable value.
 *
 * Security & honesty posture (the load-bearing rules of this module):
 *  - OCR shells out to a subprocess, so it is **opt-in**: with nothing declared the
 *    engine is *disabled* and OCR stays honestly not-implemented in every
 *    environment this build ships in. This is the key difference from native
 *    compression, whose deep path auto-detects — OCR is the *entire* capability, so
 *    it never turns itself on without an explicit operator opt-in.
 *  - A binary-path override is accepted only when it is a safe **absolute path** on
 *    a fixed allowlist of the two known engines (`ocrmypdf`/`tesseract`) — never an
 *    arbitrary command, never a value with shell metacharacters or `..` traversal.
 *    Auto-detection by fixed command name is the default.
 *  - Every bound (timeout, max input/output bytes) is clamped to a hard ceiling so a
 *    misconfigured deployment cannot ask the worker to run unbounded. OCR is slower
 *    and its outputs are larger than compression, so the ceilings are higher.
 *  - A parse failure names the offending **variable** (never its value); the
 *    resolver falls back to a safe *disabled* config, so a half-configured engine is
 *    honestly off rather than half-on. The client capability names only the engine
 *    *family* — never a path or argument.
 */

import type { FieldError } from "@/lib/jobs";
import { isSafeConfiguredPath } from "./compression/native-config";
import { OCR_ENGINES, OCR_ENGINE_BINARIES, type OcrEngine } from "./ocr";

type EnvSource = Record<string, string | undefined>;

/** The environment variables this engine reads (names only; never values). */
export const NATIVE_OCR_ENV = {
  /** Master opt-in switch. Unset ⇒ disabled (OCR stays not-implemented). */
  enable: "PDFXYZ_OCR",
  /** Pin OCR to one engine (`ocrmypdf`/`tesseract`); unset ⇒ auto-detect. */
  engine: "PDFXYZ_OCR_ENGINE",
  ocrmypdfBin: "PDFXYZ_OCR_OCRMYPDF_BIN",
  tesseractBin: "PDFXYZ_OCR_TESSERACT_BIN",
  timeoutMs: "PDFXYZ_OCR_TIMEOUT_MS",
  maxInputBytes: "PDFXYZ_OCR_MAX_INPUT_BYTES",
  maxOutputBytes: "PDFXYZ_OCR_MAX_OUTPUT_BYTES",
  tmpDir: "PDFXYZ_OCR_TMPDIR",
} as const;

/** The per-engine binary-override variable, keyed by engine. */
const ENGINE_BIN_ENV: Record<OcrEngine, string> = {
  ocrmypdf: NATIVE_OCR_ENV.ocrmypdfBin,
  tesseract: NATIVE_OCR_ENV.tesseractBin,
};

/**
 * Hard bounds so a misconfigured deployment can never ask for unbounded work. OCR
 * is meaningfully slower than compression (page rasterization + recognition) and
 * its searchable-PDF output can be larger than the input, so the timeout and output
 * ceilings are more generous than the compression engine's.
 */
export const OCR_TIMEOUT_MS_BOUNDS = {
  min: 1_000,
  max: 1_800_000, // 30 min — a generous ceiling for a large, multi-language scan.
  default: 300_000, // 5 min.
} as const;
export const OCR_INPUT_BYTES_BOUNDS = {
  min: 1_024,
  max: 2 * 1024 * 1024 * 1024, // 2 GiB absolute ceiling.
  default: 200 * 1024 * 1024, // 200 MiB.
} as const;
export const OCR_OUTPUT_BYTES_BOUNDS = {
  min: 1_024,
  max: 2 * 1024 * 1024 * 1024,
  default: 500 * 1024 * 1024, // 500 MiB — a searchable PDF can exceed its scan.
} as const;

/**
 * A validated native OCR configuration. Holds resolved per-engine invocations (a
 * command name to auto-detect on PATH, or an allowlisted absolute override path)
 * plus bounded resource limits. Safe to hold in worker memory; the paths here are
 * operator-provided config, never user input, and are never logged or returned to a
 * client.
 */
export interface NativeOcrConfig {
  /** Master switch: false disables OCR entirely (the default when nothing is declared). */
  readonly enabled: boolean;
  /** When set, ONLY this engine is considered (pin); otherwise auto-detect in preference order. */
  readonly engine?: OcrEngine;
  /** Resolved invocation per engine: an absolute override path, or the default command name. */
  readonly binaries: Readonly<Record<OcrEngine, string>>;
  /** Whether each engine's invocation is an explicit absolute-path override (probe by existence, not PATH). */
  readonly overridden: Readonly<Record<OcrEngine, boolean>>;
  /** Hard subprocess timeout (ms), clamped to {@link OCR_TIMEOUT_MS_BOUNDS}. */
  readonly timeoutMs: number;
  /** Max input size accepted (bytes), clamped to {@link OCR_INPUT_BYTES_BOUNDS}. */
  readonly maxInputBytes: number;
  /** Max output size accepted from the engine (bytes), clamped to {@link OCR_OUTPUT_BYTES_BOUNDS}. */
  readonly maxOutputBytes: number;
  /** Base temp directory for isolated job dirs; undefined → the OS default. Absolute, no traversal. */
  readonly tmpDir?: string;
}

/** Outcome of parsing the environment for a native-OCR configuration. */
export type ParseNativeOcrResult =
  | { ok: true; config: NativeOcrConfig }
  | {
      ok: false;
      /** Missing/malformed variables, by NAME only. Server-side diagnostics. */
      issues: FieldError[];
    };

/** Trimmed value, or `undefined` when absent/blank. */
function read(env: EnvSource, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const ENABLE_ON = new Set(["on", "true", "1", "yes", "auto", "enabled"]);
const ENABLE_OFF = new Set(["off", "false", "0", "no", "disabled", "none"]);

/**
 * Parse the OCR opt-in flag. Unlike native compression, an UNSET value means
 * *disabled*: OCR is the whole capability, so it must never light up without an
 * explicit operator opt-in. A recognized on/off token wins; anything else is an error.
 */
function parseEnable(
  raw: string | undefined,
): { ok: true; value: boolean } | { ok: false } {
  if (raw === undefined) return { ok: true, value: false };
  const v = raw.toLowerCase();
  if (ENABLE_ON.has(v)) return { ok: true, value: true };
  if (ENABLE_OFF.has(v)) return { ok: true, value: false };
  return { ok: false };
}

/** Parse a positive-integer byte/ms value within `[min, max]`; unset ⇒ default. */
function parseBounded(
  raw: string | undefined,
  bounds: { min: number; max: number; default: number },
): { ok: true; value: number } | { ok: false } {
  if (raw === undefined) return { ok: true, value: bounds.default };
  if (!/^\d{1,19}$/.test(raw)) return { ok: false };
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < bounds.min || n > bounds.max) {
    return { ok: false };
  }
  return { ok: true, value: n };
}

/** The default (non-overridden) command name for each engine. */
const DEFAULT_BINARIES: Readonly<Record<OcrEngine, string>> =
  OCR_ENGINE_BINARIES;

/**
 * Parse and validate the native-OCR configuration from an environment source.
 * Presence and shape only. Everything is optional with a safe default, so this
 * fails only when a *provided* value is malformed — in which case it returns the
 * offending variable names (never values) and the resolver treats OCR as disabled.
 * `env` is injectable for deterministic tests.
 */
export function parseNativeOcrConfig(
  env: EnvSource = process.env,
): ParseNativeOcrResult {
  const issues: FieldError[] = [];
  const miss = (name: string, message: string) =>
    issues.push({ field: name, message });

  const enable = parseEnable(read(env, NATIVE_OCR_ENV.enable));
  if (!enable.ok) {
    miss(NATIVE_OCR_ENV.enable, "Must be one of on/off (or true/false).");
  }

  let engine: OcrEngine | undefined;
  const engineRaw = read(env, NATIVE_OCR_ENV.engine);
  if (engineRaw !== undefined) {
    const lower = engineRaw.toLowerCase();
    if ((OCR_ENGINES as readonly string[]).includes(lower)) {
      engine = lower as OcrEngine;
    } else {
      miss(NATIVE_OCR_ENV.engine, `Must be one of: ${OCR_ENGINES.join(", ")}.`);
    }
  }

  const binaries: Record<OcrEngine, string> = { ...DEFAULT_BINARIES };
  const overridden: Record<OcrEngine, boolean> = {
    ocrmypdf: false,
    tesseract: false,
  };
  for (const tool of OCR_ENGINES) {
    const raw = read(env, ENGINE_BIN_ENV[tool]);
    if (raw === undefined) continue;
    if (!isSafeConfiguredPath(raw)) {
      miss(
        ENGINE_BIN_ENV[tool],
        "Must be a safe absolute path (no `..`, no shell characters).",
      );
      continue;
    }
    binaries[tool] = raw;
    overridden[tool] = true;
  }

  const timeout = parseBounded(
    read(env, NATIVE_OCR_ENV.timeoutMs),
    OCR_TIMEOUT_MS_BOUNDS,
  );
  if (!timeout.ok) {
    miss(
      NATIVE_OCR_ENV.timeoutMs,
      `Integer ms in [${OCR_TIMEOUT_MS_BOUNDS.min}, ${OCR_TIMEOUT_MS_BOUNDS.max}].`,
    );
  }

  const maxInput = parseBounded(
    read(env, NATIVE_OCR_ENV.maxInputBytes),
    OCR_INPUT_BYTES_BOUNDS,
  );
  if (!maxInput.ok) {
    miss(
      NATIVE_OCR_ENV.maxInputBytes,
      `Integer bytes in [${OCR_INPUT_BYTES_BOUNDS.min}, ${OCR_INPUT_BYTES_BOUNDS.max}].`,
    );
  }

  const maxOutput = parseBounded(
    read(env, NATIVE_OCR_ENV.maxOutputBytes),
    OCR_OUTPUT_BYTES_BOUNDS,
  );
  if (!maxOutput.ok) {
    miss(
      NATIVE_OCR_ENV.maxOutputBytes,
      `Integer bytes in [${OCR_OUTPUT_BYTES_BOUNDS.min}, ${OCR_OUTPUT_BYTES_BOUNDS.max}].`,
    );
  }

  let tmpDir: string | undefined;
  const tmpDirRaw = read(env, NATIVE_OCR_ENV.tmpDir);
  if (tmpDirRaw !== undefined) {
    if (!isSafeConfiguredPath(tmpDirRaw)) {
      miss(
        NATIVE_OCR_ENV.tmpDir,
        "Must be a safe absolute path (no `..`, no shell characters).",
      );
    } else {
      tmpDir = tmpDirRaw;
    }
  }

  if (
    issues.length > 0 ||
    !enable.ok ||
    !timeout.ok ||
    !maxInput.ok ||
    !maxOutput.ok
  ) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    config: {
      enabled: enable.value,
      ...(engine ? { engine } : {}),
      binaries,
      overridden,
      timeoutMs: timeout.value,
      maxInputBytes: maxInput.value,
      maxOutputBytes: maxOutput.value,
      ...(tmpDir ? { tmpDir } : {}),
    },
  };
}

/** A safe, fully-disabled configuration — the honest fallback for any parse failure. */
export function disabledNativeOcrConfig(): NativeOcrConfig {
  return {
    enabled: false,
    binaries: { ...DEFAULT_BINARIES },
    overridden: { ocrmypdf: false, tesseract: false },
    timeoutMs: OCR_TIMEOUT_MS_BOUNDS.default,
    maxInputBytes: OCR_INPUT_BYTES_BOUNDS.default,
    maxOutputBytes: OCR_OUTPUT_BYTES_BOUNDS.default,
  };
}

/**
 * Resolve a usable {@link NativeOcrConfig} from the environment, always returning a
 * config: a malformed variable degrades to the safe *disabled* config rather than
 * throwing or half-configuring the engine. Server-side diagnostics for *why* it
 * degraded remain available via {@link parseNativeOcrConfig}.
 */
export function resolveNativeOcrConfig(
  env: EnvSource = process.env,
): NativeOcrConfig {
  const parsed = parseNativeOcrConfig(env);
  return parsed.ok ? parsed.config : disabledNativeOcrConfig();
}

/**
 * The honest, client-safe capability of the native OCR engine in this environment.
 * Presence-only: it reports whether OCR is *enabled and shape-valid* and, at most,
 * the pinned engine *family* name — never a binary path, argument, temp directory,
 * or variable value. Actual runtime availability additionally requires the binary to
 * be installed on the worker host, which this node-free layer cannot observe and
 * never claims.
 */
export interface NativeOcrCapability {
  /** True when native OCR is enabled and configured validly here. */
  enabled: boolean;
  /** Pinned engine family, or null for auto-detect. NAME only — never a path. */
  engine: OcrEngine | null;
  /** One-line, client-safe explanation. Never a path, argument, or variable value. */
  detail: string;
}

/** Derive the presence-only native-OCR capability. Never leaks a path or value. */
export function nativeOcrCapability(
  env: EnvSource = process.env,
): NativeOcrCapability {
  const parsed = parseNativeOcrConfig(env);
  if (!parsed.ok || !parsed.config.enabled) {
    return {
      enabled: false,
      engine: null,
      detail:
        "Native OCR is disabled or not configured here, so OCR is not available; it stays honestly not-implemented until an operator opts in and installs an engine.",
    };
  }
  const engine = parsed.config.engine ?? null;
  return {
    enabled: true,
    engine,
    detail: engine
      ? `Native OCR is enabled and pinned to the ${engine} engine; running it additionally requires that engine installed on the worker host.`
      : "Native OCR is enabled with auto-detection (OCRmyPDF or Tesseract); running it additionally requires one installed on the worker host.",
  };
}

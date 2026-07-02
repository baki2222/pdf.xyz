/**
 * Server-side configuration for the **native deep-compression engine** — parsed
 * from the environment, validated for presence and shape only.
 *
 * This is the Phase 17 analogue of `storage/s3-config.ts`: a node-free leaf that
 * turns environment variables into a typed, bounded {@link NativeCompressionConfig}
 * the Node-only runner (`native.ts`) consumes, and a presence-only
 * {@link NativeCompressionCapability} the client-facing status layer can surface
 * without ever exposing a binary path, argument, or variable value.
 *
 * Security posture (the load-bearing rules of this module):
 *  - Native deep compression shells out to a subprocess, so it is gated by an
 *    explicit **enable flag** (defaulting to auto-detect, so existing local-dev
 *    behavior is unchanged) plus a kill switch to force it off on hardened hosts.
 *  - A binary-path override is accepted only when it is a safe **absolute path**
 *    on a fixed allowlist of the three known engines — never an arbitrary command,
 *    never a value with shell metacharacters or `..` traversal. Auto-detection by
 *    fixed command name (`gs`/`qpdf`/`mutool`) is the default.
 *  - Every bound (timeout, max input/output bytes) is clamped to a hard ceiling so
 *    a misconfigured deployment cannot ask the worker to run unbounded.
 *  - A parse failure names the offending **variable** (never its value); the
 *    resolver falls back to a safe *disabled* config, so a half-configured engine
 *    is honestly off rather than half-on. The client capability names only the
 *    engine *family* (like storage names "s3") — never a path or argument.
 */

import type { FieldError } from "@/lib/jobs";
import { DEEP_COMPRESSION_TOOLS, TOOL_BINARIES, type CompressionTool } from "./engine";

type EnvSource = Record<string, string | undefined>;

/** The environment variables this engine reads (names only; never values). */
export const NATIVE_COMPRESSION_ENV = {
  enable: "PDFXYZ_NATIVE_COMPRESSION",
  engine: "PDFXYZ_COMPRESSION_ENGINE",
  ghostscriptBin: "PDFXYZ_COMPRESSION_GHOSTSCRIPT_BIN",
  qpdfBin: "PDFXYZ_COMPRESSION_QPDF_BIN",
  mutoolBin: "PDFXYZ_COMPRESSION_MUTOOL_BIN",
  timeoutMs: "PDFXYZ_COMPRESSION_TIMEOUT_MS",
  maxInputBytes: "PDFXYZ_COMPRESSION_MAX_INPUT_BYTES",
  maxOutputBytes: "PDFXYZ_COMPRESSION_MAX_OUTPUT_BYTES",
  tmpDir: "PDFXYZ_COMPRESSION_TMPDIR",
} as const;

/** The per-engine binary-override variable, keyed by engine. */
const ENGINE_BIN_ENV: Record<CompressionTool, string> = {
  ghostscript: NATIVE_COMPRESSION_ENV.ghostscriptBin,
  qpdf: NATIVE_COMPRESSION_ENV.qpdfBin,
  mutool: NATIVE_COMPRESSION_ENV.mutoolBin,
};

/** Hard bounds so a misconfigured deployment can never ask for unbounded work. */
export const TIMEOUT_MS_BOUNDS = { min: 1_000, max: 600_000, default: 120_000 } as const;
export const INPUT_BYTES_BOUNDS = {
  min: 1_024,
  max: 2 * 1024 * 1024 * 1024, // 2 GiB absolute ceiling
  default: 200 * 1024 * 1024, // 200 MiB
} as const;
export const OUTPUT_BYTES_BOUNDS = {
  min: 1_024,
  max: 2 * 1024 * 1024 * 1024,
  default: 200 * 1024 * 1024,
} as const;

/**
 * A validated native deep-compression configuration. Holds resolved per-engine
 * invocations (a command name to auto-detect on PATH, or an allowlisted absolute
 * override path) plus bounded resource limits. Safe to hold in worker memory; the
 * paths here are operator-provided config, never user input, and are never logged
 * or returned to a client.
 */
export interface NativeCompressionConfig {
  /** Master switch: false disables the deep/native path entirely (lossless still works). */
  readonly enabled: boolean;
  /** When set, ONLY this engine is considered (pin); otherwise auto-detect in preference order. */
  readonly engine?: CompressionTool;
  /** Resolved invocation per engine: an absolute override path, or the default command name. */
  readonly binaries: Readonly<Record<CompressionTool, string>>;
  /** Whether each engine's invocation is an explicit absolute-path override (probe by existence, not PATH). */
  readonly overridden: Readonly<Record<CompressionTool, boolean>>;
  /** Hard subprocess timeout (ms), clamped to {@link TIMEOUT_MS_BOUNDS}. */
  readonly timeoutMs: number;
  /** Max input size accepted by the deep path (bytes), clamped to {@link INPUT_BYTES_BOUNDS}. */
  readonly maxInputBytes: number;
  /** Max output size accepted from the engine (bytes), clamped to {@link OUTPUT_BYTES_BOUNDS}. */
  readonly maxOutputBytes: number;
  /** Base temp directory for isolated job dirs; undefined → the OS default. Absolute, no traversal. */
  readonly tmpDir?: string;
}

/** Outcome of parsing the environment for a native-compression configuration. */
export type ParseNativeCompressionResult =
  | { ok: true; config: NativeCompressionConfig }
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

/** Parse the enable flag; unset ⇒ enabled (auto), so default behavior is unchanged. */
function parseEnable(
  raw: string | undefined,
): { ok: true; value: boolean } | { ok: false } {
  if (raw === undefined) return { ok: true, value: true };
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

// Allowlist of characters permitted in an operator-provided path: alphanumerics
// plus the normal path punctuation (slash, backslash, drive colon, dot, dash,
// underscore, space, parentheses). Anything else — a shell metacharacter or a
// control byte — is rejected. We invoke via argv (never a shell), so this is
// defense in depth, but it also catches obvious operator typos before the OS.
const SAFE_PATH_CHARS = /^[A-Za-z0-9/\\:._\-() ]+$/;

/**
 * Validate an operator-provided filesystem path (binary override or temp dir):
 * must be a non-empty absolute POSIX/Windows path, built only from allowlisted
 * characters, free of `..` traversal, and within a sane length. Presence/shape
 * only — existence is checked by the Node runner at probe time.
 */
export function isSafeConfiguredPath(value: string): boolean {
  if (value.length === 0 || value.length > 4096) return false;
  if (!SAFE_PATH_CHARS.test(value)) return false;
  if (value.includes("..")) return false;
  const isPosixAbsolute = value.startsWith("/");
  const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(value);
  return isPosixAbsolute || isWindowsAbsolute;
}

/**
 * Parse and validate the native-compression configuration from an environment
 * source. Presence and shape only. Everything is optional with a safe default, so
 * this fails only when a *provided* value is malformed — in which case it returns
 * the offending variable names (never values) and the resolver treats the engine
 * as disabled. `env` is injectable for deterministic tests.
 */
export function parseNativeCompressionConfig(
  env: EnvSource = process.env,
): ParseNativeCompressionResult {
  const issues: FieldError[] = [];
  const miss = (name: string, message: string) => issues.push({ field: name, message });

  const enable = parseEnable(read(env, NATIVE_COMPRESSION_ENV.enable));
  if (!enable.ok) {
    miss(NATIVE_COMPRESSION_ENV.enable, "Must be one of on/off/auto (or true/false).");
  }

  let engine: CompressionTool | undefined;
  const engineRaw = read(env, NATIVE_COMPRESSION_ENV.engine);
  if (engineRaw !== undefined) {
    const lower = engineRaw.toLowerCase();
    if ((DEEP_COMPRESSION_TOOLS as readonly string[]).includes(lower)) {
      engine = lower as CompressionTool;
    } else {
      miss(
        NATIVE_COMPRESSION_ENV.engine,
        `Must be one of: ${DEEP_COMPRESSION_TOOLS.join(", ")}.`,
      );
    }
  }

  const binaries: Record<CompressionTool, string> = { ...TOOL_BINARIES };
  const overridden: Record<CompressionTool, boolean> = {
    ghostscript: false,
    qpdf: false,
    mutool: false,
  };
  for (const tool of DEEP_COMPRESSION_TOOLS) {
    const raw = read(env, ENGINE_BIN_ENV[tool]);
    if (raw === undefined) continue;
    if (!isSafeConfiguredPath(raw)) {
      miss(ENGINE_BIN_ENV[tool], "Must be a safe absolute path (no `..`, no shell characters).");
      continue;
    }
    binaries[tool] = raw;
    overridden[tool] = true;
  }

  const timeout = parseBounded(read(env, NATIVE_COMPRESSION_ENV.timeoutMs), TIMEOUT_MS_BOUNDS);
  if (!timeout.ok) {
    miss(
      NATIVE_COMPRESSION_ENV.timeoutMs,
      `Integer ms in [${TIMEOUT_MS_BOUNDS.min}, ${TIMEOUT_MS_BOUNDS.max}].`,
    );
  }

  const maxInput = parseBounded(read(env, NATIVE_COMPRESSION_ENV.maxInputBytes), INPUT_BYTES_BOUNDS);
  if (!maxInput.ok) {
    miss(
      NATIVE_COMPRESSION_ENV.maxInputBytes,
      `Integer bytes in [${INPUT_BYTES_BOUNDS.min}, ${INPUT_BYTES_BOUNDS.max}].`,
    );
  }

  const maxOutput = parseBounded(
    read(env, NATIVE_COMPRESSION_ENV.maxOutputBytes),
    OUTPUT_BYTES_BOUNDS,
  );
  if (!maxOutput.ok) {
    miss(
      NATIVE_COMPRESSION_ENV.maxOutputBytes,
      `Integer bytes in [${OUTPUT_BYTES_BOUNDS.min}, ${OUTPUT_BYTES_BOUNDS.max}].`,
    );
  }

  let tmpDir: string | undefined;
  const tmpDirRaw = read(env, NATIVE_COMPRESSION_ENV.tmpDir);
  if (tmpDirRaw !== undefined) {
    if (!isSafeConfiguredPath(tmpDirRaw)) {
      miss(NATIVE_COMPRESSION_ENV.tmpDir, "Must be a safe absolute path (no `..`, no shell characters).");
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
export function disabledNativeCompressionConfig(): NativeCompressionConfig {
  return {
    enabled: false,
    binaries: { ...TOOL_BINARIES },
    overridden: { ghostscript: false, qpdf: false, mutool: false },
    timeoutMs: TIMEOUT_MS_BOUNDS.default,
    maxInputBytes: INPUT_BYTES_BOUNDS.default,
    maxOutputBytes: OUTPUT_BYTES_BOUNDS.default,
  };
}

/**
 * Resolve a usable {@link NativeCompressionConfig} from the environment, always
 * returning a config: a malformed variable degrades to the safe *disabled* config
 * rather than throwing or half-configuring the engine. Server-side diagnostics for
 * *why* it degraded remain available via {@link parseNativeCompressionConfig}.
 */
export function resolveNativeCompressionConfig(
  env: EnvSource = process.env,
): NativeCompressionConfig {
  const parsed = parseNativeCompressionConfig(env);
  return parsed.ok ? parsed.config : disabledNativeCompressionConfig();
}

/**
 * The honest, client-safe capability of the native deep-compression engine in this
 * environment. Presence-only: it reports whether the engine is *enabled and
 * shape-valid* and, at most, the pinned engine *family* name — never a binary
 * path, argument, temp directory, or variable value. Actual runtime availability
 * additionally requires the binary to be installed on the worker host, which this
 * node-free layer cannot observe and never claims.
 */
export interface NativeCompressionCapability {
  /** True when native deep compression is enabled and configured validly here. */
  enabled: boolean;
  /** Pinned engine family, or null for auto-detect. NAME only — never a path. */
  engine: CompressionTool | null;
  /** One-line, client-safe explanation. Never a path, argument, or variable value. */
  detail: string;
}

/** Derive the presence-only native-compression capability. Never leaks a path or value. */
export function nativeCompressionCapability(
  env: EnvSource = process.env,
): NativeCompressionCapability {
  const parsed = parseNativeCompressionConfig(env);
  if (!parsed.ok || !parsed.config.enabled) {
    return {
      enabled: false,
      engine: null,
      detail:
        "Native deep compression is disabled or not configured here; the worker can still run lossless structural repack.",
    };
  }
  const engine = parsed.config.engine ?? null;
  return {
    enabled: true,
    engine,
    detail: engine
      ? `Native deep compression is enabled and pinned to the ${engine} engine; running it additionally requires that engine installed on the worker host.`
      : "Native deep compression is enabled with auto-detection (Ghostscript, qpdf, or mutool); running it additionally requires one installed on the worker host.",
  };
}

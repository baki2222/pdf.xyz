/**
 * Server-side configuration for the **native PDF security engine** (qpdf) — parsed
 * from the environment, validated for presence and shape only.
 *
 * This is the protect/unlock analogue of `../compression/native-config.ts`: a
 * node-free leaf that turns environment variables into a typed, bounded
 * {@link NativePdfSecurityConfig} the Node-only runner (`./native.ts`) consumes,
 * and a presence-only {@link NativePdfSecurityCapability} the operator tooling can
 * surface without ever exposing a binary path, argument, or variable value.
 *
 * Security posture (the load-bearing rules of this module):
 *  - Protect/unlock shell out to qpdf, so the engine is **enable-gated**: it
 *    defaults to auto-detect (qpdf ships in the worker image, so the capability is
 *    honestly on wherever the binary is present), and a kill switch can force it
 *    off on a hardened host. This mirrors native compression, NOT OCR — the binary
 *    is a standard part of the image, not an operator-opted-in extra.
 *  - A binary-path override is accepted only when it is a safe **absolute path**
 *    (reusing the compression config's allowlist — no shell metacharacters, no
 *    `..` traversal). Auto-detection by the fixed command name `qpdf` is the default.
 *  - Every bound (timeout, max input/output bytes) is clamped to a hard ceiling so
 *    a misconfigured deployment cannot ask the worker to run unbounded.
 *  - A parse failure names the offending **variable** (never its value); the
 *    resolver falls back to a safe *disabled* config, so a half-configured engine
 *    is honestly off rather than half-on. Passwords are NEVER read from or written
 *    to configuration — they arrive only in a validated job's options.
 */

import type { FieldError } from "@/lib/jobs";
import { isSafeConfiguredPath } from "../compression/native-config";
import { QPDF_BINARY } from "./engine";

type EnvSource = Record<string, string | undefined>;

/** The environment variables this engine reads (names only; never values). */
export const NATIVE_PDF_SECURITY_ENV = {
  /** Master switch. Unset ⇒ enabled (auto-detect), so default behavior is unchanged. */
  enable: "PDFXYZ_PDF_SECURITY",
  /** Absolute-path override for the qpdf binary; unset ⇒ auto-detect `qpdf` on PATH. */
  qpdfBin: "PDFXYZ_PDF_SECURITY_QPDF_BIN",
  timeoutMs: "PDFXYZ_PDF_SECURITY_TIMEOUT_MS",
  maxInputBytes: "PDFXYZ_PDF_SECURITY_MAX_INPUT_BYTES",
  maxOutputBytes: "PDFXYZ_PDF_SECURITY_MAX_OUTPUT_BYTES",
  tmpDir: "PDFXYZ_PDF_SECURITY_TMPDIR",
} as const;

/** Hard bounds so a misconfigured deployment can never ask for unbounded work. */
export const PDF_SECURITY_TIMEOUT_MS_BOUNDS = {
  min: 1_000,
  max: 600_000,
  default: 120_000,
} as const;
export const PDF_SECURITY_INPUT_BYTES_BOUNDS = {
  min: 1_024,
  max: 2 * 1024 * 1024 * 1024, // 2 GiB absolute ceiling.
  default: 200 * 1024 * 1024, // 200 MiB.
} as const;
export const PDF_SECURITY_OUTPUT_BYTES_BOUNDS = {
  min: 1_024,
  max: 2 * 1024 * 1024 * 1024,
  default: 200 * 1024 * 1024, // Encryption barely changes size; 200 MiB is generous.
} as const;

/**
 * A validated native PDF-security configuration. Holds the resolved qpdf
 * invocation (a command name to auto-detect on PATH, or an allowlisted absolute
 * override path) plus bounded resource limits. Safe to hold in worker memory; the
 * path here is operator-provided config, never user input, and is never logged or
 * returned to a client.
 */
export interface NativePdfSecurityConfig {
  /** Master switch: false disables the protect/unlock path entirely. */
  readonly enabled: boolean;
  /** Resolved qpdf invocation: an absolute override path, or the default command name. */
  readonly binary: string;
  /** Whether the invocation is an explicit absolute-path override (probe by existence, not PATH). */
  readonly overridden: boolean;
  /** Hard subprocess timeout (ms), clamped to {@link PDF_SECURITY_TIMEOUT_MS_BOUNDS}. */
  readonly timeoutMs: number;
  /** Max input size accepted (bytes), clamped to {@link PDF_SECURITY_INPUT_BYTES_BOUNDS}. */
  readonly maxInputBytes: number;
  /** Max output size accepted from the engine (bytes), clamped to {@link PDF_SECURITY_OUTPUT_BYTES_BOUNDS}. */
  readonly maxOutputBytes: number;
  /** Base temp directory for isolated job dirs; undefined → the OS default. Absolute, no traversal. */
  readonly tmpDir?: string;
}

/** Outcome of parsing the environment for a native PDF-security configuration. */
export type ParseNativePdfSecurityResult =
  | { ok: true; config: NativePdfSecurityConfig }
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

/**
 * Parse and validate the native PDF-security configuration from an environment
 * source. Presence and shape only. Everything is optional with a safe default, so
 * this fails only when a *provided* value is malformed — in which case it returns
 * the offending variable names (never values) and the resolver treats the engine
 * as disabled. `env` is injectable for deterministic tests.
 */
export function parseNativePdfSecurityConfig(
  env: EnvSource = process.env,
): ParseNativePdfSecurityResult {
  const issues: FieldError[] = [];
  const miss = (name: string, message: string) => issues.push({ field: name, message });

  const enable = parseEnable(read(env, NATIVE_PDF_SECURITY_ENV.enable));
  if (!enable.ok) {
    miss(NATIVE_PDF_SECURITY_ENV.enable, "Must be one of on/off/auto (or true/false).");
  }

  let binary = QPDF_BINARY;
  let overridden = false;
  const binRaw = read(env, NATIVE_PDF_SECURITY_ENV.qpdfBin);
  if (binRaw !== undefined) {
    if (!isSafeConfiguredPath(binRaw)) {
      miss(
        NATIVE_PDF_SECURITY_ENV.qpdfBin,
        "Must be a safe absolute path (no `..`, no shell characters).",
      );
    } else {
      binary = binRaw;
      overridden = true;
    }
  }

  const timeout = parseBounded(
    read(env, NATIVE_PDF_SECURITY_ENV.timeoutMs),
    PDF_SECURITY_TIMEOUT_MS_BOUNDS,
  );
  if (!timeout.ok) {
    miss(
      NATIVE_PDF_SECURITY_ENV.timeoutMs,
      `Integer ms in [${PDF_SECURITY_TIMEOUT_MS_BOUNDS.min}, ${PDF_SECURITY_TIMEOUT_MS_BOUNDS.max}].`,
    );
  }

  const maxInput = parseBounded(
    read(env, NATIVE_PDF_SECURITY_ENV.maxInputBytes),
    PDF_SECURITY_INPUT_BYTES_BOUNDS,
  );
  if (!maxInput.ok) {
    miss(
      NATIVE_PDF_SECURITY_ENV.maxInputBytes,
      `Integer bytes in [${PDF_SECURITY_INPUT_BYTES_BOUNDS.min}, ${PDF_SECURITY_INPUT_BYTES_BOUNDS.max}].`,
    );
  }

  const maxOutput = parseBounded(
    read(env, NATIVE_PDF_SECURITY_ENV.maxOutputBytes),
    PDF_SECURITY_OUTPUT_BYTES_BOUNDS,
  );
  if (!maxOutput.ok) {
    miss(
      NATIVE_PDF_SECURITY_ENV.maxOutputBytes,
      `Integer bytes in [${PDF_SECURITY_OUTPUT_BYTES_BOUNDS.min}, ${PDF_SECURITY_OUTPUT_BYTES_BOUNDS.max}].`,
    );
  }

  let tmpDir: string | undefined;
  const tmpDirRaw = read(env, NATIVE_PDF_SECURITY_ENV.tmpDir);
  if (tmpDirRaw !== undefined) {
    if (!isSafeConfiguredPath(tmpDirRaw)) {
      miss(
        NATIVE_PDF_SECURITY_ENV.tmpDir,
        "Must be a safe absolute path (no `..`, no shell characters).",
      );
    } else {
      tmpDir = tmpDirRaw;
    }
  }

  if (issues.length > 0 || !enable.ok || !timeout.ok || !maxInput.ok || !maxOutput.ok) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    config: {
      enabled: enable.value,
      binary,
      overridden,
      timeoutMs: timeout.value,
      maxInputBytes: maxInput.value,
      maxOutputBytes: maxOutput.value,
      ...(tmpDir ? { tmpDir } : {}),
    },
  };
}

/** A safe, fully-disabled configuration — the honest fallback for any parse failure. */
export function disabledNativePdfSecurityConfig(): NativePdfSecurityConfig {
  return {
    enabled: false,
    binary: QPDF_BINARY,
    overridden: false,
    timeoutMs: PDF_SECURITY_TIMEOUT_MS_BOUNDS.default,
    maxInputBytes: PDF_SECURITY_INPUT_BYTES_BOUNDS.default,
    maxOutputBytes: PDF_SECURITY_OUTPUT_BYTES_BOUNDS.default,
  };
}

/**
 * Resolve a usable {@link NativePdfSecurityConfig} from the environment, always
 * returning a config: a malformed variable degrades to the safe *disabled* config
 * rather than throwing or half-configuring the engine. Server-side diagnostics for
 * *why* it degraded remain available via {@link parseNativePdfSecurityConfig}.
 */
export function resolveNativePdfSecurityConfig(
  env: EnvSource = process.env,
): NativePdfSecurityConfig {
  const parsed = parseNativePdfSecurityConfig(env);
  return parsed.ok ? parsed.config : disabledNativePdfSecurityConfig();
}

/**
 * The honest, client-safe capability of the native PDF-security engine in this
 * environment. Presence-only: it reports whether the engine is *enabled and
 * shape-valid* — never a binary path, argument, temp directory, or variable value.
 * Actual runtime availability additionally requires qpdf to be installed on the
 * worker host, which this node-free layer cannot observe and never claims.
 */
export interface NativePdfSecurityCapability {
  /** True when protect/unlock is enabled and configured validly here. */
  enabled: boolean;
  /** One-line, client-safe explanation. Never a path, argument, or variable value. */
  detail: string;
}

/** Derive the presence-only native PDF-security capability. Never leaks a path or value. */
export function nativePdfSecurityCapability(
  env: EnvSource = process.env,
): NativePdfSecurityCapability {
  const parsed = parseNativePdfSecurityConfig(env);
  if (!parsed.ok || !parsed.config.enabled) {
    return {
      enabled: false,
      detail:
        "PDF password protection is disabled or not configured here; it needs the qpdf engine enabled on a secure worker.",
    };
  }
  return {
    enabled: true,
    detail:
      "PDF password protection is enabled with the qpdf engine; running it additionally requires qpdf installed on the worker host.",
  };
}

/**
 * Bounded, typed configuration for the native `pdftotext` extractor, parsed from
 * the environment. Mirrors `../office-conversion/native-config`: an enable kill
 * switch, a binary name or allowlisted absolute override, a hard timeout, and
 * input/output byte ceilings. Node-free so it can be unit-tested directly.
 */

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "auto"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);
const DEFAULT_BINARY = "pdftotext";

export interface NativePdfTextConfig {
  enabled: boolean;
  binary: string;
  /** True when the binary came from an absolute-path override (probe by existence). */
  overridden: boolean;
  timeoutMs: number;
  maxInputBytes: number;
  /** Ceiling on the extractor's stdout, in bytes — a decompression-bomb backstop. */
  maxOutputBytes: number;
  tmpDir?: string;
}

function parseEnabled(value: string | undefined): boolean {
  if (!value?.trim()) return true;
  const normalized = value.trim().toLowerCase();
  if (FALSE_VALUES.has(normalized)) return false;
  if (TRUE_VALUES.has(normalized)) return true;
  return true;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

export function resolveNativePdfTextConfig(
  env: Record<string, string | undefined> = process.env,
): NativePdfTextConfig {
  const override = env.PDFXYZ_PDF_TEXT_BIN?.trim();
  const tmpDir = env.PDFXYZ_PDF_TEXT_TMPDIR?.trim() || undefined;
  return {
    enabled: parseEnabled(env.PDFXYZ_PDF_TEXT ?? env.PDFXYZ_NATIVE_PDF_TEXT),
    binary: override || DEFAULT_BINARY,
    overridden: !!override && override.startsWith("/"),
    timeoutMs: parsePositiveInt(env.PDFXYZ_PDF_TEXT_TIMEOUT_MS, 120_000),
    maxInputBytes: parsePositiveInt(
      env.PDFXYZ_PDF_TEXT_MAX_INPUT_BYTES,
      100 * 1024 * 1024,
    ),
    maxOutputBytes: parsePositiveInt(
      env.PDFXYZ_PDF_TEXT_MAX_OUTPUT_BYTES,
      64 * 1024 * 1024,
    ),
    ...(tmpDir ? { tmpDir } : {}),
  };
}

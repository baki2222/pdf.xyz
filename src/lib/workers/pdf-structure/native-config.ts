/** Native qpdf config for PDF repair and web optimization. */

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "auto"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

export interface NativePdfStructureConfig {
  enabled: boolean;
  binary: string;
  overridden: boolean;
  timeoutMs: number;
  maxInputBytes: number;
  maxOutputBytes: number;
  tmpDir?: string;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

function parseEnabled(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "") return true;
  const normalized = value.trim().toLowerCase();
  if (FALSE_VALUES.has(normalized)) return false;
  if (TRUE_VALUES.has(normalized)) return true;
  return true;
}

function cleanBinary(value: string | undefined): {
  binary: string;
  overridden: boolean;
} {
  const trimmed = value?.trim();
  if (!trimmed) return { binary: "qpdf", overridden: false };
  return { binary: trimmed, overridden: trimmed.startsWith("/") };
}

export function resolveNativePdfStructureConfig(
  env: Record<string, string | undefined> = process.env,
): NativePdfStructureConfig {
  const { binary, overridden } = cleanBinary(
    env.PDFXYZ_PDF_STRUCTURE_QPDF_BIN ?? env.PDFXYZ_QPDF_BIN,
  );
  const tmpDir = env.PDFXYZ_PDF_STRUCTURE_TMPDIR?.trim() || undefined;
  return {
    enabled: parseEnabled(
      env.PDFXYZ_PDF_STRUCTURE ?? env.PDFXYZ_NATIVE_PDF_STRUCTURE,
    ),
    binary,
    overridden,
    timeoutMs: parsePositiveInt(env.PDFXYZ_PDF_STRUCTURE_TIMEOUT_MS, 30_000),
    maxInputBytes: parsePositiveInt(
      env.PDFXYZ_PDF_STRUCTURE_MAX_INPUT_BYTES,
      200 * 1024 * 1024,
    ),
    maxOutputBytes: parsePositiveInt(
      env.PDFXYZ_PDF_STRUCTURE_MAX_OUTPUT_BYTES,
      220 * 1024 * 1024,
    ),
    ...(tmpDir ? { tmpDir } : {}),
  };
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "auto"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

export interface NativePdfArchiveConfig {
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

function cleanBinary(value: string | undefined): { binary: string; overridden: boolean } {
  const trimmed = value?.trim();
  if (!trimmed) return { binary: "gs", overridden: false };
  return { binary: trimmed, overridden: trimmed.startsWith("/") };
}

export function resolveNativePdfArchiveConfig(
  env: Record<string, string | undefined> = process.env,
): NativePdfArchiveConfig {
  const { binary, overridden } = cleanBinary(env.PDFXYZ_PDF_ARCHIVE_GS_BIN ?? env.PDFXYZ_GHOSTSCRIPT_BIN);
  const tmpDir = env.PDFXYZ_PDF_ARCHIVE_TMPDIR?.trim() || undefined;
  return {
    enabled: parseEnabled(env.PDFXYZ_PDF_ARCHIVE ?? env.PDFXYZ_NATIVE_PDF_ARCHIVE),
    binary,
    overridden,
    timeoutMs: parsePositiveInt(env.PDFXYZ_PDF_ARCHIVE_TIMEOUT_MS, 120_000),
    maxInputBytes: parsePositiveInt(env.PDFXYZ_PDF_ARCHIVE_MAX_INPUT_BYTES, 200 * 1024 * 1024),
    maxOutputBytes: parsePositiveInt(env.PDFXYZ_PDF_ARCHIVE_MAX_OUTPUT_BYTES, 300 * 1024 * 1024),
    ...(tmpDir ? { tmpDir } : {}),
  };
}

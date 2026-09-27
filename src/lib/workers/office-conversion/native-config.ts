const TRUE_VALUES = new Set(["1", "true", "yes", "on", "auto"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);
const DEFAULT_CANDIDATES = ["soffice", "libreoffice"];

/**
 * The largest Office input LibreOffice is handed, in bytes — and the figure
 * every Word, Excel and PowerPoint to PDF page states, through
 * `@/lib/workers/engine-file-ceilings`.
 *
 * The web tier cannot read this worker's environment, so the number it
 * publishes is this CODE default. `PDFXYZ_OFFICE_CONVERSION_MAX_INPUT_BYTES`
 * may lower it (an operator's safety valve; the refusal then names the lower
 * figure) but can never raise it past what the page promised — the upload API
 * refuses above this anyway, so a higher override would only be a number the
 * worker believes and no request can reach.
 */
export const OFFICE_CONVERSION_DEFAULT_MAX_INPUT_BYTES = 50 * 1024 * 1024;

export interface NativeOfficeConversionConfig {
  enabled: boolean;
  candidates: string[];
  overridden: boolean;
  timeoutMs: number;
  maxInputBytes: number;
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

function candidates(value: string | undefined): {
  candidates: string[];
  overridden: boolean;
} {
  const trimmed = value?.trim();
  if (!trimmed)
    return { candidates: [...DEFAULT_CANDIDATES], overridden: false };
  return { candidates: [trimmed], overridden: trimmed.startsWith("/") };
}

export function resolveNativeOfficeConversionConfig(
  env: Record<string, string | undefined> = process.env,
): NativeOfficeConversionConfig {
  const resolved = candidates(
    env.PDFXYZ_OFFICE_CONVERSION_BIN ?? env.PDFXYZ_LIBREOFFICE_BIN,
  );
  const tmpDir = env.PDFXYZ_OFFICE_CONVERSION_TMPDIR?.trim() || undefined;
  return {
    enabled: parseEnabled(
      env.PDFXYZ_OFFICE_CONVERSION ?? env.PDFXYZ_NATIVE_OFFICE_CONVERSION,
    ),
    candidates: resolved.candidates,
    overridden: resolved.overridden,
    timeoutMs: parsePositiveInt(
      env.PDFXYZ_OFFICE_CONVERSION_TIMEOUT_MS,
      120_000,
    ),
    maxInputBytes: Math.min(
      parsePositiveInt(
        env.PDFXYZ_OFFICE_CONVERSION_MAX_INPUT_BYTES,
        OFFICE_CONVERSION_DEFAULT_MAX_INPUT_BYTES,
      ),
      OFFICE_CONVERSION_DEFAULT_MAX_INPUT_BYTES,
    ),
    maxOutputBytes: parsePositiveInt(
      env.PDFXYZ_OFFICE_CONVERSION_MAX_OUTPUT_BYTES,
      100 * 1024 * 1024,
    ),
    ...(tmpDir ? { tmpDir } : {}),
  };
}

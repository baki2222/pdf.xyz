export const WORD_TO_PDF_TOOL = "word-to-pdf";
export const EXCEL_TO_PDF_TOOL = "excel-to-pdf";
export const POWERPOINT_TO_PDF_TOOL = "powerpoint-to-pdf";
/**
 * The tools the LibreOffice engine serves. They live in this import-free
 * module (and `engine.ts` re-exports them) so the tool page's ceiling lookup
 * can read them without pulling the server engine into the browser bundle.
 */
export const OFFICE_TO_PDF_TOOLS = [
  WORD_TO_PDF_TOOL,
  EXCEL_TO_PDF_TOOL,
  POWERPOINT_TO_PDF_TOOL,
] as const;

/**
 * The most the Office converter accepts per document — and so the number the
 * Word, Excel and PowerPoint pages state (`toolFileCeiling` reads it from
 * here). The pages used to state the upload gate's 100 MB while this engine
 * refused anything over 50 MB, after the whole file had been uploaded.
 *
 * `PDFXYZ_OFFICE_CONVERSION_MAX_INPUT_BYTES` can only RAISE the limit: the
 * web tier cannot see a worker's env, so an override below this figure would
 * make every page overstate the cap again. Raising the published figure means
 * changing this constant (and proving a file that size converts).
 */
export const OFFICE_MAX_INPUT_BYTES = 50 * 1024 * 1024;

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "auto"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);
const DEFAULT_CANDIDATES = ["soffice", "libreoffice"];

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
    maxInputBytes: Math.max(
      parsePositiveInt(
        env.PDFXYZ_OFFICE_CONVERSION_MAX_INPUT_BYTES,
        OFFICE_MAX_INPUT_BYTES,
      ),
      OFFICE_MAX_INPUT_BYTES,
    ),
    maxOutputBytes: parsePositiveInt(
      env.PDFXYZ_OFFICE_CONVERSION_MAX_OUTPUT_BYTES,
      100 * 1024 * 1024,
    ),
    ...(tmpDir ? { tmpDir } : {}),
  };
}

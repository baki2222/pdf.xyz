/**
 * The tools the LibreOffice engine serves live in the leaf `./tools` (the web
 * tier states and enforces this engine's ceiling through
 * `@/lib/workers/engine-file-ceilings`). They are re-exported here so the
 * engine's tool list and its input cap sit in one module: the guard that walks
 * every `*native-config.ts` links an engine to the ceiling it declares by the
 * identity of this list.
 */
export {
  EXCEL_TO_PDF_TOOL,
  OFFICE_TO_PDF_TOOLS,
  POWERPOINT_TO_PDF_TOOL,
  WORD_TO_PDF_TOOL,
} from "./tools";

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "auto"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);
const DEFAULT_CANDIDATES = ["soffice", "libreoffice"];

/**
 * The largest Office input LibreOffice is handed by default, in bytes — and the
 * figure every Word, Excel and PowerPoint to PDF page states, through
 * `@/lib/workers/engine-file-ceilings`. The pages used to state the upload
 * gate's 100 MB while this engine refused anything over 50 MB, after the whole
 * file had been uploaded.
 *
 * The web tier cannot read this worker's environment, so the number it
 * publishes is this CODE default, and `PDFXYZ_OFFICE_CONVERSION_MAX_INPUT_BYTES`
 * can only RAISE the engine's limit, never lower it: an override below this
 * figure would make every one of those pages overstate the cap again, and a
 * file between the two would be uploaded in full and then refused. A raised
 * limit is harmless and unreachable — the upload API refuses above this figure
 * anyway. Publishing a different figure means changing this constant (and
 * proving a file that size converts).
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
    maxInputBytes: Math.max(
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

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "auto"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

const DEFAULT_CANDIDATES = [
  "chromium",
  "chromium-browser",
  "google-chrome",
  "google-chrome-stable",
];

/**
 * What the renderer refuses an HTML upload above when no env override is set.
 * Exported because it is BELOW the upload gate (`JOB_LIMITS.maxFileBytes`),
 * which makes it the real per-file ceiling of HTML to PDF: `file-ceilings.ts`
 * reads it from here rather than restating 20 MB.
 */
export const HTML_RENDER_DEFAULT_MAX_INPUT_BYTES = 20 * 1024 * 1024;

export interface NativeHtmlRenderConfig {
  enabled: boolean;
  candidates: string[];
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

function cleanCandidates(value: string | undefined): {
  candidates: string[];
  overridden: boolean;
} {
  const trimmed = value?.trim();
  if (!trimmed)
    return { candidates: [...DEFAULT_CANDIDATES], overridden: false };
  return { candidates: [trimmed], overridden: trimmed.startsWith("/") };
}

export function resolveNativeHtmlRenderConfig(
  env: Record<string, string | undefined> = process.env,
): NativeHtmlRenderConfig {
  const { candidates, overridden } = cleanCandidates(
    env.PDFXYZ_HTML_RENDER_CHROMIUM_BIN ?? env.PDFXYZ_CHROMIUM_BIN,
  );
  const tmpDir = env.PDFXYZ_HTML_RENDER_TMPDIR?.trim() || undefined;
  return {
    enabled: parseEnabled(
      env.PDFXYZ_HTML_RENDER ?? env.PDFXYZ_NATIVE_HTML_RENDER,
    ),
    candidates,
    overridden,
    timeoutMs: parsePositiveInt(env.PDFXYZ_HTML_RENDER_TIMEOUT_MS, 120_000),
    maxInputBytes: parsePositiveInt(
      env.PDFXYZ_HTML_RENDER_MAX_INPUT_BYTES,
      HTML_RENDER_DEFAULT_MAX_INPUT_BYTES,
    ),
    maxOutputBytes: parsePositiveInt(
      env.PDFXYZ_HTML_RENDER_MAX_OUTPUT_BYTES,
      100 * 1024 * 1024,
    ),
    ...(tmpDir ? { tmpDir } : {}),
  };
}

export const HTML_TO_PDF_TOOL = "html-to-pdf";
export const WEBPAGE_TO_PDF_TOOL = "webpage-to-pdf";
/**
 * The tools the Chromium renderer serves, in this import-free module (and
 * re-exported by `engine.ts`) so the tool page's ceiling lookup can read them
 * without pulling the server engine into the browser bundle.
 */
export const HTML_RENDER_TOOLS = [
  HTML_TO_PDF_TOOL,
  WEBPAGE_TO_PDF_TOOL,
] as const;

/**
 * The most the HTML renderer accepts per uploaded file — the number the HTML
 * to PDF page states. It used to state the upload gate's 100 MB while this
 * engine refused anything over 20 MB, after the upload.
 *
 * `PDFXYZ_HTML_RENDER_MAX_INPUT_BYTES` can only RAISE it, for the same reason
 * as the Office converter's: the page cannot see a worker's env.
 */
export const HTML_RENDER_MAX_INPUT_BYTES = 20 * 1024 * 1024;

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "auto"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

const DEFAULT_CANDIDATES = [
  "chromium",
  "chromium-browser",
  "google-chrome",
  "google-chrome-stable",
];

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
    maxInputBytes: Math.max(
      parsePositiveInt(
        env.PDFXYZ_HTML_RENDER_MAX_INPUT_BYTES,
        HTML_RENDER_MAX_INPUT_BYTES,
      ),
      HTML_RENDER_MAX_INPUT_BYTES,
    ),
    maxOutputBytes: parsePositiveInt(
      env.PDFXYZ_HTML_RENDER_MAX_OUTPUT_BYTES,
      100 * 1024 * 1024,
    ),
    ...(tmpDir ? { tmpDir } : {}),
  };
}

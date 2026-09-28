/**
 * The tools the Chromium renderer serves live in the leaf `./tools` (the web
 * tier states and enforces this engine's ceiling through
 * `@/lib/workers/engine-file-ceilings`). They are re-exported here so the
 * engine's tool list and its input cap sit in one module: the guard that walks
 * every `*native-config.ts` links an engine to the ceiling it declares by the
 * identity of this list.
 */
export {
  HTML_RENDER_TOOLS,
  HTML_TO_PDF_TOOL,
  WEBPAGE_TO_PDF_TOOL,
} from "./tools";

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "auto"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

const DEFAULT_CANDIDATES = [
  "chromium",
  "chromium-browser",
  "google-chrome",
  "google-chrome-stable",
];

/**
 * The largest HTML input Chromium is handed by default, in bytes — and the
 * figure the HTML to PDF page states, through
 * `@/lib/workers/engine-file-ceilings`. It used to state the upload gate's
 * 100 MB while this engine refused anything over 20 MB, after the upload.
 *
 * The web tier cannot read the worker's environment, so the published number
 * is this CODE default, and `PDFXYZ_HTML_RENDER_MAX_INPUT_BYTES` can only
 * RAISE the engine's limit, never lower it: an override below this figure
 * would make the page overstate what the renderer accepts, and a file between
 * the two would be uploaded in full and then refused. A raised limit is
 * harmless and unreachable — the upload API refuses above this figure anyway.
 * To publish a different figure, change this constant.
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
    maxInputBytes: Math.max(
      parsePositiveInt(
        env.PDFXYZ_HTML_RENDER_MAX_INPUT_BYTES,
        HTML_RENDER_DEFAULT_MAX_INPUT_BYTES,
      ),
      HTML_RENDER_DEFAULT_MAX_INPUT_BYTES,
    ),
    maxOutputBytes: parsePositiveInt(
      env.PDFXYZ_HTML_RENDER_MAX_OUTPUT_BYTES,
      100 * 1024 * 1024,
    ),
    ...(tmpDir ? { tmpDir } : {}),
  };
}

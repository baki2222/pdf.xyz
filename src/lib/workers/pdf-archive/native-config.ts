import { PDF_ARCHIVE_DEFAULT_TIMEOUT_MS } from "./contract";

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "auto"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

/**
 * Where the worker image puts the sRGB ICC profile the PDF/A OutputIntent
 * embeds. The Dockerfile's worker stage copies Ghostscript's own `srgb.icc` to
 * exactly this path and fails the build if it cannot find one;
 * `src/deploy/artifacts.test.ts` pins the two together.
 */
export const DEFAULT_PDFA_ICC_PROFILE = "/usr/share/pdfxyz/srgb.icc";

export interface NativePdfArchiveConfig {
  enabled: boolean;
  binary: string;
  overridden: boolean;
  /**
   * Absolute path of the RGB ICC profile embedded as the PDF/A OutputIntent.
   * Without it the output carries a PDF/A claim no validator accepts, so the
   * engine is reported NOT available when this file is missing.
   */
  iccProfile: string;
  /**
   * qpdf, used only after Ghostscript fails, to tell an open-password PDF
   * (which the user can fix with Unlock PDF) from a file that is broken.
   */
  qpdfBinary: string;
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
  if (!trimmed) return { binary: "gs", overridden: false };
  return { binary: trimmed, overridden: trimmed.startsWith("/") };
}

export function resolveNativePdfArchiveConfig(
  env: Record<string, string | undefined> = process.env,
): NativePdfArchiveConfig {
  const { binary, overridden } = cleanBinary(
    env.PDFXYZ_PDF_ARCHIVE_GS_BIN ?? env.PDFXYZ_GHOSTSCRIPT_BIN,
  );
  const tmpDir = env.PDFXYZ_PDF_ARCHIVE_TMPDIR?.trim() || undefined;
  const icc = env.PDFXYZ_PDF_ARCHIVE_ICC_PROFILE?.trim();
  const qpdf = env.PDFXYZ_PDF_SECURITY_QPDF_BIN?.trim();
  return {
    enabled: parseEnabled(
      env.PDFXYZ_PDF_ARCHIVE ?? env.PDFXYZ_NATIVE_PDF_ARCHIVE,
    ),
    binary,
    overridden,
    // Absolute paths only: the profile path is handed to Ghostscript's
    // `--permit-file-read`, and a relative one would resolve against whatever
    // directory the daemon happened to start in.
    iccProfile: icc && icc.startsWith("/") ? icc : DEFAULT_PDFA_ICC_PROFILE,
    qpdfBinary: qpdf && qpdf.startsWith("/") ? qpdf : "qpdf",
    timeoutMs: parsePositiveInt(
      env.PDFXYZ_PDF_ARCHIVE_TIMEOUT_MS,
      PDF_ARCHIVE_DEFAULT_TIMEOUT_MS,
    ),
    maxInputBytes: parsePositiveInt(
      env.PDFXYZ_PDF_ARCHIVE_MAX_INPUT_BYTES,
      200 * 1024 * 1024,
    ),
    maxOutputBytes: parsePositiveInt(
      env.PDFXYZ_PDF_ARCHIVE_MAX_OUTPUT_BYTES,
      300 * 1024 * 1024,
    ),
    ...(tmpDir ? { tmpDir } : {}),
  };
}

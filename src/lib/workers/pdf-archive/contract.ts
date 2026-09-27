/**
 * The two facts the PDF/A worker and the browser panel must agree on, in a
 * leaf module with no imports so the client bundle can read them without
 * pulling in the engine (and pdf-lib) behind them.
 */

/**
 * The job error code for an input that needs an OPEN password. The worker
 * writes it; the panel keys its "Unlock it first" link on it.
 */
export const PDF_ARCHIVE_PASSWORD_REQUIRED_CODE = "password_required";

/**
 * Default Ghostscript budget per job (`PDFXYZ_PDF_ARCHIVE_TIMEOUT_MS` overrides
 * it on the worker). The browser's poll ceiling is derived from this, so a
 * client never gives up on a job the worker is still allowed to be running.
 */
export const PDF_ARCHIVE_DEFAULT_TIMEOUT_MS = 120_000;

/**
 * The longest the worker spends deciding whether a FAILED conversion was an
 * open-password file (a qpdf probe, run only after Ghostscript fails). Part of
 * a job's worst case, so part of what the browser must be willing to wait.
 */
export const PDF_ARCHIVE_PASSWORD_PROBE_TIMEOUT_MS = 30_000;

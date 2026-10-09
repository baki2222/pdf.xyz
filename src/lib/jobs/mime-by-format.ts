/**
 * The exact MIME types each catalogue format is accepted as, and the one type
 * a client must DECLARE for a file of that format.
 *
 * A leaf module on purpose — no imports — so the browser job clients can use
 * it without pulling `validation.ts` (and through it the whole tool catalogue)
 * into the client bundle. `validation.ts` re-exports `MIME_BY_FORMAT` from
 * here, so the server's per-tool contract and the client's declaration are
 * literally the same table.
 *
 * ── WHY THE DECLARATION LIVES HERE ──────────────────────────────────────────
 *
 * Until 2026-09-27 the shared browser job runner (`runSecurityJob` in
 * `@/lib/workers/pdf-security-client`) declared every upload as
 * `application/pdf`, a constant written when that runner only served Protect
 * and Unlock. It was later reused for Word, Excel, PowerPoint and HTML to PDF,
 * and the intake rejects a `.docx` declared as a PDF — correctly:
 *
 *   POST /api/uploads {tool:"word-to-pdf", files:[{filename:"letter.docx",
 *                      contentType:"application/pdf"}]}
 *   → 415 "A file's declared type does not match its filename extension."
 *
 * Measured against production that day for all four tools. Every real user of
 * those four tools had been refused before a byte was uploaded — while
 * `worker:prove-tools` reported all four PASS, because the proof harness builds
 * its own requests with the right types and never runs the browser client.
 * The proof was measuring the path next to the one users take.
 *
 * `mime-by-format.test.ts` now sends the client's declaration for every format
 * of every upload-backed tool through the REAL intake gate and the REAL
 * per-tool validator, so the two cannot disagree again without a red test.
 */
export const MIME_BY_FORMAT: Record<string, readonly string[]> = {
  PDF: ["application/pdf"],
  DOC: ["application/msword"],
  DOCX: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  XLS: ["application/vnd.ms-excel"],
  XLSX: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  CSV: ["text/csv"],
  PPT: ["application/vnd.ms-powerpoint"],
  PPTX: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  JPG: ["image/jpeg", "image/jpg"],
  JPEG: ["image/jpeg", "image/jpg"],
  PNG: ["image/png"],
  HTML: ["text/html"],
  HTM: ["text/html"],
  MD: ["text/markdown", "text/plain"],
  MARKDOWN: ["text/markdown", "text/plain"],
  TXT: ["text/plain"],
};

/**
 * The filename extensions each format is recognised by, keyed by the SAME
 * labels as {@link MIME_BY_FORMAT} — so `JPEG`, `HTM` and `MARKDOWN` stay keys
 * of their own, looked up by a tool's raw `accept` token. Each label's own
 * spelling, plus the two extra spellings an in-browser runner already opens:
 * `.text` (Text to PDF) and `.mdown` (Markdown to PDF). Recognising a file by
 * a narrower list than its runner would only cost a pick; a WIDER one would
 * carry a file the runner refuses.
 */
export const EXTENSIONS_BY_FORMAT: Record<string, readonly string[]> = {
  PDF: ["pdf"],
  DOC: ["doc"],
  DOCX: ["docx"],
  XLS: ["xls"],
  XLSX: ["xlsx"],
  CSV: ["csv"],
  PPT: ["ppt"],
  PPTX: ["pptx"],
  JPG: ["jpg"],
  JPEG: ["jpeg"],
  PNG: ["png"],
  HTML: ["html"],
  HTM: ["htm"],
  MD: ["md", "mdown"],
  MARKDOWN: ["markdown"],
  TXT: ["txt", "text"],
};

/** The labels that are another spelling of one format. */
const FORMAT_ALIASES: Readonly<Record<string, string>> = {
  JPEG: "JPG",
  HTM: "HTML",
  MARKDOWN: "MD",
};

/**
 * One spelling per format: JPEG is JPG, HTM is HTML, MARKDOWN is MD; every
 * other label is itself, upper-cased. For comparing formats ("does this tool
 * take what that one makes?") — never apply it before a
 * {@link MIME_BY_FORMAT} lookup, whose aliases are keys of their own.
 */
export function normalizeFormatLabel(label: string): string {
  const upper = label.trim().toUpperCase();
  return FORMAT_ALIASES[upper] ?? upper;
}

/**
 * The content type a client must declare for `filename`: the canonical (first)
 * MIME of its extension's format, or `null` when the extension is not a format
 * any tool accepts — the caller then refuses locally with a clear message
 * rather than sending a request the server is certain to reject.
 */
export function declaredContentTypeFor(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return null;
  const format = filename.slice(dot + 1).toUpperCase();
  return MIME_BY_FORMAT[format]?.[0] ?? null;
}

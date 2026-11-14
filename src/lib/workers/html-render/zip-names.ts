/**
 * The part of HTML to PDF's ZIP rules the page needs on its FIRST load — is
 * this a ZIP, what to say when the worker cannot open one, and how a URL at
 * the document origin names an archive entry (which the missing-files note
 * resolves exactly as the worker does) — split from `./zip-config` so the
 * entry rules, bounds and refusal words load only with the ZIP picker. A
 * LEAF with no imports; `./zip-config` re-exports all of it.
 */

/**
 * Where a document is served from, for Chromium's eyes only. The SAME value
 * as `HTML_DOCUMENT_URL` in `./document-url` (`zip-site.test.ts` holds the
 * two equal through `zipEntryUrl`), written out because this module stays
 * import-free.
 */
const DOCUMENT_URL = "https://document.invalid/";

/** True for a file name a ZIP upload is recognised by. */
export function isZipName(name: string): boolean {
  return /\.zip$/i.test(name.trim());
}

/**
 * The refusal when a ZIP reaches an API while the running worker cannot
 * print one (`htmlZip` absent or false on the live heartbeat). The page
 * stops offering ZIP on the same signal, so a reader meets this only when
 * the worker changed between the page's check and the upload, or from a
 * direct API call.
 */
export const HTML_ZIP_NOT_RUNNING_MESSAGE =
  "Our server can't open ZIP files for HTML to PDF right now, so this ZIP was not converted. Upload the page's .html file on its own, with its pictures and styles embedded or linked by full https:// addresses.";

/** Why a ZIP cannot be printed. Each is final: the same archive fails alike. */

/**
 * The archive entry a URL at the document origin names, or null: for any
 * other URL, for a path that ends in `/`, and for any segment that is empty
 * or decodes to `.`, `..`, or something holding `/`, `\` or NUL. Never
 * clamped and never reinterpreted: a request that does not name an entry
 * exactly is answered 404.
 */
export function zipEntryOfUrl(url: string): string | null {
  if (!url.startsWith(DOCUMENT_URL)) return null;
  const rest = url.slice(DOCUMENT_URL.length).replace(/[?#].*$/s, "");
  if (rest === "" || rest.endsWith("/")) return null;
  const out: string[] = [];
  for (const raw of rest.split("/")) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      segment.includes("/") ||
      segment.includes("\\") ||
      segment.includes("\0")
    )
      return null;
    out.push(segment);
  }
  return out.join("/");
}

/** The URL Chromium is sent to for the entry at archive path `name`. */
export function zipEntryUrl(name: string): string {
  return DOCUMENT_URL + name.split("/").map(encodeURIComponent).join("/");
}

/**
 * How an HTML document's charset is decided when it is served to Chromium:
 * an uploaded HTML file (`./native.ts`) and every HTML entry of a ZIP page
 * (`./zip-site.ts`) go through the one function here, so a ZIP's pages read
 * exactly as the same files uploaded one by one would. Moved out of
 * `./native.ts` on 2026-11-14, unchanged, so the engine can use it without
 * importing the renderer.
 */

/** A byte-order mark: UTF-8, UTF-16 BE or UTF-16 LE. */
function startsWithBom(bytes: Uint8Array): boolean {
  return (
    (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) ||
    (bytes[0] === 0xfe && bytes[1] === 0xff) ||
    (bytes[0] === 0xff && bytes[1] === 0xfe)
  );
}

/** How far Chromium's prescan looks for a `<meta>` declaration, in bytes. */
const CHARSET_PRESCAN_BYTES = 1024;

/** One `<meta ...>` tag's attributes, as written. */
const META_TAG =
  /<meta\b((?:\s+[^\s>"'/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?|\s*\/)*)\s*>/gi;
const ATTRIBUTE =
  /([^\s>"'/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** True when `label` names an encoding a browser knows. */
function isEncodingLabel(label: string): boolean {
  try {
    new TextDecoder(label.trim());
    return true;
  } catch {
    return false;
  }
}

/**
 * True when the file declares its own encoding where Chromium looks for one:
 * in the first {@link CHARSET_PRESCAN_BYTES} bytes, outside comments, a
 * `<meta>` whose OWN `charset` attribute names a real encoding, or a
 * `<meta http-equiv="content-type" content="...; charset=...">`. Read as
 * latin1 so any byte sequence is searchable; the markup is ASCII in every
 * encoding Chromium sniffs. "charset=" in prose, in another meta's
 * `content`, or in a comment is not a declaration (review of 9b169477).
 */
function declaresCharset(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, CHARSET_PRESCAN_BYTES))
    .toString("latin1")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  for (const [, attrs = ""] of head.matchAll(META_TAG)) {
    const named = new Map<string, string>();
    for (const [, name, dq, sq, bare] of attrs.matchAll(ATTRIBUTE))
      if (!named.has(name!.toLowerCase()))
        named.set(name!.toLowerCase(), dq ?? sq ?? bare ?? "");
    const charset = named.get("charset");
    if (charset !== undefined && isEncodingLabel(charset)) return true;
    const content = /charset\s*=\s*["']?([^"';\s]+)/i.exec(
      named.get("content") ?? "",
    );
    if (
      named.get("http-equiv")?.trim().toLowerCase() === "content-type" &&
      content &&
      isEncodingLabel(content[1]!)
    )
      return true;
  }
  return false;
}

/**
 * The Content-Type an uploaded HTML document is served with.
 *
 * A BOM or a declared charset is left to Chromium (an HTTP charset would
 * OVERRIDE the `<meta>` — the header outranks it), so a legacy-encoded upload
 * that says what it is reads exactly as it says. A file that declares nothing
 * falls to Chromium's default, windows-1252 — which turned every UTF-8
 * "café" into "cafÃ©" while the job succeeded (audit #5, 2026-11-06). Such a
 * file is served as UTF-8 when its bytes ARE valid UTF-8, which is the only
 * reading in which they are text at all; otherwise it keeps the old default.
 */
export function htmlDocumentContentType(bytes: Uint8Array): string {
  if (startsWithBom(bytes)) return "text/html";
  if (declaresCharset(bytes)) return "text/html";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "text/html; charset=utf-8";
  } catch {
    return "text/html";
  }
}

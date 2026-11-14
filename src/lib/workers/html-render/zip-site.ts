/**
 * A ZIP of a web page, opened for Chromium: the page to print, and every
 * other file of the archive served at the synthetic document origin
 * (`HTML_DOCUMENT_URL`), so `style.css`, `images/logo.png` and a "Save page
 * as" export's `Page_files/` load from the archive instead of from nowhere.
 *
 * WHAT IS OPENED, AND HOW. Through the ONE bounded ZIP reader
 * (`../epub/zip.ts`): its central directory is judged against HTML to PDF's
 * own bounds (`./zip-config.ts`, measured on real saved pages) before
 * anything is inflated, every inflate is capped at the size the directory
 * declared, and ZIP64 is refused.
 *
 * WHAT IS SERVED ({@link zipEntryOfUrl}). A request at the document origin
 * names an entry by its URL path: percent-decoded segment by segment, looked
 * up CASE-SENSITIVELY, exactly as the archive spells it. Nothing else:
 *   - no traversal: Chromium resolves `..` against the URL before it asks,
 *     so a reference can never climb above the origin's root; a segment that
 *     DECODES to `.` or `..` (`%2e%2e`), or holds a `/` or a `\` once
 *     decoded, is refused rather than reinterpreted;
 *   - nothing absolute: an archive entry named `/etc/x` or `../x` can never
 *     be asked for, because no requested name has a leading `/` or a `..`;
 *   - never a folder, never a symbolic link (the directory says which), and
 *     never an encrypted entry or one whose bytes do not match the directory;
 *   - each with the Content-Type of its extension ({@link contentTypeOfEntry})
 *     and `X-Content-Type-Options: nosniff`, so Chromium never guesses.
 * Every request anywhere else goes through `./network.ts` exactly as an
 * uploaded HTML file's do: public http(s) only. And every request AT the
 * origin spends that render network's own request and byte budgets
 * (`chargeServed`, called by the renderer before it answers), so a page
 * asking for its own files a thousand times is refused past them —
 * `zip-site.chromium.test.ts` holds both budgets through a real Chromium.
 */
import { openBoundedZip, ZipEntryError, type BoundedZip } from "../epub/zip";
import {
  HTML_ZIP_MAX_ENTRIES,
  HTML_ZIP_MAX_ENTRY_RATIO,
  HTML_ZIP_MAX_UNPACKED_BYTES,
  HTML_ZIP_RATIO_FLOOR_BYTES,
  chooseHtmlEntry,
  isServableEntryName,
  zipEntryOfUrl,
  zipEntryUrl,
  type HtmlZipRefusal,
} from "./zip-config";

// The refusals' words and the URL ↔ entry mapping live in the leaf
// `./zip-config`, so the browser says and resolves exactly what this does.
export {
  htmlZipRefusalMessage,
  zipEntryOfUrl,
  zipEntryUrl,
  type HtmlZipRefusal,
} from "./zip-config";

export const HTML_ZIP_LIMITS = {
  maxEntries: HTML_ZIP_MAX_ENTRIES,
  maxUnpackedBytes: HTML_ZIP_MAX_UNPACKED_BYTES,
  maxEntryRatio: HTML_ZIP_MAX_ENTRY_RATIO,
  ratioFloorBytes: HTML_ZIP_RATIO_FLOOR_BYTES,
} as const;

/** True when `bytes` begin as a ZIP does (a local file header, or an empty archive). */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06))
  );
}

const TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  html: "text/html",
  htm: "text/html",
  xhtml: "application/xhtml+xml",
  xht: "application/xhtml+xml",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  map: "application/json",
  xml: "application/xml",
  txt: "text/plain",
  svg: "image/svg+xml",
  png: "image/png",
  apng: "image/apng",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  cur: "image/x-icon",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  eot: "application/vnd.ms-fontobject",
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  vtt: "text/vtt",
};

/**
 * The Content-Type an entry is served with, from its extension (lower-cased).
 * An extension not listed is `application/octet-stream`, which Chromium will
 * not render as a page or run as a script: with `nosniff`, a file is only
 * ever what its name says.
 */
export function contentTypeOfEntry(name: string): string {
  const slash = name.lastIndexOf("/");
  const base = name.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  return TYPE_BY_EXTENSION[ext] ?? "application/octet-stream";
}

export interface ServedEntry {
  body: Uint8Array;
  contentType: string;
}

/** A ZIP page ready for Chromium: where to navigate, and what to answer. */
export interface HtmlSite {
  /** The page to print, at the document origin. */
  entryUrl: string;
  /** Its archive path. */
  entry: string;
  /** The entry for a URL Chromium asked for (GET); null = 404. */
  serve(url: string): ServedEntry | null;
}

/**
 * Open a ZIP page: judge the archive, choose the page (`requested`, or the
 * one {@link chooseHtmlEntry} picks), and return what Chromium is served.
 * `htmlContentType` decides an HTML entry's charset exactly as an uploaded
 * HTML file's is decided (`htmlDocumentContentType` in `./native.ts`, passed
 * in so this module stays free of the renderer).
 */
export function openHtmlZip(
  bytes: Uint8Array,
  requested: string | undefined,
  htmlContentType: (body: Uint8Array) => string,
): { ok: true; site: HtmlSite } | { ok: false; refusal: HtmlZipRefusal } {
  const opened = openBoundedZip(bytes, HTML_ZIP_LIMITS);
  if (!opened.ok)
    return {
      ok: false,
      refusal:
        opened.refusal.kind === "bomb"
          ? { kind: "bomb", limit: opened.refusal.limit }
          : { kind: "unreadable" },
    };
  const zip = opened.zip;
  const servable = (name: string) =>
    zip.has(name) &&
    isServableEntryName(name) &&
    !zip.isDirectory(name) &&
    !zip.isSymlink(name) &&
    !zip.isEncrypted(name);
  // Folders and links are not files: neither can be the page.
  const names = zip.names.filter(servable);
  let entry: string;
  if (requested !== undefined) {
    if (!names.includes(requested))
      return { ok: false, refusal: { kind: "entry_not_found" } };
    entry = requested;
  } else {
    const choice = chooseHtmlEntry(names);
    if (choice.kind === "none")
      return { ok: false, refusal: { kind: "no_html" } };
    if (choice.kind === "choose")
      return {
        ok: false,
        refusal: { kind: "choose_entry", count: choice.candidates.length },
      };
    entry = choice.entry;
  }
  // The page itself must inflate: a page that cannot be read would print an
  // empty 404, which is not the page.
  if (readEntry(zip, entry) === null)
    return { ok: false, refusal: { kind: "unreadable" } };

  const cache = new Map<string, ServedEntry | null>();
  return {
    ok: true,
    site: {
      entry,
      entryUrl: zipEntryUrl(entry),
      serve(url) {
        const name = zipEntryOfUrl(url);
        if (name === null || !servable(name)) return null;
        const hit = cache.get(name);
        if (hit !== undefined) return hit;
        const body = readEntry(zip, name);
        const type = contentTypeOfEntry(name);
        const served =
          body === null
            ? null
            : {
                body,
                contentType:
                  type === "text/html" ? htmlContentType(body) : type,
              };
        cache.set(name, served);
        return served;
      },
    },
  };
}

/** An entry's bytes, or null when the archive lied about them. */
function readEntry(zip: BoundedZip, name: string): Uint8Array | null {
  try {
    return zip.read(name);
  } catch (error) {
    if (error instanceof ZipEntryError) return null;
    throw error;
  }
}

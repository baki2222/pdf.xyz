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
import type { RenderNetwork } from "./network";
import {
  HTML_ZIP_LIMITS,
  HTML_ZIP_MAX_DOCUMENT_BYTES,
  chooseHtmlEntry,
  isServableEntryName,
  zipEntryOfUrl,
  zipEntryUrl,
  type HtmlZipRefusal,
} from "./zip-config";

// The refusals' words and the URL ↔ entry mapping live in the leaf
// `./zip-config`, so the browser says and resolves exactly what this does.
export {
  HTML_ZIP_LIMITS,
  htmlZipRefusalMessage,
  zipEntryOfUrl,
  zipEntryUrl,
  type HtmlZipRefusal,
} from "./zip-config";

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
  /** The page's own size, unpacked: judged against the HTML file ceiling. */
  entryBytes: number;
  /**
   * The servable entry a URL names, WITHOUT reading it: the size the
   * directory declared (which every inflate is capped at, and must equal),
   * and whether Chromium lays it out as a document ({@link isDocumentType}).
   * Null = 404. What {@link answerArchiveRequest} charges before anything is
   * inflated.
   */
  lookup(url: string): { bytes: number; document: boolean } | null;
  /** The entry for a URL Chromium asked for (GET); null = 404. */
  serve(url: string): ServedEntry | null;
  /**
   * Bytes of documents (HTML, XHTML, SVG) this render may still be answered
   * from the archive, the page included: starts at
   * `HTML_ZIP_MAX_DOCUMENT_BYTES`, spent by {@link answerArchiveRequest}.
   */
  documentBytesLeft: number;
}

/**
 * The types Chromium lays out as a DOCUMENT of its own — a page, a frame, an
 * SVG drawn as an image — whose memory grows with its markup: a 20 MiB HTML
 * file of text peaks near 4 GiB of Chromium, a 20 MiB SVG near 2.7 GiB
 * (hostile review round 3, 2026-11-14). A stylesheet, script, picture or
 * font is not one.
 */
export function isDocumentType(contentType: string): boolean {
  return (
    contentType === "text/html" ||
    contentType === "application/xhtml+xml" ||
    contentType === "image/svg+xml"
  );
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
  const page = readEntry(zip, entry);
  if (page === null) return { ok: false, refusal: { kind: "unreadable" } };

  const cache = new Map<string, ServedEntry | null>();
  return {
    ok: true,
    site: {
      entry,
      entryBytes: page.byteLength,
      entryUrl: zipEntryUrl(entry),
      documentBytesLeft: HTML_ZIP_MAX_DOCUMENT_BYTES,
      lookup(url) {
        const name = zipEntryOfUrl(url);
        if (name === null || !servable(name)) return null;
        return {
          bytes: zip.sizeOf(name) ?? 0,
          document: isDocumentType(contentTypeOfEntry(name)),
        };
      },
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

/** What Chromium is told for one request at the document origin. */
export type ArchiveAnswer =
  /** Past a budget of the render network: fail the request. */
  | { action: "fail"; why: string }
  | {
      action: "fulfill";
      status: 200 | 404;
      headers: { name: string; value: string }[];
      /** The entry's bytes; null for a 404. */
      body: Uint8Array | null;
    };

/**
 * The answer to ONE request Chromium makes at the document origin of a ZIP
 * page: the entry it names (GET only; 404 for anything else), CHARGED to
 * the render's network before it is answered — one request, and the body's
 * bytes against `maxResponseBytes` and the byte budget — so a page cannot
 * ask for its own files past the limits a fetched page has. A document
 * (`isDocumentType`) is charged to the site's document budget too.
 *
 * CHARGED BEFORE IT IS READ (hostile review round 3, 2026-11-14). The
 * charge is the size the directory declared (`site.lookup`), and the entry
 * is inflated only once every budget admitted it. Until then the entry was
 * inflated, and cached, first: the budgets refused the ANSWER, but the
 * bytes were already in the worker's heap, so with the directory's bounds
 * removed 80 entries of 20 MiB took Node from 206 to 2,323 MiB while every
 * answer past 100 MiB was refused. The inflate is capped at the declared
 * size and must equal it (`../epub/zip.ts`), so the charge is the body.
 *
 * ONE function, called by the renderer for every such request
 * (`./native.ts`) AND by the start-up proof (`./zip-capability.ts`), so the
 * heartbeat's `htmlZip` says the serving is bounded in THIS image, not only
 * that ZIPs are opened (hostile review round 2, 2026-11-14: an image whose
 * renderer served entries uncharged would have published `htmlZip: true`).
 */
export function answerArchiveRequest(
  site: Pick<HtmlSite, "lookup" | "serve" | "documentBytesLeft">,
  network: Pick<RenderNetwork, "chargeServed">,
  request: { method: string; url: string },
): ArchiveAnswer {
  const found = request.method === "GET" ? site.lookup(request.url) : null;
  if (found?.document && found.bytes > site.documentBytesLeft)
    return {
      action: "fail",
      why: "document budget of this ZIP's render is spent",
    };
  const refused = network.chargeServed(found ? found.bytes : 0);
  if (refused !== null) return { action: "fail", why: refused };
  if (found?.document) site.documentBytesLeft -= found.bytes;
  const hit = found ? site.serve(request.url) : null;
  return {
    action: "fulfill",
    status: hit ? 200 : 404,
    headers: [
      { name: "Content-Type", value: hit ? hit.contentType : "text/plain" },
      { name: "X-Content-Type-Options", value: "nosniff" },
    ],
    body: hit ? hit.body : null,
  };
}

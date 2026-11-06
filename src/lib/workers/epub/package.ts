/**
 * An EPUB, opened: the bounded ZIP (`./zip`), the package document it names,
 * the reading order, the table of contents, and which files may be served to
 * Chromium.
 *
 * The chain is the one every reading system walks, and nothing is guessed
 * from file names:
 *
 *   `mimetype` (first, stored) → `META-INF/container.xml` → the package (OPF)
 *   → its manifest and spine → the EPUB 3 navigation document, or the EPUB 2
 *   NCX the spine names.
 *
 * Every path in the book is resolved by {@link resolveInBook}: percent-
 * decoded, `.` and `..` applied, and REFUSED (null) when `..` would climb
 * above the book's root. A URL Chromium asks for at the synthetic document
 * origin goes through the same function (`entryPathOfUrl`), so nothing
 * outside the ZIP's own tree can be named, and nothing but ZIP entries is
 * ever served.
 */
import { sniffFormat } from "@/lib/intent/sniff";
import { HTML_DOCUMENT_URL } from "../html-render/document-url";
import { EPUB_MAX_SPINE_ITEMS, EPUB_MAX_XML_BYTES } from "./native-config";
import { openBoundedZip, ZipEntryError, type BoundedZip } from "./zip";
import {
  childElements,
  findAll,
  findFirst,
  parseXml,
  textOf,
  type XmlElement,
} from "./xml";

/**
 * The two font-obfuscation algorithms EPUB defines. They scramble the start
 * of an embedded font so it cannot be lifted out of the book and installed;
 * they protect nothing else, and a book that uses only these is NOT DRM.
 */
export const FONT_OBFUSCATION_ALGORITHMS: readonly string[] = [
  "http://www.idpf.org/2008/embedding",
  "http://ns.adobe.com/pdf/enc#RC",
];

export type EpubRefusal =
  | { kind: "not_epub" }
  | { kind: "unreadable" }
  | { kind: "bomb"; limit: "entries" | "unpacked" | "ratio" }
  | { kind: "drm" }
  | { kind: "no_package" }
  | { kind: "missing_item" }
  | { kind: "escapes_root" }
  | { kind: "no_chapters" }
  | { kind: "too_many_chapters"; count: number };

/** One chapter file to print, in reading order. */
export interface EpubChapter {
  /** Its path inside the ZIP. */
  path: string;
  /**
   * For a fixed-layout (pre-paginated) page: the viewport its own
   * `<meta name="viewport">` declares, in CSS pixels. Null for a reflowable
   * chapter, and for a fixed-layout page that declares none.
   */
  viewport: { width: number; height: number } | null;
}

/** A table-of-contents entry, already pointed at a chapter. */
export interface EpubTocEntry {
  title: string;
  /** Index into {@link EpubBook.chapters}. */
  chapter: number;
  children: EpubTocEntry[];
}

export interface EpubBook {
  zip: BoundedZip;
  title: string | null;
  language: string | null;
  chapters: EpubChapter[];
  toc: EpubTocEntry[];
  /** Where the outline came from. */
  tocSource: "nav" | "ncx" | null;
  /** Font files scrambled by font obfuscation: never served. */
  obfuscatedFonts: ReadonlySet<string>;
  /** True when the package says the whole book is pre-paginated. */
  fixedLayout: boolean;
  /** An entry's bytes and type for a URL Chromium asked for; null = 404. */
  serve(url: string): { body: Uint8Array; contentType: string } | null;
}

export type OpenEpubResult =
  { ok: true; book: EpubBook } | { ok: false; refusal: EpubRefusal };

/* ------------------------------------------------------------------ *
 *  Paths
 * ------------------------------------------------------------------ */

/**
 * `href` resolved against the directory `baseDir` (a ZIP path ending in `/`,
 * or `""` for the root): fragment and query dropped, percent-decoded, `.` and
 * `..` applied. NULL when `..` climbs above the root, when the reference is
 * not a path (it has a scheme: `https:`, `data:`, `file:`), when it cannot be
 * decoded, or when it holds a NUL or a backslash. Never clamped: a reference
 * that escapes is refused, not quietly pointed at the root.
 */
export function resolveInBook(baseDir: string, href: string): string | null {
  const bare = href.replace(/[?#].*$/s, "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(bare)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const joined = decoded.startsWith("/") ? decoded : baseDir + decoded;
  const out: string[] = [];
  for (const segment of joined.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.length === 0 ? null : out.join("/");
}

/** The directory part of a ZIP path, with its trailing slash ("" at root). */
export const dirOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";

/**
 * The ZIP path a URL at the synthetic document origin names, or null for any
 * other URL. The origin is the HTML renderer's (`HTML_DOCUMENT_URL`): `.invalid`
 * is reserved, so no real host can ever answer it.
 */
export function entryPathOfUrl(url: string): string | null {
  if (!url.startsWith(HTML_DOCUMENT_URL)) return null;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  return resolveInBook("", pathname);
}

/** The URL Chromium is sent to for a chapter at ZIP path `path`. */
export function chapterUrl(path: string): string {
  return HTML_DOCUMENT_URL + path.split("/").map(encodeURIComponent).join("/");
}

const TYPE_BY_EXTENSION: Record<string, string> = {
  xhtml: "application/xhtml+xml",
  xht: "application/xhtml+xml",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  svg: "image/svg+xml",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

/* ------------------------------------------------------------------ *
 *  Opening
 * ------------------------------------------------------------------ */

const SNIFF_BYTES = 4096;
const MAX_TOC_ENTRIES = 5_000;
const MAX_TOC_DEPTH = 16;

function readXml(zip: BoundedZip, path: string): XmlElement | null {
  const size = zip.sizeOf(path);
  if (size === null || size > EPUB_MAX_XML_BYTES) return null;
  try {
    const bytes = zip.read(path);
    return bytes ? parseXml(new TextDecoder().decode(bytes)) : null;
  } catch (error) {
    if (error instanceof ZipEntryError) return null;
    throw error;
  }
}

/** The viewport a fixed-layout page's `<meta name="viewport">` declares. */
export function declaredViewport(
  html: string,
): { width: number; height: number } | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\bname\s*=\s*["']viewport["']/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const value = content?.[1] ?? content?.[2] ?? "";
    const width = /\bwidth\s*=\s*([0-9.]+)/i.exec(value)?.[1];
    const height = /\bheight\s*=\s*([0-9.]+)/i.exec(value)?.[1];
    const w = Number(width);
    const h = Number(height);
    if (w > 0 && h > 0 && w <= 10_000 && h <= 10_000)
      return { width: Math.round(w), height: Math.round(h) };
  }
  return null;
}

/**
 * Open an EPUB, or say why it cannot be converted. Reads the ZIP's directory,
 * `mimetype`, `encryption.xml`, the container, the package, and the nav or
 * NCX — and, for fixed-layout pages, the head of each page for its viewport.
 */
export function openEpub(bytes: Uint8Array): OpenEpubResult {
  // The site's own recogniser, asked WITHOUT the name: the bytes must say
  // EPUB (a ZIP whose first entry is a stored `mimetype` reading
  // application/epub+zip). A .docx renamed .epub stops here.
  if (sniffFormat(bytes.subarray(0, SNIFF_BYTES)) !== "EPUB")
    return { ok: false, refusal: { kind: "not_epub" } };
  const opened = openBoundedZip(bytes);
  if (!opened.ok) {
    const r = opened.refusal;
    return {
      ok: false,
      refusal:
        r.kind === "bomb"
          ? { kind: "bomb", limit: r.limit }
          : { kind: "unreadable" },
    };
  }
  const zip = opened.zip;

  // DRM first: an encrypted book's package may itself be readable, but its
  // chapters are not, and printing their ciphertext is not a conversion.
  const obfuscatedFonts = new Set<string>();
  if (zip.has("META-INF/encryption.xml")) {
    const enc = readXml(zip, "META-INF/encryption.xml");
    if (!enc) return { ok: false, refusal: { kind: "drm" } };
    for (const data of findAll(enc, "encrypteddata")) {
      const algorithm = findFirst(data, "encryptionmethod")?.attrs.algorithm;
      const uri = findFirst(data, "cipherreference")?.attrs.uri;
      if (!algorithm || !FONT_OBFUSCATION_ALGORITHMS.includes(algorithm))
        return { ok: false, refusal: { kind: "drm" } };
      const path = uri ? resolveInBook("", uri) : null;
      if (path) obfuscatedFonts.add(path);
    }
  }
  if (zip.names.some((name) => zip.isEncrypted(name)))
    return { ok: false, refusal: { kind: "drm" } };

  const container = readXml(zip, "META-INF/container.xml");
  const rootfiles = container ? findAll(container, "rootfile") : [];
  const rootfile =
    rootfiles.find(
      (r) => r.attrs["media-type"] === "application/oebps-package+xml",
    ) ?? rootfiles[0];
  const opfPath = rootfile?.attrs["full-path"]
    ? resolveInBook("", rootfile.attrs["full-path"])
    : null;
  const opf = opfPath ? readXml(zip, opfPath) : null;
  if (!opfPath || !opf) return { ok: false, refusal: { kind: "no_package" } };
  const opfDir = dirOf(opfPath);

  const metadata = findFirst(opf, "metadata");
  const title = metadata ? findFirst(metadata, "title") : undefined;
  const language = metadata ? findFirst(metadata, "language") : undefined;
  const fixedLayout = (metadata ? findAll(metadata, "meta") : []).some(
    (m) =>
      m.attrs.property === "rendition:layout" && textOf(m) === "pre-paginated",
  );

  interface Item {
    path: string | null;
    type: string;
    properties: string[];
  }
  const items = new Map<string, Item>();
  const typeByPath = new Map<string, string>();
  const manifest = findFirst(opf, "manifest");
  for (const item of manifest ? childElements(manifest, "item") : []) {
    const id = item.attrs.id;
    const href = item.attrs.href;
    if (!id || href === undefined) continue;
    const path = resolveInBook(opfDir, href);
    const type = item.attrs["media-type"] ?? "";
    items.set(id, {
      path,
      type,
      properties: (item.attrs.properties ?? "").split(/\s+/).filter(Boolean),
    });
    if (path && type) typeByPath.set(path, type);
  }

  const spine = findFirst(opf, "spine");
  const chapters: EpubChapter[] = [];
  for (const ref of spine ? childElements(spine, "itemref") : []) {
    if ((ref.attrs.linear ?? "yes").trim().toLowerCase() === "no") continue;
    const item = ref.attrs.idref ? items.get(ref.attrs.idref) : undefined;
    if (!item) return { ok: false, refusal: { kind: "missing_item" } };
    if (item.path === null)
      return { ok: false, refusal: { kind: "escapes_root" } };
    if (!zip.has(item.path))
      return { ok: false, refusal: { kind: "missing_item" } };
    // Inflated once here, within its declared size, so a chapter whose
    // directory entry lies is refused now rather than printed as a 404.
    try {
      zip.read(item.path);
    } catch (error) {
      if (error instanceof ZipEntryError)
        return { ok: false, refusal: { kind: "unreadable" } };
      throw error;
    }
    const props = (ref.attrs.properties ?? "").split(/\s+/);
    const fixed = props.includes("rendition:layout-pre-paginated")
      ? true
      : props.includes("rendition:layout-reflowable")
        ? false
        : fixedLayout;
    chapters.push({
      path: item.path,
      viewport: fixed ? viewportOf(zip, item.path) : null,
    });
  }
  if (chapters.length === 0)
    return { ok: false, refusal: { kind: "no_chapters" } };
  if (chapters.length > EPUB_MAX_SPINE_ITEMS)
    return {
      ok: false,
      refusal: { kind: "too_many_chapters", count: chapters.length },
    };

  // The outline: EPUB 3's nav document, else the EPUB 2 NCX.
  const chapterIndex = new Map<string, number>();
  chapters.forEach((c, i) => {
    if (!chapterIndex.has(c.path)) chapterIndex.set(c.path, i);
  });
  let toc: EpubTocEntry[] = [];
  let tocSource: EpubBook["tocSource"] = null;
  const navItem = [...items.values()].find((i) => i.properties.includes("nav"));
  if (navItem?.path) {
    const nav = readXml(zip, navItem.path);
    if (nav) {
      toc = navToc(nav, dirOf(navItem.path), chapterIndex);
      if (toc.length > 0) tocSource = "nav";
    }
  }
  if (toc.length === 0) {
    const tocId = spine?.attrs.toc;
    const ncxItem =
      (tocId ? items.get(tocId) : undefined) ??
      [...items.values()].find((i) => i.type === "application/x-dtbncx+xml");
    const ncx = ncxItem?.path ? readXml(zip, ncxItem.path) : null;
    if (ncx && ncxItem?.path) {
      toc = ncxToc(ncx, dirOf(ncxItem.path), chapterIndex);
      if (toc.length > 0) tocSource = "ncx";
    }
  }

  const book: EpubBook = {
    zip,
    title: title ? textOf(title) || null : null,
    language: language ? textOf(language) || null : null,
    chapters,
    toc,
    tocSource,
    obfuscatedFonts,
    fixedLayout,
    serve(url) {
      const path = entryPathOfUrl(url);
      if (path === null || obfuscatedFonts.has(path)) return null;
      let body: Uint8Array | null;
      try {
        body = zip.read(path);
      } catch (error) {
        if (error instanceof ZipEntryError) return null;
        throw error;
      }
      if (!body) return null;
      const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
      const contentType =
        typeByPath.get(path) ??
        TYPE_BY_EXTENSION[ext] ??
        "application/octet-stream";
      return { body, contentType };
    },
  };
  return { ok: true, book };
}

function viewportOf(
  zip: BoundedZip,
  path: string,
): { width: number; height: number } | null {
  const size = zip.sizeOf(path);
  if (size === null || size > EPUB_MAX_XML_BYTES) return null;
  try {
    const bytes = zip.read(path);
    if (!bytes) return null;
    // The viewport lives in <head>: the first 64 KB is plenty.
    return declaredViewport(
      new TextDecoder().decode(bytes.subarray(0, 64 * 1024)),
    );
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 *  Table of contents
 * ------------------------------------------------------------------ */

interface RawEntry {
  title: string;
  href: string | null;
  children: RawEntry[];
}

/**
 * Point raw entries at chapters. An entry whose target is not a chapter
 * (a non-linear file, a file outside the book, no target at all) is kept
 * only as the heading of entries that are, and then opens the first of them.
 */
function pointAtChapters(
  raw: RawEntry[],
  baseDir: string,
  chapterIndex: Map<string, number>,
  budget: { left: number },
): EpubTocEntry[] {
  const out: EpubTocEntry[] = [];
  for (const entry of raw) {
    if (budget.left <= 0) break;
    budget.left -= 1;
    const children = pointAtChapters(
      entry.children,
      baseDir,
      chapterIndex,
      budget,
    );
    const path = entry.href ? resolveInBook(baseDir, entry.href) : null;
    const own = path === null ? undefined : chapterIndex.get(path);
    const chapter = own ?? children[0]?.chapter;
    if (chapter === undefined) continue;
    out.push({ title: entry.title || "Untitled", chapter, children });
  }
  return out;
}

function navToc(
  doc: XmlElement,
  baseDir: string,
  chapterIndex: Map<string, number>,
): EpubTocEntry[] {
  const navs = findAll(doc, "nav");
  const nav =
    navs.find((n) =>
      (n.attrs["epub:type"] ?? n.attrs.type ?? "").split(/\s+/).includes("toc"),
    ) ?? navs[0];
  const list = nav ? findFirst(nav, "ol") : undefined;
  if (!list) return [];
  const readList = (ol: XmlElement, depth: number): RawEntry[] =>
    childElements(ol, "li").map((li) => {
      const label = childElements(li, "a")[0] ?? childElements(li, "span")[0];
      const sub = childElements(li, "ol")[0];
      return {
        title: label ? textOf(label) : "",
        href: label?.name === "a" ? (label.attrs.href ?? null) : null,
        children: sub && depth < MAX_TOC_DEPTH ? readList(sub, depth + 1) : [],
      };
    });
  return pointAtChapters(readList(list, 0), baseDir, chapterIndex, {
    left: MAX_TOC_ENTRIES,
  });
}

function ncxToc(
  doc: XmlElement,
  baseDir: string,
  chapterIndex: Map<string, number>,
): EpubTocEntry[] {
  const navMap = findFirst(doc, "navmap");
  if (!navMap) return [];
  const readPoints = (parent: XmlElement, depth: number): RawEntry[] =>
    childElements(parent, "navpoint").map((point) => {
      const label = childElements(point, "navlabel")[0];
      const text = label ? childElements(label, "text")[0] : undefined;
      return {
        title: text ? textOf(text) : label ? textOf(label) : "",
        href: childElements(point, "content")[0]?.attrs.src ?? null,
        children: depth < MAX_TOC_DEPTH ? readPoints(point, depth + 1) : [],
      };
    });
  return pointAtChapters(readPoints(navMap, 0), baseDir, chapterIndex, {
    left: MAX_TOC_ENTRIES,
  });
}

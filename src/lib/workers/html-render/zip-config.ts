/**
 * HTML to PDF's ZIP input — a page and the files it links, in one archive —
 * as a LEAF with no imports, so the three places that must agree read ONE
 * definition:
 *
 *   - the worker, which opens the archive within these bounds and serves its
 *     files to Chromium (`./zip-site`);
 *   - the browser, which lists the archive's pages before upload and lets
 *     the user choose one (`@/components/tools/html-source-area`);
 *   - the copy, which states the bounds (`@/lib/tools/content/html-to-pdf`).
 *
 * THE BOUNDS, measured rather than borrowed from EPUB. A ZIP of a saved web
 * page is a page plus everything a browser's "Save page as, Webpage
 * complete" writes beside it. On 2026-11-14 twelve real public pages were
 * loaded in Chromium (Playwright, 1280x900, scrolled to the bottom), and
 * every document, stylesheet, script, image, font and media file they
 * loaded was counted — the kinds a complete save stores. Nine loaded (two
 * answered a bot check, one timed out):
 *
 *     page                files   unpacked   largest file   worst ratio > 1 MiB
 *     nytimes.com           783   38.7 MiB      3.1 MiB        7.1
 *     amazon.com            252   10.8 MiB      4.0 MiB        1.0
 *     github.com repo       143    8.2 MiB      0.9 MiB        -
 *     bbc.com/news          124    9.6 MiB      0.8 MiB        -
 *     apple.com              89    7.3 MiB      1.3 MiB        1.0
 *     theguardian.com        88    4.1 MiB      1.4 MiB        9.7
 *     MDN HTML docs          64    0.8 MiB      0.2 MiB        -
 *     wikipedia article      39    2.1 MiB      0.8 MiB        -
 *     stackoverflow           8    1.3 MiB      0.6 MiB        -
 *
 * So a saved page HAS more files than most books, and fewer bytes:
 *   - {@link HTML_ZIP_MAX_ENTRIES}: 4,000, five times the largest page seen
 *     (folder entries count too). EPUB allows 10,000.
 *   - {@link HTML_ZIP_MAX_UNPACKED_BYTES}: 100 MiB, two and a half times the
 *     largest page, and the render network's own budget for all responses
 *     of one render (`DEFAULT_RENDER_NETWORK_LIMITS.maxTotalBytes`), so a
 *     ZIP page may weigh what a fetched one may. EPUB allows 300 MiB.
 *   - {@link HTML_ZIP_MAX_ENTRY_RATIO}: 100-fold above 1 MiB, EPUB's figure,
 *     ten times the worst real file (1.4 MiB, 9.7-fold). Files
 *     under 1 MiB are not judged by the ratio (one real file under it deflated
 *     22.5-fold), as in EPUB.
 * `zip-site.test.ts` holds each bound with a ZIP one past it.
 */

const MIB = 1024 * 1024;

/**
 * Where a document is served from, for Chromium's eyes only. The SAME value
 * as `HTML_DOCUMENT_URL` in `./document-url` (`zip-site.test.ts` holds the
 * two equal), written out because this module stays import-free.
 */
const DOCUMENT_URL = "https://document.invalid/";

/** The most files (ZIP entries, folders included) one archive may hold. */
export const HTML_ZIP_MAX_ENTRIES = 4_000;

/** The most bytes all of an archive's files may unpack to, together. */
export const HTML_ZIP_MAX_UNPACKED_BYTES = 100 * MIB;

/**
 * The most one file may grow when unpacked, as a multiple of its packed
 * size — judged only for files that unpack past
 * {@link HTML_ZIP_RATIO_FLOOR_BYTES}, so a small, repetitive stylesheet is
 * not mistaken for a bomb.
 */
export const HTML_ZIP_MAX_ENTRY_RATIO = 100;
export const HTML_ZIP_RATIO_FLOOR_BYTES = 1 * MIB;

/**
 * The job option naming the page of the archive to print: its path inside
 * the ZIP, exactly as the archive spells it. The browser always sends it
 * for a ZIP, so the job API can tell a ZIP job from an HTML one without
 * reading the file (`POST /api/jobs` refuses it unless the running worker
 * proves `htmlZip`).
 */
export const HTML_ZIP_ENTRY_OPTION = "entry";

/** The longest entry path the option may carry, in characters. */
export const HTML_ZIP_MAX_ENTRY_LENGTH = 1024;

/**
 * The types a ZIP may be declared as at upload. `application/zip` is what
 * the browser client declares; `application/x-zip-compressed` is what
 * Windows reports for a .zip, so a direct caller using the browser's own
 * type is not refused for it.
 */
export const HTML_ZIP_MIMES: readonly string[] = [
  "application/zip",
  "application/x-zip-compressed",
];

/** The type the browser client declares for a ZIP upload. */
export const HTML_ZIP_DECLARED_MIME = "application/zip";

/** True for a file name a ZIP upload is recognised by. */
export function isZipName(name: string): boolean {
  return /\.zip$/i.test(name.trim());
}

/**
 * True when `name` is an entry path the worker can serve: no backslash, no
 * NUL, not absolute, no empty, `.` or `..` segment, not a folder. An archive
 * may hold names like `../x` or `/etc/x`; they are never served, so they are
 * never offered as the page to print either.
 */
export function isServableEntryName(name: string): boolean {
  if (name === "" || name.includes("\\") || name.includes("\0")) return false;
  if (name.startsWith("/") || name.endsWith("/")) return false;
  return name
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** True for a servable `.html` / `.htm` entry outside macOS's `__MACOSX/` shadow folder. */
export function isHtmlEntryName(name: string): boolean {
  return (
    isServableEntryName(name) &&
    /\.html?$/i.test(name) &&
    !name.startsWith("__MACOSX/")
  );
}

/**
 * Which page of an archive is printed when nobody chose one, from its entry
 * names alone (so the browser and the worker decide alike):
 *
 *   1. `index.html` (or `.htm`) at the root;
 *   2. or, when every file sits in one top-level folder (a zipped folder),
 *      that folder's `index.html`;
 *   3. otherwise the only page at that top level — a "Save page as" export
 *      zipped is `Page.html` beside `Page_files/`, and the frames it saved
 *      as `.html` inside that folder are not candidates for the page;
 *   4. otherwise the only page anywhere.
 *
 * `choose` when that leaves more than one: the browser asks the user to
 * pick one before upload, and the worker refuses a job that names none.
 * `none` when the archive holds no page at all. `candidates` lists every
 * page, in archive order, for the picker.
 */
export type HtmlEntryChoice =
  | { kind: "one"; entry: string; candidates: readonly string[] }
  | { kind: "choose"; candidates: readonly string[] }
  | { kind: "none" };

export function chooseHtmlEntry(names: readonly string[]): HtmlEntryChoice {
  const candidates = names.filter(isHtmlEntryName);
  if (candidates.length === 0) return { kind: "none" };
  const one = (entry: string): HtmlEntryChoice => ({
    kind: "one",
    entry,
    candidates,
  });
  const indexAt = (prefix: string) =>
    candidates.filter(
      (n) =>
        n.startsWith(prefix) && /^index\.html?$/i.test(n.slice(prefix.length)),
    );
  const atRoot = indexAt("");
  if (atRoot.length === 1) return one(atRoot[0]!);
  // Every servable file in one top-level folder: a zipped folder.
  const files = names.filter(
    (n) => isServableEntryName(n) && !n.startsWith("__MACOSX/"),
  );
  const tops = new Set(files.map((n) => n.split("/")[0]!));
  const folder =
    tops.size === 1 && files.every((n) => n.includes("/"))
      ? `${[...tops][0]!}/`
      : "";
  if (folder) {
    const inFolder = indexAt(folder);
    if (inFolder.length === 1) return one(inFolder[0]!);
  }
  const top = candidates.filter(
    (n) => n.startsWith(folder) && !n.slice(folder.length).includes("/"),
  );
  if (top.length === 1) return one(top[0]!);
  if (candidates.length === 1) return one(candidates[0]!);
  return { kind: "choose", candidates };
}

/**
 * The `entry` option of an html-to-pdf job: absent, or a servable page path
 * of at most {@link HTML_ZIP_MAX_ENTRY_LENGTH} characters. Run by the job
 * API before anything is queued and again by the worker, because a job
 * record is not proof of what the API accepted.
 */
export function parseHtmlZipEntryOption(
  options: Record<string, unknown>,
): { ok: true; entry: string | undefined } | { ok: false; message: string } {
  const raw = options[HTML_ZIP_ENTRY_OPTION];
  if (raw === undefined) return { ok: true, entry: undefined };
  if (
    typeof raw !== "string" ||
    raw.length > HTML_ZIP_MAX_ENTRY_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(raw) ||
    !isHtmlEntryName(raw)
  )
    return {
      ok: false,
      message: `\`options.${HTML_ZIP_ENTRY_OPTION}\` must name an .html or .htm file inside the ZIP by its path (at most ${HTML_ZIP_MAX_ENTRY_LENGTH} characters).`,
    };
  return { ok: true, entry: raw };
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
export type HtmlZipRefusal =
  | { kind: "unreadable" }
  | { kind: "bomb"; limit: "entries" | "unpacked" | "ratio" }
  | { kind: "no_html" }
  /** The job named a page the archive does not hold (or cannot serve). */
  | { kind: "entry_not_found" }
  /** More than one page, and the job named none. */
  | { kind: "choose_entry"; count: number }
  /** The job named a page of a ZIP, and the file is not a ZIP. */
  | { kind: "not_zip" };

/** The sentence a reader gets for each refusal. The one place it is written. */
export function htmlZipRefusalMessage(refusal: HtmlZipRefusal): string {
  switch (refusal.kind) {
    case "unreadable":
      return "This ZIP archive could not be read, so nothing was converted. Make the ZIP again (your system's own Compress or Send to › Compressed folder works) and try again.";
    case "bomb":
      if (refusal.limit === "entries")
        return `This ZIP holds more than ${HTML_ZIP_MAX_ENTRIES.toLocaleString("en-US")} files, the most HTML to PDF opens, so nothing was converted. Keep only the page and the files it uses, and try again.`;
      if (refusal.limit === "unpacked")
        return `This ZIP unpacks to more than ${HTML_ZIP_MAX_UNPACKED_BYTES / MIB} MB, the most HTML to PDF unpacks, so nothing was converted. Keep only the page and the files it uses, and try again.`;
      return `A file inside this ZIP unpacks to more than ${HTML_ZIP_MAX_ENTRY_RATIO} times its packed size, the shape of a ZIP bomb, so nothing was converted. Make the ZIP again from the page's own files and try again.`;
    case "no_html":
      return "This ZIP holds no .html or .htm file, so there was no page to convert. Put the page in the ZIP with its files and try again.";
    case "entry_not_found":
      return "The page chosen for this ZIP is not in it, so nothing was converted. Choose the ZIP again and pick one of the pages it lists.";
    case "choose_entry":
      return `This ZIP holds ${refusal.count} pages and none was chosen, so nothing was converted. Choose the ZIP again on the HTML to PDF page and pick the page to print.`;
    case "not_zip":
      return "A page inside a ZIP was named, but the file is not a ZIP archive, so nothing was converted.";
  }
}

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

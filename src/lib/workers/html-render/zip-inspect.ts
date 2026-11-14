/**
 * A picked ZIP, read IN THE BROWSER before anything is uploaded: which pages
 * it holds, which one the worker would print (`chooseHtmlEntry`, the
 * worker's own rule), and which of that page's references the archive does
 * not hold — so the user chooses the page, and hears what will be missing,
 * before the file leaves their machine.
 *
 * Loaded only when a ZIP is picked (`@/components/tools/html-source-area`
 * imports it on demand), and JSZip with it: nobody who prints an HTML file pays for it.
 *
 * JSZip reads the central directory here and inflates only the page and the
 * stylesheets it links. The worker judges the archive again within its own
 * bounds (`./zip-site`), which a browser check cannot replace: a request can
 * come from anywhere. This check only spares the user an upload the worker
 * would refuse, in the worker's words (`htmlZipRefusalMessage`).
 */
import JSZip from "jszip";
import { decodeTextBytes } from "@/lib/text/decode-text-file";
import {
  HTML_ZIP_MAX_ENTRIES,
  chooseHtmlEntry,
  htmlZipRefusalMessage,
  isServableEntryName,
  zipEntryOfUrl,
  zipEntryUrl,
  type HtmlEntryChoice,
} from "./zip-config";
import {
  findUnbundledAssets,
  findUnbundledAssetsInCss,
  unbundledAssetsNote,
  type ArchiveContents,
} from "./unbundled-assets";

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

export type ZipInspection =
  | {
      ok: true;
      /** The pages, and the one printed when nobody chooses. */
      choice: Exclude<HtmlEntryChoice, { kind: "none" }>;
      /** The missing-reference note for `entry`, or null when nothing is missing. */
      note(entry: string): Promise<string | null>;
    }
  | { ok: false; message: string };

/** Read `file` as a ZIP of a page. Never throws: an unreadable archive is a message. */
export async function inspectHtmlZip(file: Blob): Promise<ZipInspection> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    return {
      ok: false,
      message: htmlZipRefusalMessage({ kind: "unreadable" }),
    };
  }
  const all = Object.keys(zip.files);
  if (all.length > HTML_ZIP_MAX_ENTRIES)
    return {
      ok: false,
      message: htmlZipRefusalMessage({ kind: "bomb", limit: "entries" }),
    };
  // What the worker would serve: files (not folders, not symbolic links) at
  // a servable path.
  const files = all.filter((name) => {
    const entry = zip.files[name]!;
    const mode =
      typeof entry.unixPermissions === "number" ? entry.unixPermissions : 0;
    return (
      !entry.dir && (mode & S_IFMT) !== S_IFLNK && isServableEntryName(name)
    );
  });
  const choice = chooseHtmlEntry(files);
  if (choice.kind === "none")
    return { ok: false, message: htmlZipRefusalMessage({ kind: "no_html" }) };
  const present = new Set(files);
  const text = async (name: string) =>
    decodeTextBytes(await zip.file(name)!.async("uint8array")).text;

  return {
    ok: true,
    choice,
    async note(entry) {
      if (!present.has(entry)) return null;
      const archive: ArchiveContents = {
        documentUrl: zipEntryUrl(entry),
        has: (path) => present.has(path),
      };
      try {
        const doc = new DOMParser().parseFromString(
          await text(entry),
          "text/html",
        );
        const references = [...findUnbundledAssets(doc, archive).references];
        // The stylesheets the page links from the archive: their own url()s
        // resolve against THEIR address, and can be missing too.
        const base = doc.querySelector("base[href]")?.getAttribute("href");
        let baseUrl = archive.documentUrl;
        try {
          if (base) baseUrl = new URL(base.trim(), archive.documentUrl).href;
        } catch {
          /* a broken <base> is ignored, as Chromium ignores it */
        }
        for (const link of Array.from(
          doc.querySelectorAll('link[rel~="stylesheet" i][href]'),
        )) {
          let cssUrl: string;
          try {
            cssUrl = new URL(link.getAttribute("href")!.trim(), baseUrl).href;
          } catch {
            continue;
          }
          const path = zipEntryOfUrl(cssUrl);
          if (path === null || !present.has(path)) continue;
          for (const ref of findUnbundledAssetsInCss(
            await text(path),
            cssUrl,
            archive,
          ).references)
            if (!references.includes(ref)) references.push(ref);
        }
        return unbundledAssetsNote({ references }, true);
      } catch {
        // A note we cannot compute is simply not shown; the render reports.
        return null;
      }
    },
  };
}

/**
 * A picked ZIP, read IN THE BROWSER before anything is uploaded: which pages
 * it holds, which one the worker would print (`chooseHtmlEntry`, the
 * worker's own rule), and which of that page's references the archive does
 * not hold — so the user chooses the page, and hears what will be missing,
 * before the file leaves their machine.
 *
 * Loaded only when a ZIP is picked (`@/components/tools/html-source-area`
 * imports it on demand): nobody who prints an HTML file pays for it.
 *
 * The archive is judged by THE WORKER'S OWN directory reader
 * (`../epub/zip-directory`, which needs no `node:zlib`) within the worker's
 * own bounds (`HTML_ZIP_LIMITS`): the same entry count, declared total,
 * per-file growth, overlapping-data refusal — and the same answer for two
 * entries of one name (the first wins), so the note describes the file the
 * worker serves. Only the page and the stylesheets it reaches are inflated,
 * each by the browser's `DecompressionStream`, stopped at the size the
 * directory declared and never past it, within one budget for the note
 * ({@link NOTE_MAX_INFLATED_BYTES}). JSZip is not used: it inflates whatever
 * a stream yields, so a bomb the user picked could take their tab down.
 *
 * The worker judges the archive again (`./zip-site`), which a browser check
 * cannot replace: a request can come from anywhere. This check only spares
 * the user an upload the worker would refuse, in the worker's words
 * (`htmlZipRefusalMessage`), and names what will be missing.
 */
import { decodeTextBytes } from "@/lib/text/decode-text-file";
import {
  packedBytesOf,
  readZipDirectory,
  type ZipDirectoryEntry,
} from "../epub/zip-directory";
import {
  HTML_ZIP_LIMITS,
  chooseHtmlEntry,
  htmlZipRefusalMessage,
  isServableEntryName,
  zipEntryOfUrl,
  zipEntryUrl,
  type HtmlEntryChoice,
} from "./zip-config";
import {
  cssImportUrls,
  findUnbundledAssets,
  findUnbundledAssetsInCss,
  unbundledAssetsNote,
  type ArchiveContents,
} from "./unbundled-assets";

// The ZIP run comes with the reader, in the chunk the pick already fetched:
// one async chunk fewer in every page's chunk map.
export { runWorkerHtmlZipToPdf } from "../html-zip-client";

/** The most stylesheets one note follows, linked and imported together. */
export const NOTE_MAX_STYLESHEETS = 64;
/** The most bytes one note inflates: the page and its stylesheets together. */
export const NOTE_MAX_INFLATED_BYTES = 16 * 1024 * 1024;

export type ZipInspection =
  | {
      ok: true;
      /** The pages, and the one printed when nobody chooses. */
      choice: Exclude<HtmlEntryChoice, { kind: "none" }>;
      /** The missing-reference note for `entry`, or null when nothing is missing. */
      note(entry: string): Promise<string | null>;
    }
  | { ok: false; message: string };

/**
 * An entry's bytes, inflated within the size the directory declared, or
 * null: past it, short of it, neither stored nor deflated, or not
 * inflatable in this browser.
 */
export async function readEntryWithin(
  bytes: Uint8Array,
  entry: ZipDirectoryEntry,
): Promise<Uint8Array | null> {
  if (entry.encrypted) return null;
  let data: Uint8Array;
  try {
    data = packedBytesOf(bytes, entry);
  } catch {
    return null;
  }
  if (entry.method === 0) return data.length === entry.unpacked ? data : null;
  if (entry.method !== 8 || typeof DecompressionStream !== "function")
    return null;
  const out = new Uint8Array(entry.unpacked);
  let size = 0;
  const packed = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const reader = packed
    .pipeThrough(
      new DecompressionStream("deflate-raw") as unknown as TransformStream<
        Uint8Array,
        Uint8Array
      >,
    )
    .getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.length > out.length) {
        // Past what the directory declared: the stream is stopped HERE.
        await reader.cancel().catch(() => {});
        return null;
      }
      out.set(value, size);
      size += value.length;
    }
  } catch {
    return null;
  }
  return size === out.length ? out : null;
}

/** Read `file` as a ZIP of a page. Never throws: an unreadable archive is a message. */
export async function inspectHtmlZip(file: Blob): Promise<ZipInspection> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return {
      ok: false,
      message: htmlZipRefusalMessage({ kind: "unreadable" }),
    };
  }
  const read = readZipDirectory(bytes, HTML_ZIP_LIMITS);
  if (!read.ok)
    return {
      ok: false,
      message: htmlZipRefusalMessage(
        read.refusal.kind === "bomb"
          ? { kind: "bomb", limit: read.refusal.limit }
          : { kind: "unreadable" },
      ),
    };
  const { names, entries } = read.directory;
  // What the worker would serve (`openHtmlZip`'s `servable`): files — not
  // folders, links or encrypted entries — at a servable path.
  const files = names.filter((name) => {
    const entry = entries.get(name)!;
    return (
      !entry.directory &&
      !entry.symlink &&
      !entry.encrypted &&
      isServableEntryName(name)
    );
  });
  const choice = chooseHtmlEntry(files);
  if (choice.kind === "none")
    return { ok: false, message: htmlZipRefusalMessage({ kind: "no_html" }) };
  const present = new Set(files);

  return {
    ok: true,
    choice,
    async note(entry) {
      if (!present.has(entry)) return null;
      const archive: ArchiveContents = {
        documentUrl: zipEntryUrl(entry),
        has: (path) => present.has(path),
      };
      let budget = NOTE_MAX_INFLATED_BYTES;
      /** An entry's text; null past the note's budget, or unreadable. */
      const text = async (name: string): Promise<string | null> => {
        const found = entries.get(name)!;
        if (found.unpacked > budget) return null;
        budget -= found.unpacked;
        const body = await readEntryWithin(bytes, found);
        return body === null ? null : decodeTextBytes(body).text;
      };
      try {
        const html = await text(entry);
        if (html === null) return null;
        const doc = new DOMParser().parseFromString(html, "text/html");
        const references = [...findUnbundledAssets(doc, archive).references];
        const base = doc.querySelector("base[href]")?.getAttribute("href");
        let baseUrl = archive.documentUrl;
        try {
          if (base) baseUrl = new URL(base.trim(), archive.documentUrl).href;
        } catch {
          /* a broken <base> is ignored, as Chromium ignores it */
        }
        // The stylesheets the page reaches inside the archive: those it
        // links, those its own <style> blocks @import, and — followed as
        // Chromium follows them — those THEY @import. Each one's url()s
        // resolve against its own address, and can be missing too.
        const queue: string[] = [];
        for (const link of Array.from(
          doc.querySelectorAll('link[rel~="stylesheet" i][href]'),
        ))
          try {
            queue.push(
              new URL(link.getAttribute("href")!.trim(), baseUrl).href,
            );
          } catch {
            /* unparseable: never loaded */
          }
        for (const style of Array.from(doc.querySelectorAll("style")))
          queue.push(...cssImportUrls(style.textContent ?? "", baseUrl));
        const visited = new Set<string>();
        while (queue.length > 0 && visited.size < NOTE_MAX_STYLESHEETS) {
          const cssUrl = queue.shift()!;
          const path = zipEntryOfUrl(cssUrl);
          if (path === null || !present.has(path) || visited.has(path))
            continue;
          visited.add(path);
          const css = await text(path);
          if (css === null) continue;
          for (const ref of findUnbundledAssetsInCss(css, cssUrl, archive)
            .references)
            if (!references.includes(ref)) references.push(ref);
          queue.push(...cssImportUrls(css, cssUrl));
        }
        return unbundledAssetsNote({ references }, true);
      } catch {
        // A note we cannot compute is simply not shown; the render reports.
        return null;
      }
    },
  };
}

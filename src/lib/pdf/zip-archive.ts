import JSZip from "jszip";
import type { ZipEntry } from "./types";

/**
 * The archive builder behind `zipFiles` (`./browser`). It lives in its own
 * module, loaded on first use, for the reason JSZip was made lazy:
 * `./browser` is statically imported by nearly every runner, so anything here
 * would otherwise ride every tool page's first load. Only a ZIP-producing run
 * needs JSZip or the naming rule below.
 */

/**
 * Entry names with no two alike, in input order. JSZip's `zip.file(name, …)`
 * REPLACES an entry of the same name, so two outputs that share a name (two
 * scans both called scan.pdf, picked from two folders) used to come back as
 * one file. Until 2026-11-08 the second one silently replaced the first.
 *
 * The first holder keeps its name; a later one gains " (2)", " (3)", … before
 * its extension: the shape Windows, macOS and browsers use for a second copy.
 * Names compare case-insensitively, because Windows and macOS extract
 * case-insensitively, and there `Scan.pdf` would overwrite `scan.pdf` on disk
 * even though the archive held both.
 */
export function uniqueEntryNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    for (let copy = 2; taken.has(candidate.toLowerCase()); copy++) {
      candidate = withCopyNumber(name, copy);
    }
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

/** `report.pdf` → `report (2).pdf`; `pages/a.b.png` → `pages/a.b (2).png`. */
function withCopyNumber(name: string, copy: number): string {
  const slash = name.lastIndexOf("/");
  const dot = name.lastIndexOf(".");
  // An extension is a dot inside the last path segment, not at its start
  // (".hidden" is a name, not an extension).
  const ext = dot > slash + 1 ? name.slice(dot) : "";
  return `${name.slice(0, name.length - ext.length)} (${copy})${ext}`;
}

/**
 * An entry's content as JSZip takes it. A Blob goes in as a promise of its
 * bytes, so no `FileReader` is needed (JSZip reads a raw Blob through one,
 * which Node and some workers do not have).
 *
 * The memory this costs, stated plainly because it was once stated wrongly:
 * the read is NOT lazy. `buildZip` starts `arrayBuffer()` on every Blob before
 * JSZip writes the first entry, and JSZip keeps each entry's content until the
 * archive is done. So while "Download all" builds a ZIP, the page holds every
 * output twice (the Blobs a batch keeps, and a copy of each as an
 * ArrayBuffer) plus the archive itself. Pinned in `zip-archive.test.ts`; a
 * writer that puts the Blobs themselves into the archive is the change that
 * would lower it.
 */
function contentOf(entry: ZipEntry): Uint8Array | Promise<Uint8Array> {
  return "blob" in entry
    ? entry.blob.arrayBuffer().then((buffer) => new Uint8Array(buffer))
    : entry.bytes;
}

/** Bundle named files into one ZIP; every input becomes its own entry. */
export function buildZip(
  files: readonly ZipEntry[],
  compression: "DEFLATE" | "STORE",
): Promise<Blob> {
  const zip = new JSZip();
  const names = uniqueEntryNames(files.map((file) => file.name));
  files.forEach((file, index) => {
    zip.file(names[index]!, contentOf(file));
  });
  return zip.generateAsync({
    type: "blob",
    compression,
    compressionOptions: compression === "DEFLATE" ? { level: 6 } : undefined,
  });
}

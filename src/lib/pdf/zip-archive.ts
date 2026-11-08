import JSZip from "jszip";
import type { NamedBytes } from "./types";

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

/** Bundle named byte blobs into one ZIP; every input becomes its own entry. */
export function buildZip(
  files: readonly NamedBytes[],
  compression: "DEFLATE" | "STORE",
): Promise<Blob> {
  const zip = new JSZip();
  const names = uniqueEntryNames(files.map((file) => file.name));
  files.forEach((file, index) => {
    zip.file(names[index]!, file.bytes);
  });
  return zip.generateAsync({
    type: "blob",
    compression,
    compressionOptions: compression === "DEFLATE" ? { level: 6 } : undefined,
  });
}

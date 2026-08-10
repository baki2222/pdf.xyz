/**
 * Pure file classification: turn a file's name/MIME into a coarse {@link FileFamily}
 * and a short display `kind`, and build a {@link WorkspaceFile} from plain metadata.
 * No DOM, no File API — takes the structural `{ name, size, type }` shape so it is
 * trivial to unit-test with plain objects.
 */

import type { FileFamily, WorkspaceFile } from "./types";

/** Extension → family. Kept explicit (not regex) so it's obvious and testable. */
const FAMILY_BY_EXT: Record<string, FileFamily> = {
  pdf: "pdf",
  // images
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  bmp: "image",
  tif: "image",
  tiff: "image",
  heic: "image",
  avif: "image",
  svg: "image",
  // word processing
  doc: "word",
  docx: "word",
  rtf: "word",
  odt: "word",
  // spreadsheets
  xls: "excel",
  xlsx: "excel",
  csv: "excel",
  ods: "excel",
  // presentations
  ppt: "powerpoint",
  pptx: "powerpoint",
  odp: "powerpoint",
  // plain text
  txt: "text",
  md: "text",
  markdown: "text",
};

/** Lower-cased file extension without the dot, or "" when there isn't one. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Resolve a file's coarse family. Extension wins (most reliable for the office
 * formats we care about); MIME type is a fallback for extension-less names.
 */
export function fileFamily(name: string, mime = ""): FileFamily {
  const byExt = FAMILY_BY_EXT[extensionOf(name)];
  if (byExt) return byExt;

  const m = mime.toLowerCase();
  if (m.startsWith("application/pdf")) return "pdf";
  if (m.startsWith("image/")) return "image";
  // Office MIME subtypes before the generic text/* check.
  if (
    m.includes("word") ||
    m.includes("msword") ||
    m.includes("opendocument.text")
  )
    return "word";
  if (m.includes("sheet") || m.includes("excel") || m.includes("csv"))
    return "excel";
  if (m.includes("presentation") || m.includes("powerpoint"))
    return "powerpoint";
  if (m.startsWith("text/")) return "text";
  return "other";
}

/**
 * Short, honest uppercase type label for a file card, e.g. "PDF", "DOCX".
 * Prefers the extension; falls back to the MIME subtype, then "FILE".
 */
export function fileKind(name: string, mime = ""): string {
  const ext = extensionOf(name);
  if (ext && ext.length <= 5) return ext.toUpperCase();
  const sub = mime.includes("/") ? (mime.split("/").pop() ?? "") : "";
  return sub && sub.length <= 8 ? sub.toUpperCase() : "FILE";
}

/** The minimal file shape we need to classify and stage a file. */
export interface FileMetaInput {
  name: string;
  size: number;
  type?: string;
}

/**
 * Build a {@link WorkspaceFile} from plain file metadata. The `id` and `addedAt`
 * are passed in by the caller (the React layer supplies a stable id and the
 * client clock) so this — and the reducer it feeds — stay pure and deterministic.
 */
export function createWorkspaceFile(
  input: FileMetaInput,
  id: string,
  addedAt: number,
): WorkspaceFile {
  const mime = input.type ?? "";
  const size = Number.isFinite(input.size) && input.size > 0 ? input.size : 0;
  return {
    id,
    name: input.name,
    size,
    mime,
    kind: fileKind(input.name, mime),
    family: fileFamily(input.name, mime),
    addedAt,
  };
}

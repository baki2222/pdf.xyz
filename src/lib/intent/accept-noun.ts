/**
 * What a tool takes, as a noun — for a sentence about the files it opens.
 *
 * Moved here from the hand-off notice (`handoff-notice.tsx`, a client
 * module) on 2026-10-10 so a server page can say it too: the guide desk's
 * "Drop your PDFs to open Merge PDF with them" (WP-07). One definition for
 * both, so the notice that says what a tool could not open and the desk
 * that says what it opens cannot name the same files two ways.
 */
import { normalizeFormatLabel } from "@/lib/jobs/mime-by-format";

/** "a"/"an" before a format read as letters: an MD file, a PDF. */
const article = (label: string) => (/^[AEFHILMNORSX]/.test(label) ? "an" : "a");

/** "PDF", "JPG or PNG", "XLSX, XLS or CSV". */
function orList(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

/**
 * What a tool takes, as a noun, read from its `accept` row: "a PDF", "a JPG
 * or PNG image", "an MD file" — and the plural. It used to be typed "a PDF"
 * for every tool, which was false on the image and text tools.
 */
export function acceptNoun(accept: readonly string[]): {
  one: string;
  many: string;
} {
  const labels = [...new Set(accept.map(normalizeFormatLabel))];
  if (labels.length === 0) return { one: "a file", many: "files" };
  if (labels.length === 1 && labels[0] === "PDF") {
    return { one: "a PDF", many: "PDFs" };
  }
  const list = orList(labels);
  const images = labels.every((l) => l === "JPG" || l === "PNG");
  const kind = images ? "image" : "file";
  return { one: `${article(list)} ${list} ${kind}`, many: `${list} ${kind}s` };
}

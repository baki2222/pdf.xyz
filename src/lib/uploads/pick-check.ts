import {
  declaredContentTypeFor,
  MIME_BY_FORMAT,
} from "@/lib/jobs/mime-by-format";
import { converterToPdf, formatOf } from "@/lib/intent/formats";
import { tools } from "@/lib/tools";
import { fileOverCeilingMessage } from "@/lib/tools/file-ceilings";
import type { Tool } from "@/lib/tools/types";
import { extensionOf } from "./intake/families";

/**
 * Why a picked file cannot go to a worker tool, said at the pick — before the
 * file is read into memory or a byte is uploaded.
 *
 * WHAT IT REPLACES. The worker panels handed every picked file straight on.
 * A drop is not filtered by the input's `accept` attribute, so a .docx dropped
 * on Summarize, or a 120 MB scan dropped on OCR, was read whole, sent, and
 * refused by the server with "A file's declared type does not match its
 * filename extension." or "A file exceeds the 104857600-byte per-file upload
 * limit." The user never declared anything, and nothing named the tool that
 * does take their file.
 *
 * ONE DEFINITION WITH THE SERVER. The type test is the server's own: the
 * content type the browser client declares for this filename
 * (`declaredContentTypeFor`) must be one of the MIME types the tool's
 * catalogue formats allow (`MIME_BY_FORMAT`), which is exactly what the
 * per-tool validator checks. The size test is `fileOverCeilingMessage`, the
 * figure the page states. So the pick cannot refuse a file the server would
 * take, or pass one it will refuse, without the other changing too.
 */

/** What a panel hands its Dropzone: why a file is refused, or `null`. */
export type PickRefusal = (file: File) => string | null;

/** Every MIME type `tool` accepts, from its catalogue formats. */
function acceptedMimes(tool: Tool): Set<string> {
  return new Set(tool.accept.flatMap((format) => MIME_BY_FORMAT[format] ?? []));
}

/** "PDF", "DOCX or DOC", "PDF, JPG or PNG". */
function formatList(formats: readonly string[]): string {
  if (formats.length <= 1) return formats[0] ?? "";
  return `${formats.slice(0, -1).join(", ")} or ${formats[formats.length - 1]}`;
}

/**
 * The catalogue tool that turns a file of this name into a PDF, if any: one
 * that outputs PDF, does not itself take PDF, and accepts the file's format —
 * the tool whose OWN format it is first, so a .png is sent to PNG to PDF.
 *
 * The rule is `converterToPdf` in `@/lib/intent/formats`, the same one the
 * search's "No tool here opens HEIC photos" answer uses to name where a file
 * can go instead; this reads the format from the name the way every other
 * surface does.
 */
export function converterToPdfFor(filename: string): Tool | undefined {
  return converterToPdf(formatOf({ name: filename }).format, tools);
}

/** Is this the kind of file `tool` takes, by the rule the server applies? */
export function toolTakesFile(
  tool: Tool,
  file: { name: string; type: string },
): boolean {
  const allowed = acceptedMimes(tool);
  const byName = declaredContentTypeFor(file.name);
  if (byName !== null) return allowed.has(byName);
  // No extension the catalogue knows. The browser's own type is the only
  // evidence left; with none at all, leave the verdict to the server rather
  // than refuse a file that may be fine.
  const byType = file.type.trim().toLowerCase();
  if (byType === "") return extensionOf(file.name) === null;
  return allowed.has(byType);
}

/** The sentence for a file of the wrong kind, naming the converter when one exists. */
export function wrongTypeMessage(tool: Tool, filename: string): string {
  const pdfOnly = tool.accept.length === 1 && tool.accept[0] === "PDF";
  const head = pdfOnly
    ? `"${filename}" isn't a PDF — ${tool.name} works on PDF files.`
    : `"${filename}" isn't a file ${tool.name} takes — it works on ${formatList(tool.accept)} files.`;
  const converter = tool.accept.includes("PDF")
    ? converterToPdfFor(filename)
    : undefined;
  return converter && converter.slug !== tool.slug
    ? `${head} Turn it into a PDF with ${converter.name} first.`
    : head;
}

/**
 * Why `file` cannot be picked for `tool`, or `null` when it can. The type is
 * checked first: a 200 MB .docx on a PDF tool is the wrong file, not a big one.
 */
export function pickRefusal(
  tool: Tool,
  file: { name: string; type: string; size: number },
): string | null {
  if (!toolTakesFile(tool, file)) return wrongTypeMessage(tool, file.name);
  return fileOverCeilingMessage(tool, file.size);
}

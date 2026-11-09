import {
  declaredContentTypeFor,
  MIME_BY_FORMAT,
} from "@/lib/jobs/mime-by-format";
import { formatOf } from "@/lib/intent/formats";
import { ceilingRefusal } from "@/lib/tools/ceiling-message";
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
 * per-tool validator checks. The size test is the figure the page states
 * (`toolFileCeilingBytes`), in `fileOverCeilingMessage`'s words
 * (`ceilingRefusal`, one definition for both). So the pick cannot refuse a
 * file the server would take, or pass one it will refuse, without the other
 * changing too.
 *
 * WHAT THE PAGE HANDS IT, since 2026-11-09 (perf/per-tool-first-load): the
 * tool's ceiling as a number and the converters a wrong file is pointed at,
 * both computed on the server (`pickFactsFor`, `./pick-facts`) and read from
 * the page's job (`ToolRun.pick`). This module used to compute them in the
 * browser: the ceiling from every runner kind's table and every worker
 * engine's tool list (`@/lib/tools/file-ceilings`), the converter from the
 * whole tool directory — on every worker tool page's first load, for one
 * number and one name. `pick-facts.test.ts` holds the server's facts to the
 * old computation for every worker tool, and the message to the same words.
 */

/**
 * What the server page computed for the pick, for one tool: its ceiling in
 * bytes (`toolFileCeilingBytes`; null when it takes no file), and the
 * tools that turn a file into a PDF, each by its display name with the
 * formats it takes (`converterToPdfFor` — only for a tool that takes PDFs,
 * the one case the message names a converter, and never the tool itself).
 */
export interface PickFacts {
  readonly ceilingBytes: number | null;
  readonly converters: Readonly<Record<string, readonly string[]>>;
}

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
export function wrongTypeMessage(
  tool: Tool,
  filename: string,
  facts: PickFacts,
): string {
  const pdfOnly = tool.accept.length === 1 && tool.accept[0] === "PDF";
  const head = pdfOnly
    ? `"${filename}" isn't a PDF — ${tool.name} works on PDF files.`
    : `"${filename}" isn't a file ${tool.name} takes — it works on ${formatList(tool.accept)} files.`;
  const format = formatOf({ name: filename }).format;
  // The server lists only OTHER tools (`pickFactsFor`), so a converter here
  // is never the tool refusing the file.
  const converter =
    tool.accept.includes("PDF") && format !== null
      ? Object.entries(facts.converters).find(([, formats]) =>
          formats.includes(format),
        )?.[0]
      : undefined;
  return converter
    ? `${head} Turn it into a PDF with ${converter} first.`
    : head;
}

/**
 * Why `file` cannot be picked for `tool`, or `null` when it can. The type is
 * checked first: a 200 MB .docx on a PDF tool is the wrong file, not a big one.
 */
export function pickRefusal(
  tool: Tool,
  file: { name: string; type: string; size: number },
  facts: PickFacts,
): string | null {
  if (!toolTakesFile(tool, file))
    return wrongTypeMessage(tool, file.name, facts);
  const bytes = facts.ceilingBytes;
  if (bytes === null || file.size <= bytes) return null;
  return ceilingRefusal(tool.name, bytes);
}

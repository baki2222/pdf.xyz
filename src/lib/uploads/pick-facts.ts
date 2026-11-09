/**
 * What a worker tool's pick check needs, computed on the SERVER for one
 * tool and handed to its panel as data (`ToolRun.pick`, from
 * `toolRunInfoFor`): the tool's byte ceiling and the converters a wrong file
 * is pointed at. See `./pick-check` for why it is not computed in the
 * browser any more; `pick-facts.test.ts` holds these facts to that
 * computation for every worker tool.
 *
 * Never import this from client code: it reads the tool directory and the
 * file-ceiling tables, which `lazy-chunks.test.ts` holds out of every tool
 * page's first load.
 */
import {
  FORMATS,
  UNSUPPORTED_FORMATS,
  converterToPdf,
  formatOf,
  type FileFormat,
} from "@/lib/intent/formats";
import { TOOL_DIRECTORY } from "@/lib/tools/directory.generated";
import type { ToolEntry } from "@/lib/tools/directory";
import { toolFileCeilingBytes } from "@/lib/tools/file-ceilings";
import type { Tool } from "@/lib/tools/types";
import type { PickFacts } from "./pick-check";

/**
 * The catalogue tool that turns a file of this name into a PDF, if any: one
 * that outputs PDF, does not itself take PDF, and accepts the file's format —
 * the tool whose OWN format it is first, so a .png is sent to PNG to PDF.
 *
 * The rule is `converterToPdf` in `@/lib/intent/formats`, the same one the
 * search's "No tool here opens HEIC photos" answer uses to name where a file
 * can go instead; this reads the format from the name the way every other
 * surface does. Moved here from `./pick-check` (2026-11-09), which ran it in
 * the browser over the whole directory.
 */
export function converterToPdfFor(filename: string): ToolEntry | undefined {
  return converterToPdf(formatOf({ name: filename }).format, TOOL_DIRECTORY);
}

/** Every format a file name can be read as. */
const EVERY_FORMAT: readonly FileFormat[] = [
  ...FORMATS,
  ...UNSUPPORTED_FORMATS,
];

/**
 * The pick facts for `tool`. Converters are listed only for a tool that
 * takes PDFs (the one case the refusal names one) and only where the
 * converter is another tool — the same two conditions `wrongTypeMessage`
 * applies, so the page ships no entry it could not say.
 */
export function pickFactsFor(tool: Tool): PickFacts {
  const converters: Record<string, { slug: string; name: string }> = {};
  if (tool.accept.includes("PDF")) {
    for (const format of EVERY_FORMAT) {
      const converter = converterToPdf(format, TOOL_DIRECTORY);
      if (converter && converter.slug !== tool.slug)
        converters[format] = { slug: converter.slug, name: converter.name };
    }
  }
  return { ceilingBytes: toolFileCeilingBytes(tool), converters };
}

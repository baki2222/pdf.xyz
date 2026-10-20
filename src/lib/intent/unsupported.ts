/**
 * The answer to a format nothing here opens — "No tool here opens HEIC
 * photos." — and where the file can go instead.
 *
 * The words for each format are data (`UNSUPPORTED_ANSWERS` in
 * `@/lib/tools/intents`); the ALTERNATIVE is derived here from the catalogue
 * passed in, never written down: the tool that turns the suggested format
 * into a PDF (`converterToPdf`, the rule the worker panels' refusals use), or
 * for an archive, the tools that take what is usually inside it. So the
 * answer cannot name a tool that does not exist, or a format the tool does
 * not take.
 *
 * It never says "yet": nothing here is promised, and an answer that hedged
 * about the future would be a claim about a roadmap.
 */
import { normalizeFormatLabel } from "@/lib/jobs/mime-by-format";
import { UNSUPPORTED_ANSWERS } from "@/lib/tools/intents";
import {
  converterToPdf,
  toolAcceptsFormat,
  type ConvertingTool,
  type Format,
  type UnsupportedFormat,
} from "./formats";

/** The tool fields an answer reads. */
export interface AnswerTool extends ConvertingTool {
  readonly name: string;
}

export type UnsupportedAlternative<T extends AnswerTool> =
  /** Convert first, then this tool takes it. `takes`: "JPG and PNG". */
  | { readonly kind: "tool"; readonly tool: T; readonly takes: string }
  /** Unpack first; `count` tools take the format usually inside. */
  | {
      readonly kind: "accepts";
      readonly format: Format;
      readonly count: number;
    };

export interface UnsupportedAnswer<T extends AnswerTool> {
  readonly format: UnsupportedFormat;
  /** "No tool here opens HEIC photos." */
  readonly headline: string;
  /** "Save a JPG copy first." — an instruction, or null when there is none. */
  readonly how: string | null;
  readonly alternative: UnsupportedAlternative<T> | null;
}

/** "PDF", "DOCX and DOC", "XLSX, XLS and CSV". */
function formatList(formats: readonly string[]): string {
  if (formats.length <= 1) return formats[0] ?? "";
  return `${formats.slice(0, -1).join(", ")} and ${formats[formats.length - 1]}`;
}

/**
 * The answer's words alone — "No tool here opens HEIC photos. Save a JPG
 * copy first." — without the alternative, which needs the catalogue's tools
 * and the format tables (the command palette says this much, from a chunk
 * with no room for the rest).
 */
export function unsupportedWords(format: UnsupportedFormat): {
  readonly headline: string;
  readonly how: string | null;
} {
  const data = UNSUPPORTED_ANSWERS[format];
  return { headline: `No tool here opens ${data.noun}.`, how: data.how };
}

/** The answer for `format`, with its alternative read from `tools`. */
export function unsupportedAnswer<T extends AnswerTool>(
  format: UnsupportedFormat,
  tools: readonly T[],
): UnsupportedAnswer<T> {
  const data = UNSUPPORTED_ANSWERS[format];
  const { headline } = unsupportedWords(format);
  let alternative: UnsupportedAlternative<T> | null = null;
  if (data.becomes === "PDF") {
    const count = tools.filter((t) =>
      toolAcceptsFormat(t.accept, "PDF"),
    ).length;
    if (count > 0) alternative = { kind: "accepts", format: "PDF", count };
  } else if (data.becomes !== null) {
    const tool = converterToPdf(data.becomes, tools);
    if (tool) {
      const takes = [...new Set(tool.accept.map(normalizeFormatLabel))];
      alternative = { kind: "tool", tool, takes: formatList(takes) };
    }
  }
  return { format, headline, how: data.how, alternative };
}

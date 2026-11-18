/**
 * AI Data Extraction job contract — the typed, framework-agnostic options for
 * the `ai-extract` AI tool, plus its deterministic output naming. The
 * validator, `parseExtractOptions`, is in `./ai-extract-options`.
 *
 * This is the AI-tool sibling of `@/lib/jobs/summarize-pdf.ts` and
 * `@/lib/jobs/translate-pdf.ts`: pure data — no Next.js, no storage, no AI
 * SDK. It defines exactly what an extraction request may ask for (a free-text
 * extraction PROMPT, or a typed field SCHEMA) so the UI, the worker engine,
 * and the docs share one honest source of truth. It depends only on
 * `./filenames`.
 *
 * WHY THE PARSER IS NOT HERE (2026-11-17): the panel imports this module with
 * the page, and webpack keeps every export ANY chunk uses in the one copy of a
 * module. The saved-schemas chunk checks a schema with the parser, so while
 * the parser lived here it rode /tools/ai-extract's first load (+~1 KB gz,
 * measured), though only that lazy chunk and the server call it.
 *
 * HONEST SCOPE (load-bearing): this contract only *describes* a request. Producing
 * an extraction requires a configured AI provider and selectable text in the PDF;
 * the worker engine fails honestly (never fabricated values) when either is
 * missing. A request MUST say what to extract — an options-less or targetless
 * request is rejected, never turned into an aimless "extract everything" guess.
 *
 * SAFETY: the prompt/schema are user-authored directives that travel in the job's
 * `options` body and are woven into the model prompt server-side. They carry no
 * secret; the AI API key lives only in the worker's environment and is never part
 * of a request. Inputs are bounded and control-character-free so they can never
 * smuggle a log-injection or terminal-escape payload.
 */

import {
  MAX_DISPLAY_FILENAME_LENGTH,
  sanitizeDisplayFilename,
} from "./filenames";
import type {
  ExtractOptions,
  ExtractionField,
  ExtractionFieldType,
  ExtractionMode,
} from "./ai-extract-options";

// The types are declared beside the parser that returns them (`/privacy`'s
// options walk reads a parser's return type in its own file), and only
// re-exported here: erased at runtime, so the panel's first load is unchanged.
export type {
  ExtractOptions,
  ExtractionField,
  ExtractionFieldType,
  ExtractionMode,
};

/** The neutral stem used when nothing safe survives filename sanitization. */
const FALLBACK_STEM = "document";

/** How the caller describes what to extract: a free-text prompt or a typed schema. */
export const EXTRACTION_MODES = [
  "prompt",
  "schema",
] as const satisfies readonly ExtractionMode[];

/**
 * The value type a schema field expects. A strict allow-list so the engine, UI, and
 * manifest agree on one vocabulary and an unknown type is rejected, never coerced.
 * `array` is a list of primitive values (e.g. line-item descriptions).
 */
export const EXTRACTION_FIELD_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
  "array",
] as const satisfies readonly ExtractionFieldType[];

/** The default field type when a schema field omits one. */
export const DEFAULT_FIELD_TYPE: ExtractionFieldType = "string";

/** Max length of the optional free-text extraction prompt. */
export const MAX_EXTRACTION_PROMPT_CHARS = 2000;
/** Max number of fields a schema may declare. */
export const MAX_EXTRACTION_FIELDS = 50;
/** Max length of a single field name. */
export const MAX_FIELD_NAME_CHARS = 80;
/** Max length of a single field description. */
export const MAX_FIELD_DESCRIPTION_CHARS = 200;

/**
 * The key two field names collide on — the ONE rule for "the same name",
 * shared by the parser (`./ai-extract-options`) and the panel that stops a
 * user typing a duplicate before anything is uploaded or reserved. Two copies
 * of the rule is how a panel lets through what the worker then refuses.
 */
export function fieldNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * For each name that repeats an earlier one (by {@link fieldNameKey}), the
 * index of the FIRST field it repeats. Blank names are not compared: an unnamed
 * row is unfinished, not a duplicate.
 */
export function duplicateFieldNames(
  names: readonly string[],
): Map<number, number> {
  const first = new Map<string, number>();
  const duplicates = new Map<number, number>();
  names.forEach((name, index) => {
    const key = fieldNameKey(name);
    if (key.length === 0) return;
    const earlier = first.get(key);
    if (earlier === undefined) first.set(key, index);
    else duplicates.set(index, earlier);
  });
  return duplicates;
}

/**
 * The sentence for a duplicate, numbered from one as the panel shows fields —
 * said once for the parser's refusal and the panel's inline warning.
 */
export function duplicateFieldMessage(index: number, earlier: number): string {
  return `Field ${index + 1} has the same name as field ${earlier + 1}. Give each field a different name.`;
}

/** A short, human description of a validated extraction request, for the UI copy. */
export function describeExtractRequest(options: ExtractOptions): string {
  if (options.mode === "prompt") {
    return "Extract fields from a prompt";
  }
  const count = options.schema?.length ?? 0;
  return `Extract ${count} field${count === 1 ? "" : "s"} from a schema`;
}

/** A sensible download name for the extraction package, derived from the source PDF. */
export function extractionOutputName(originalName: unknown): string {
  const tail = "-extraction.zip";
  const budget = Math.max(1, MAX_DISPLAY_FILENAME_LENGTH - tail.length);
  const stem =
    sanitizeDisplayFilename(originalName)
      .replace(/\.[^.]+$/, "")
      .trim() || FALLBACK_STEM;
  return `${stem.length > budget ? stem.slice(0, budget).trim() : stem}${tail}`;
}

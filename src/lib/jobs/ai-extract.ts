/**
 * AI Data Extraction job contract — the typed, framework-agnostic options and
 * validator for the `ai-extract` AI tool, plus its deterministic output naming.
 *
 * This is the AI-tool sibling of `@/lib/jobs/summarize-pdf.ts` and
 * `@/lib/jobs/translate-pdf.ts`: pure data plus a pure parser — no Next.js, no
 * storage, no AI SDK. It defines exactly what an extraction request may ask for
 * (a free-text extraction PROMPT, or a typed field SCHEMA) so the UI, the worker
 * engine, and the docs share one honest source of truth. It depends only on
 * `./responses` and `./filenames`, so a client component can import the validator
 * without pulling a Node built-in or the AI provider into the bundle.
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

import { apiError, type ParseResult } from "./responses";
import {
  MAX_DISPLAY_FILENAME_LENGTH,
  sanitizeDisplayFilename,
} from "./filenames";

/** The neutral stem used when nothing safe survives filename sanitization. */
const FALLBACK_STEM = "document";

/** How the caller describes what to extract: a free-text prompt or a typed schema. */
export const EXTRACTION_MODES = ["prompt", "schema"] as const;
export type ExtractionMode = (typeof EXTRACTION_MODES)[number];

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
] as const;
export type ExtractionFieldType = (typeof EXTRACTION_FIELD_TYPES)[number];

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

const MODE_SET: ReadonlySet<string> = new Set(EXTRACTION_MODES);
const FIELD_TYPE_SET: ReadonlySet<string> = new Set(EXTRACTION_FIELD_TYPES);

// C0 control characters (U+0000–U+001F) and DEL. The prompt tolerates newline/tab
// (a multi-line instruction is legitimate); field names/descriptions tolerate none.
const CONTROL_CHAR_STRICT = /[\x00-\x1F\x7F]/;
const CONTROL_CHAR_ALLOW_WS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/** One field the caller wants extracted, in schema mode. */
export interface ExtractionField {
  /** The field name — becomes the JSON key in the extraction. Bounded, control-char-free. */
  name: string;
  /** The expected value type. Guides the model and documents the request. */
  type: ExtractionFieldType;
  /** Optional human hint that steers what the field should capture. Bounded. */
  description?: string;
}

/** Validated options for an `ai-extract` job. */
export interface ExtractOptions {
  /** How the request describes what to extract. */
  mode: ExtractionMode;
  /** The free-text extraction instruction. Present iff `mode === "prompt"`. */
  prompt?: string;
  /** The typed field list to extract. Present (non-empty) iff `mode === "schema"`. */
  schema?: ExtractionField[];
}

function invalid(message: string, field: string): ParseResult<never> {
  return {
    ok: false,
    error: apiError("invalid_request", message, [{ field, message }]),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a single schema field defensively, returning a typed field or an error. */
function parseField(raw: unknown, index: number): ParseResult<ExtractionField> {
  const at = `schema[${index}]`;
  if (!isObject(raw)) {
    return invalid(`\`${at}\` must be an object with a \`name\`.`, at);
  }

  if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
    return invalid(`\`${at}.name\` is required.`, `${at}.name`);
  }
  const name = raw.name.trim();
  if (CONTROL_CHAR_STRICT.test(name)) {
    return invalid(
      `\`${at}.name\` cannot contain control characters.`,
      `${at}.name`,
    );
  }
  if (name.length > MAX_FIELD_NAME_CHARS) {
    return invalid(
      `\`${at}.name\` is too long (max ${MAX_FIELD_NAME_CHARS} characters).`,
      `${at}.name`,
    );
  }

  let type: ExtractionFieldType = DEFAULT_FIELD_TYPE;
  if (raw.type !== undefined) {
    if (typeof raw.type !== "string" || !FIELD_TYPE_SET.has(raw.type)) {
      return invalid(
        `\`${at}.type\` must be one of ${EXTRACTION_FIELD_TYPES.join(", ")}.`,
        `${at}.type`,
      );
    }
    type = raw.type as ExtractionFieldType;
  }

  const field: ExtractionField = { name, type };

  if (raw.description !== undefined) {
    if (typeof raw.description !== "string") {
      return invalid(
        `\`${at}.description\` must be a string.`,
        `${at}.description`,
      );
    }
    const description = raw.description.trim();
    if (description.length > 0) {
      if (CONTROL_CHAR_STRICT.test(description)) {
        return invalid(
          `\`${at}.description\` cannot contain control characters.`,
          `${at}.description`,
        );
      }
      if (description.length > MAX_FIELD_DESCRIPTION_CHARS) {
        return invalid(
          `\`${at}.description\` is too long (max ${MAX_FIELD_DESCRIPTION_CHARS} characters).`,
          `${at}.description`,
        );
      }
      field.description = description;
    }
  }

  return { ok: true, value: field };
}

/**
 * Parse the free-form `options` bag of an `ai-extract` job into typed, validated
 * options. Strict and honest: a `mode` is REQUIRED and must be in the allow-list; a
 * `prompt` mode requires a bounded, control-character-free instruction; a `schema`
 * mode requires a non-empty list of typed, uniquely-named fields. A request that
 * does not say what to extract is rejected — the engine never guesses a target.
 */
export function parseExtractOptions(
  options: Record<string, unknown>,
): ParseResult<ExtractOptions> {
  if (!isObject(options)) {
    return invalid("`options` must be an object.", "options");
  }

  if (typeof options.mode !== "string" || !MODE_SET.has(options.mode)) {
    return invalid(
      `\`mode\` is required and must be one of ${EXTRACTION_MODES.join(", ")}.`,
      "mode",
    );
  }
  const mode = options.mode as ExtractionMode;

  if (mode === "prompt") {
    if (
      typeof options.prompt !== "string" ||
      options.prompt.trim().length === 0
    ) {
      return invalid(
        "`prompt` is required in prompt mode — describe what to extract.",
        "prompt",
      );
    }
    const prompt = options.prompt.trim();
    if (CONTROL_CHAR_ALLOW_WS.test(prompt)) {
      return invalid("`prompt` cannot contain control characters.", "prompt");
    }
    if (prompt.length > MAX_EXTRACTION_PROMPT_CHARS) {
      return invalid(
        `\`prompt\` is too long (max ${MAX_EXTRACTION_PROMPT_CHARS} characters).`,
        "prompt",
      );
    }
    return { ok: true, value: { mode, prompt } };
  }

  // schema mode
  if (!Array.isArray(options.schema) || options.schema.length === 0) {
    return invalid(
      "`schema` must be a non-empty array of fields in schema mode.",
      "schema",
    );
  }
  if (options.schema.length > MAX_EXTRACTION_FIELDS) {
    return invalid(
      `\`schema\` has too many fields (max ${MAX_EXTRACTION_FIELDS}).`,
      "schema",
    );
  }

  const fields: ExtractionField[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < options.schema.length; i++) {
    const parsed = parseField(options.schema[i], i);
    if (!parsed.ok) return parsed;
    const key = parsed.value.name.toLowerCase();
    if (seen.has(key)) {
      return invalid(
        `\`schema[${i}].name\` duplicates an earlier field name.`,
        `schema[${i}].name`,
      );
    }
    seen.add(key);
    fields.push(parsed.value);
  }

  return { ok: true, value: { mode, schema: fields } };
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

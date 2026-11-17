/**
 * The validator of an `ai-extract` job's options — `parseExtractOptions`, the
 * one check the route runs before charging, the worker's processor runs
 * again, and AI Data Extraction's saved schemas run on every schema they
 * save, load or import (`./ai-extract-schemas`).
 *
 * Moved out of `./ai-extract` on 2026-11-17 so it is not in the panel's
 * first-load copy of that module (see its docblock). It depends only on
 * `./responses` and `./ai-extract`, so a client chunk can import it without
 * pulling a Node built-in or the AI provider into the bundle.
 */
import { apiError, type ParseResult } from "./responses";
import {
  DEFAULT_FIELD_TYPE,
  EXTRACTION_FIELD_TYPES,
  EXTRACTION_MODES,
  MAX_EXTRACTION_FIELDS,
  MAX_EXTRACTION_PROMPT_CHARS,
  MAX_FIELD_DESCRIPTION_CHARS,
  MAX_FIELD_NAME_CHARS,
  duplicateFieldMessage,
  duplicateFieldNames,
} from "./ai-extract";

/**
 * How the caller describes what to extract. The same words as
 * `EXTRACTION_MODES` in `./ai-extract`, which `satisfies` this type; that the
 * table lists every member is held by `ai-extract.test.ts` (expectTypeOf).
 */
export type ExtractionMode = "prompt" | "schema";

/**
 * The value type a schema field expects. A strict allow-list so the engine, UI, and
 * manifest agree on one vocabulary and an unknown type is rejected, never coerced.
 * `array` is a list of primitive values (e.g. line-item descriptions). The
 * same words as `EXTRACTION_FIELD_TYPES`, held both ways as above.
 */
export type ExtractionFieldType =
  "string" | "number" | "boolean" | "date" | "array";

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

const MODE_SET: ReadonlySet<string> = new Set(EXTRACTION_MODES);
const FIELD_TYPE_SET: ReadonlySet<string> = new Set(EXTRACTION_FIELD_TYPES);

// C0 control characters (U+0000–U+001F) and DEL. The prompt tolerates newline/tab
// (a multi-line instruction is legitimate); field names/descriptions tolerate none.
const CONTROL_CHAR_STRICT = /[\x00-\x1F\x7F]/;
const CONTROL_CHAR_ALLOW_WS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

function invalid(message: string, field: string): ParseResult<never> {
  return {
    ok: false,
    error: apiError("invalid_request", message, [{ field, message }]),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a single schema field defensively, returning a typed field or an error.
 *
 * MESSAGES ARE FOR A READER; THE POINTER IS FOR A PROGRAM. Until 2026-09-28
 * these read like "`schema[1].name` duplicates an earlier field name." — a
 * zero-based JSON path in backticks — and the processor forwarded that
 * verbatim to the panel, where a person who had typed "Total" twice read it.
 * The sentence now counts fields from one, as the panel shows them; the
 * machine-readable path stays in `details[].field` for API callers.
 */
function parseField(raw: unknown, index: number): ParseResult<ExtractionField> {
  const at = `schema[${index}]`;
  const n = index + 1;
  if (!isObject(raw)) {
    return invalid(`Field ${n} must be an object with a name.`, at);
  }

  if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
    return invalid(`Field ${n} needs a name.`, `${at}.name`);
  }
  const name = raw.name.trim();
  if (CONTROL_CHAR_STRICT.test(name)) {
    return invalid(
      `Field ${n}'s name cannot contain control characters.`,
      `${at}.name`,
    );
  }
  if (name.length > MAX_FIELD_NAME_CHARS) {
    return invalid(
      `Field ${n}'s name is too long (max ${MAX_FIELD_NAME_CHARS} characters).`,
      `${at}.name`,
    );
  }

  let type: ExtractionFieldType = DEFAULT_FIELD_TYPE;
  if (raw.type !== undefined) {
    if (typeof raw.type !== "string" || !FIELD_TYPE_SET.has(raw.type)) {
      return invalid(
        `Field ${n}'s type must be one of ${EXTRACTION_FIELD_TYPES.join(", ")}.`,
        `${at}.type`,
      );
    }
    type = raw.type as ExtractionFieldType;
  }

  const field: ExtractionField = { name, type };

  if (raw.description !== undefined) {
    if (typeof raw.description !== "string") {
      return invalid(
        `Field ${n}'s description must be text.`,
        `${at}.description`,
      );
    }
    const description = raw.description.trim();
    if (description.length > 0) {
      if (CONTROL_CHAR_STRICT.test(description)) {
        return invalid(
          `Field ${n}'s description cannot contain control characters.`,
          `${at}.description`,
        );
      }
      if (description.length > MAX_FIELD_DESCRIPTION_CHARS) {
        return invalid(
          `Field ${n}'s description is too long (max ${MAX_FIELD_DESCRIPTION_CHARS} characters).`,
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
    return invalid("The extraction options must be an object.", "options");
  }

  if (typeof options.mode !== "string" || !MODE_SET.has(options.mode)) {
    return invalid(
      `Choose how to describe what to extract: mode must be one of ${EXTRACTION_MODES.join(", ")}.`,
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
        "Describe what to extract — the prompt is empty.",
        "prompt",
      );
    }
    const prompt = options.prompt.trim();
    if (CONTROL_CHAR_ALLOW_WS.test(prompt)) {
      return invalid("The prompt cannot contain control characters.", "prompt");
    }
    if (prompt.length > MAX_EXTRACTION_PROMPT_CHARS) {
      return invalid(
        `The prompt is too long (max ${MAX_EXTRACTION_PROMPT_CHARS} characters).`,
        "prompt",
      );
    }
    return { ok: true, value: { mode, prompt } };
  }

  // schema mode
  if (!Array.isArray(options.schema) || options.schema.length === 0) {
    return invalid("Add at least one field to extract.", "schema");
  }
  if (options.schema.length > MAX_EXTRACTION_FIELDS) {
    return invalid(
      `There are too many fields to extract (max ${MAX_EXTRACTION_FIELDS}).`,
      "schema",
    );
  }

  const fields: ExtractionField[] = [];
  for (let i = 0; i < options.schema.length; i++) {
    const parsed = parseField(options.schema[i], i);
    if (!parsed.ok) return parsed;
    fields.push(parsed.value);
  }
  // The SAME rule the panel applies before upload (`duplicateFieldNames`).
  const [duplicate] = duplicateFieldNames(fields.map((field) => field.name));
  if (duplicate) {
    const [index, earlier] = duplicate;
    return invalid(
      duplicateFieldMessage(index, earlier),
      `schema[${index}].name`,
    );
  }

  return { ok: true, value: { mode, schema: fields } };
}

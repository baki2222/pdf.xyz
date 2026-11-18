/**
 * AI Data Extraction's saved schemas (competitor audit #16): a field list —
 * names, types and hints — kept under a name in THIS browser's localStorage,
 * and the JSON file a schema is exported to and imported from.
 *
 * ONE VALIDATOR. A schema's fields are checked by `parseExtractOptions`, the
 * job contract's own parser, which the route runs before charging and the
 * worker runs again. So a schema that loads is one a job accepts, and a
 * second, looser check cannot let through what the worker then refuses.
 * What this module adds is only what a job request does not have: a name,
 * a count of schemas, a file's size, and a STRICT shape — every object a
 * plain one with only the keys a schema writes, so a `__proto__`,
 * `constructor` or any other unexpected key refuses the whole file.
 *
 * NOTHING IS PARTIALLY APPLIED. Every parse returns a whole schema or a
 * refusal; the panel replaces its field list only with a whole schema.
 *
 * NOTHING HERE MAKES A REQUEST. Storage can be missing (a private window,
 * blocked site data) or full, so every access is wrapped: a read that fails
 * or finds something it cannot read is "nothing saved", and a write that
 * fails says so. Unreadable entries in storage are skipped one by one.
 */
import type { ExtractionField } from "./ai-extract";
import { parseExtractOptions } from "./ai-extract-options";
import { SAVED_SCHEMAS_KEY } from "./ai-extract-schema-key";

export { SAVED_SCHEMAS_KEY };

/** At most this many schemas are kept in one browser. */
export const MAX_SAVED_SCHEMAS = 20;
/** The longest schema name, in characters. */
export const MAX_SCHEMA_NAME_CHARS = 60;
/** The largest schema file an import reads, in bytes. */
export const MAX_SCHEMA_FILE_BYTES = 128 * 1024;
/** What a schema file says it is, so a different JSON file is refused. */
export const SCHEMA_FILE_FORMAT = "pdf.xyz AI Data Extraction schema";
export const SCHEMA_FILE_VERSION = 1;

const STORE_VERSION = 1;
/** Storage text past this is not read at all: every schema at its largest. */
const MAX_STORE_CHARS = MAX_SAVED_SCHEMAS * MAX_SCHEMA_FILE_BYTES;

/** A named field list, exactly as a job would send it. */
export interface SavedSchema {
  readonly name: string;
  readonly fields: readonly ExtractionField[];
}

export type Checked<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const FILE_KEYS: ReadonlySet<string> = new Set([
  "format",
  "version",
  "name",
  "fields",
]);
const STORED_KEYS: ReadonlySet<string> = new Set(["name", "fields"]);
const FIELD_KEYS: ReadonlySet<string> = new Set([
  "name",
  "type",
  "description",
]);

// C0 control characters and DEL, as the job contract refuses in a field name.
const CONTROL_CHAR = /[\x00-\x1F\x7F]/;

const refuse = (message: string): Checked<never> => ({ ok: false, message });

/** A plain JSON object: not null, not an array, not a class instance. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** Own keys only, so a parsed `"__proto__"` key is one of them. */
const onlyKeys = (
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
) => Object.keys(value).every((key) => allowed.has(key));

const nameKey = (name: string) => name.trim().toLowerCase();

/** Why `raw` cannot name a schema, or null when it can. */
export function schemaNameProblem(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0) return "Give the schema a name first.";
  if (name.length > MAX_SCHEMA_NAME_CHARS)
    return `A schema name can be up to ${MAX_SCHEMA_NAME_CHARS} characters.`;
  if (CONTROL_CHAR.test(name))
    return "A schema name cannot contain control characters.";
  return null;
}

/** The job contract's own check of a field list. */
function checkFields(raw: unknown): Checked<ExtractionField[]> {
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      const field: unknown = raw[i];
      // Anything not an object is the job contract's to refuse, in its words.
      if (isPlainRecord(field) && !onlyKeys(field, FIELD_KEYS))
        return refuse(
          `Field ${i + 1} holds something a field does not: only a name, a type and a hint.`,
        );
    }
  }
  const parsed = parseExtractOptions({ mode: "schema", schema: raw });
  if (!parsed.ok) return refuse(parsed.error.body.error.message);
  return { ok: true, value: parsed.value.schema ?? [] };
}

function checkRecord(
  raw: unknown,
  keys: ReadonlySet<string>,
): Checked<SavedSchema> {
  if (!isPlainRecord(raw) || !onlyKeys(raw, keys))
    return refuse("This is not a saved schema.");
  if (typeof raw.name !== "string") return refuse("The schema has no name.");
  const problem = schemaNameProblem(raw.name);
  if (problem) return refuse(problem);
  const fields = checkFields(raw.fields);
  if (!fields.ok) return fields;
  return { ok: true, value: { name: raw.name.trim(), fields: fields.value } };
}

/**
 * The schema the panel's field list makes under `name`: its named rows,
 * checked as the job will check them (rows with a blank name are skipped,
 * as Extract data skips them).
 */
export function schemaFromFields(
  name: string,
  fields: readonly ExtractionField[],
): Checked<SavedSchema> {
  const problem = schemaNameProblem(name);
  if (problem) return refuse(problem);
  const named = fields
    .filter((field) => field.name.trim().length > 0)
    .map((field) => ({
      name: field.name,
      type: field.type,
      ...(field.description?.trim() ? { description: field.description } : {}),
    }));
  const checked = checkFields(named);
  if (!checked.ok) return checked;
  return { ok: true, value: { name: name.trim(), fields: checked.value } };
}

/** The text of a schema file. */
export function schemaFileText(schema: SavedSchema): string {
  return `${JSON.stringify(
    {
      format: SCHEMA_FILE_FORMAT,
      version: SCHEMA_FILE_VERSION,
      name: schema.name,
      fields: schema.fields,
    },
    null,
    2,
  )}\n`;
}

/** A download name for a schema file: `invoice-fields.schema.json`. */
export function schemaFileName(name: string): string {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${stem || "schema"}.schema.json`;
}

/** The plain size of the file limit, for a refusal. */
export const SCHEMA_FILE_LIMIT = `${MAX_SCHEMA_FILE_BYTES / 1024} KB`;

/** A file this large is refused before it is read. */
export function schemaFileTooLarge(bytes: number): string | null {
  return bytes > MAX_SCHEMA_FILE_BYTES
    ? `This file is larger than a schema file can be (${SCHEMA_FILE_LIMIT}).`
    : null;
}

/** A whole schema from a schema file's text, or why not. */
export function parseSchemaFile(text: string): Checked<SavedSchema> {
  // Characters are at most bytes, so this bounds what JSON.parse is given.
  const tooLarge = schemaFileTooLarge(text.length);
  if (tooLarge) return refuse(tooLarge);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse("This file is not a schema file: it is not valid JSON.");
  }
  if (
    !isPlainRecord(parsed) ||
    parsed.format !== SCHEMA_FILE_FORMAT ||
    parsed.version !== SCHEMA_FILE_VERSION
  )
    return refuse(
      "This file is not a schema file exported from AI Data Extraction.",
    );
  if (!onlyKeys(parsed, FILE_KEYS))
    return refuse(
      "This file holds more than a schema: only a name and fields.",
    );
  return checkRecord(parsed, FILE_KEYS);
}

// ── This browser's storage ────────────────────────────────────────────────

/** localStorage, or undefined where even reaching it throws. */
export function schemaStorage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

/** True when this browser lets a schema be kept: a write is tried. */
export function storageWorks(storage: Storage | undefined): boolean {
  if (!storage) return false;
  try {
    const held = storage.getItem(SAVED_SCHEMAS_KEY);
    // Writes back what is there, or writes and removes an empty list.
    storage.setItem(SAVED_SCHEMAS_KEY, held ?? storeText([]));
    if (held === null) storage.removeItem(SAVED_SCHEMAS_KEY);
    return true;
  } catch {
    return false;
  }
}

function storeText(schemas: readonly SavedSchema[]): string {
  return JSON.stringify({ version: STORE_VERSION, schemas });
}

/**
 * The schemas this browser holds, newest first. Anything it cannot read —
 * not JSON, the wrong shape, an entry the job contract would refuse, a
 * repeated name, more than the cap — is skipped, never repaired.
 */
export function readSavedSchemas(storage: Storage | undefined): SavedSchema[] {
  try {
    const raw = storage?.getItem(SAVED_SCHEMAS_KEY);
    if (!raw || raw.length > MAX_STORE_CHARS) return [];
    const parsed: unknown = JSON.parse(raw);
    if (
      !isPlainRecord(parsed) ||
      parsed.version !== STORE_VERSION ||
      !Array.isArray(parsed.schemas)
    )
      return [];
    const out: SavedSchema[] = [];
    const seen = new Set<string>();
    for (const entry of parsed.schemas as unknown[]) {
      if (out.length >= MAX_SAVED_SCHEMAS) break;
      const checked = checkRecord(entry, STORED_KEYS);
      if (!checked.ok) continue;
      const key = nameKey(checked.value.name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(checked.value);
    }
    return out;
  } catch {
    return [];
  }
}

/** True when `schemas` is now what storage holds. */
export function writeSavedSchemas(
  schemas: readonly SavedSchema[],
  storage: Storage | undefined,
): boolean {
  if (!storage) return false;
  try {
    if (schemas.length === 0) storage.removeItem(SAVED_SCHEMAS_KEY);
    else storage.setItem(SAVED_SCHEMAS_KEY, storeText(schemas));
    return true;
  } catch {
    return false;
  }
}

/** What saving did, and the list storage holds afterwards. */
export type SaveOutcome =
  | {
      readonly ok: true;
      readonly schemas: SavedSchema[];
      readonly saved: SavedSchema;
      /** The schema it replaced, which had the same name. */
      readonly replaced: SavedSchema | null;
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly schemas: SavedSchema[];
    };

export const SAVE_REFUSED =
  "This browser did not let pdf.xyz keep it, so it was not saved. Export it as a file instead.";

/** Keep `schema`, newest first; a schema of the same name is replaced. */
export function saveSchema(
  schema: SavedSchema,
  storage: Storage | undefined,
): SaveOutcome {
  const schemas = readSavedSchemas(storage);
  const key = nameKey(schema.name);
  const replaced = schemas.find((s) => nameKey(s.name) === key) ?? null;
  if (!replaced && schemas.length >= MAX_SAVED_SCHEMAS)
    return {
      ok: false,
      message: `This browser already keeps ${MAX_SAVED_SCHEMAS} schemas, the most it can. Delete one to save another.`,
      schemas,
    };
  const next = [schema, ...schemas.filter((s) => nameKey(s.name) !== key)];
  if (!writeSavedSchemas(next, storage))
    return { ok: false, message: SAVE_REFUSED, schemas };
  return { ok: true, schemas: next, saved: schema, replaced };
}

/** Forget the schema called `name`; returns what storage holds. */
export function deleteSchema(
  name: string,
  storage: Storage | undefined,
): { readonly ok: boolean; readonly schemas: SavedSchema[] } {
  const schemas = readSavedSchemas(storage);
  const next = schemas.filter((s) => nameKey(s.name) !== nameKey(name));
  if (!writeSavedSchemas(next, storage)) return { ok: false, schemas };
  return { ok: true, schemas: next };
}

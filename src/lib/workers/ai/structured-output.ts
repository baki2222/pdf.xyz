/**
 * Structured output: asking a provider to CONSTRAIN its reply to a JSON
 * Schema, instead of only asking for JSON in the prompt.
 *
 * Pure data and pure functions — no network, no Node built-ins — so the
 * adapters (`./openai`, `./anthropic`) and the AI Extract engine share one
 * definition of what a schema may contain and what goes on the wire.
 *
 * WHY A SUBSET. Both providers accept only part of JSON Schema in their
 * constrained mode, and OpenAI's `strict: true` adds two rules of its own:
 * every object is closed (`additionalProperties: false`) and lists EVERY
 * property in `required`. A property the caller left optional therefore goes
 * on the wire as REQUIRED-BUT-NULLABLE, and {@link restoreOptionalNulls} takes
 * those nulls back out of the parsed reply, so a caller reads the shape it
 * asked for. A schema outside the subset is not sent at all
 * ({@link structuredSchemaProblem}); the caller keeps the prompt-only path.
 *
 * WHY THE LIMITS ARE A BET, NOT A FACT. The ceilings below are the stricter of
 * the two providers' published limits as we know them, and a constant has no
 * relationships to constrain (CLAUDE.md rule 3). The second, independent bound
 * is in each adapter: a 400 that names the structured-output parameter is
 * retried ONCE without it, so a ceiling we set too high costs one free 400,
 * never a broken tool.
 */

/** A JSON Schema the caller wants the reply to match, plus a wire name. */
export interface AiJsonSchema {
  /** Wire name (OpenAI requires one): 1-64 of `[A-Za-z0-9_-]`. */
  name: string;
  /** The root schema. Must be an object schema inside the supported subset. */
  schema: Record<string, unknown>;
}

/** The JSON types both providers accept in a constrained schema. */
const JSON_TYPES: ReadonlySet<string> = new Set([
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
]);

/**
 * The keywords a schema node may carry. Anything else — `minLength`,
 * `minimum`, `pattern`, `format`, `$ref` — is outside the subset one provider
 * or the other rejects, so it is refused here rather than discovered as a 400.
 */
const ALLOWED_KEYWORDS: ReadonlySet<string> = new Set([
  "type",
  "description",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "anyOf",
]);

/** The wire-name shape OpenAI's `json_schema.name` requires. */
export const STRUCTURED_SCHEMA_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** Ceilings: the stricter of the two providers' published limits. */
export const STRUCTURED_SCHEMA_LIMITS = {
  /** Object properties across the whole schema (OpenAI: 100 in its first limits). */
  maxProperties: 100,
  /** Object nesting depth (OpenAI: 5 in its first limits). */
  maxDepth: 5,
  /** Characters across every property name and enum value (OpenAI: 15,000). */
  maxNameCharacters: 15_000,
  /**
   * Nodes that are a UNION — a type list or an `anyOf` (Anthropic's
   * documented complexity limit). A nullable field is a union, so this is
   * the bound a long field list meets first.
   */
  maxUnions: 16,
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The node's `type` as a list (empty when absent). */
function typesOf(node: Record<string, unknown>): string[] {
  const type = node.type;
  if (typeof type === "string") return [type];
  if (Array.isArray(type))
    return type.filter((t): t is string => typeof t === "string");
  return [];
}

interface WalkTally {
  properties: number;
  nameCharacters: number;
  unions: number;
}

function walk(node: unknown, depth: number, tally: WalkTally): string | null {
  if (!isPlainObject(node)) return "a schema node is not an object";
  for (const key of Object.keys(node)) {
    if (!ALLOWED_KEYWORDS.has(key)) return `unsupported keyword "${key}"`;
  }
  if (node.description !== undefined && typeof node.description !== "string")
    return "a description is not text";

  const types = typesOf(node);
  if (node.type !== undefined) {
    const raw = Array.isArray(node.type) ? node.type : [node.type];
    if (raw.length === 0 || types.length !== raw.length)
      return "a type is not a string";
    if (new Set(types).size !== types.length) return "a type repeats";
    for (const t of types) if (!JSON_TYPES.has(t)) return `unknown type "${t}"`;
  }
  if (types.length > 1) tally.unions += 1;

  if (node.enum !== undefined) {
    if (!Array.isArray(node.enum) || node.enum.length === 0)
      return "an enum is empty";
    for (const value of node.enum) {
      if (value !== null && typeof value === "object")
        return "an enum value is not a primitive";
      if (typeof value === "string") tally.nameCharacters += value.length;
    }
  }

  if (node.anyOf !== undefined) {
    if (!Array.isArray(node.anyOf) || node.anyOf.length < 2)
      return "an anyOf needs two branches";
    if (node.type !== undefined) return "an anyOf beside a type";
    tally.unions += 1;
    for (const branch of node.anyOf) {
      const problem = walk(branch, depth, tally);
      if (problem) return problem;
    }
  } else if (node.type === undefined && node.enum === undefined) {
    return "a node has no type";
  }

  const isObject = types.includes("object");
  if (isObject) {
    if (depth + 1 > STRUCTURED_SCHEMA_LIMITS.maxDepth)
      return "the schema nests too deeply";
    if (!isPlainObject(node.properties))
      return "an object schema has no properties";
    if (
      node.additionalProperties !== undefined &&
      node.additionalProperties !== false
    )
      return "additionalProperties may only be false";
    const names = Object.keys(node.properties);
    if (node.required !== undefined) {
      if (
        !Array.isArray(node.required) ||
        node.required.some((r) => typeof r !== "string" || !names.includes(r))
      )
        return "required names a property that does not exist";
    }
    for (const name of names) {
      tally.properties += 1;
      tally.nameCharacters += name.length;
      const problem = walk(node.properties[name], depth + 1, tally);
      if (problem) return problem;
    }
  } else if (
    node.properties !== undefined ||
    node.required !== undefined ||
    node.additionalProperties !== undefined
  ) {
    return "object keywords on a non-object";
  }

  if (types.includes("array")) {
    if (node.items === undefined) return "an array schema has no items";
    const problem = walk(node.items, depth, tally);
    if (problem) return problem;
  } else if (node.items !== undefined) {
    return "items on a non-array";
  }
  return null;
}

/**
 * Why `schema` cannot be sent in constrained mode, or `null` when it can.
 * The root must be an object schema. The reason is for tests and logs only —
 * it is never shown to a user.
 */
export function structuredSchemaProblem(schema: AiJsonSchema): string | null {
  if (!STRUCTURED_SCHEMA_NAME.test(schema.name))
    return "the schema name is not 1-64 of [A-Za-z0-9_-]";
  const root = schema.schema;
  if (!isPlainObject(root) || root.type !== "object")
    return "the root is not an object schema";
  const problem = walk(root, 0, {
    properties: 0,
    nameCharacters: 0,
    unions: 0,
  });
  if (problem) return problem;
  // The limits are counted on what goes on the WIRE: the strict form turns
  // every optional property into a nullable one, which is a union the
  // caller's own schema did not have.
  const tally: WalkTally = { properties: 0, nameCharacters: 0, unions: 0 };
  const wire = walk(toStrictJsonSchema(root), 0, tally);
  if (wire) return wire;
  if (tally.properties > STRUCTURED_SCHEMA_LIMITS.maxProperties)
    return "too many properties";
  if (tally.nameCharacters > STRUCTURED_SCHEMA_LIMITS.maxNameCharacters)
    return "property names and enum values are too long in total";
  if (tally.unions > STRUCTURED_SCHEMA_LIMITS.maxUnions)
    return "too many nullable or union-typed values";
  return null;
}

/** The node made to accept `null` as well, without changing what else it accepts. */
function nullable(node: Record<string, unknown>): Record<string, unknown> {
  if (node.anyOf !== undefined) {
    const branches = node.anyOf as Record<string, unknown>[];
    return branches.some((b) => typesOf(b).includes("null"))
      ? node
      : { ...node, anyOf: [...branches, { type: "null" }] };
  }
  if (node.type === undefined) {
    // An enum alone: null joins its values.
    const values = node.enum as unknown[];
    return values.includes(null) ? node : { ...node, enum: [...values, null] };
  }
  const types = typesOf(node);
  if (types.includes("null")) return node;
  const widened: Record<string, unknown> = {
    ...node,
    type: [...types, "null"],
  };
  if (Array.isArray(node.enum) && !node.enum.includes(null))
    widened.enum = [...node.enum, null];
  return widened;
}

/**
 * The strict form both adapters put on the wire: every object closed and
 * every property required, a property that was optional made nullable
 * instead. A schema already in that form comes back deep-equal (the AI
 * Extract schema is one — every field is required and nullable by design).
 *
 * Call only on a schema {@link structuredSchemaProblem} accepted.
 */
export function toStrictJsonSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...schema };
  if (Array.isArray(schema.anyOf)) {
    out.anyOf = (schema.anyOf as Record<string, unknown>[]).map((b) =>
      toStrictJsonSchema(b),
    );
  }
  if (isPlainObject(schema.items)) {
    out.items = toStrictJsonSchema(schema.items);
  }
  if (isPlainObject(schema.properties) && typesOf(schema).includes("object")) {
    const required = new Set(
      Array.isArray(schema.required) ? (schema.required as string[]) : [],
    );
    const properties: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(schema.properties)) {
      const strict = toStrictJsonSchema(child as Record<string, unknown>);
      properties[name] = required.has(name) ? strict : nullable(strict);
    }
    out.properties = properties;
    out.required = Object.keys(properties);
    out.additionalProperties = false;
  }
  return out;
}

/**
 * Undo the one change {@link toStrictJsonSchema} makes to a reply: a property
 * the ORIGINAL schema left optional comes back as `null` when the model had
 * nothing for it; that null is removed, so the property is absent as the
 * caller's schema allows. A null on a REQUIRED property is the model's answer
 * and stays. Returns a new value; the input is not modified.
 */
export function restoreOptionalNulls(
  value: unknown,
  schema: Record<string, unknown>,
): unknown {
  if (Array.isArray(value)) {
    const items = schema.items;
    return isPlainObject(items)
      ? value.map((v) => restoreOptionalNulls(v, items))
      : value;
  }
  if (!isPlainObject(value)) return value;
  if (Array.isArray(schema.anyOf)) {
    // The branch that describes an object, when exactly one does.
    const objects = (schema.anyOf as Record<string, unknown>[]).filter((b) =>
      isPlainObject(b.properties),
    );
    return objects.length === 1
      ? restoreOptionalNulls(value, objects[0]!)
      : value;
  }
  if (!isPlainObject(schema.properties)) return value;
  const properties = schema.properties as Record<
    string,
    Record<string, unknown>
  >;
  const required = new Set(
    Array.isArray(schema.required) ? (schema.required as string[]) : [],
  );
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const childSchema = properties[key];
    if (childSchema === undefined) {
      out[key] = child;
      continue;
    }
    if (child === null && !required.has(key)) continue;
    out[key] = restoreOptionalNulls(child, childSchema);
  }
  return out;
}

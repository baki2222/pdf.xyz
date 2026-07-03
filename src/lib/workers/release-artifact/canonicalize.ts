/**
 * Pure, node-free **canonical JSON** serializer for the release evidence artifact (Phase 47).
 *
 * The integrity digest must be reproducible by any verifier from the archived body alone, regardless
 * of how a JSON pretty-printer happened to order or space the fields. So the digest is NOT computed
 * over the rendered bytes — it is computed over this deterministic CANONICAL form:
 *  - object keys are sorted lexicographically (by UTF-16 code unit, i.e. `String.prototype.sort`);
 *  - arrays keep their order;
 *  - there is no insignificant whitespace (`{"a":1,"b":2}`, not `{ "a": 1, "b": 2 }`);
 *  - strings use standard JSON string escaping (via `JSON.stringify` of the single string);
 *  - `undefined` object values are omitted (as `JSON.stringify` does);
 *  - non-finite numbers serialize to `null` (as `JSON.stringify` does).
 *
 * This is the `pdfxyz-sorted-keys/1` scheme named in {@link import("./types").RELEASE_ARTIFACT_CANONICALIZATION}.
 * It is intentionally simple rather than full RFC 8785 (JCS): the artifact body carries only bounded
 * enums, small non-negative integers, ISO stamps, and app-authored prose — never a float or a large
 * magnitude — so JavaScript's default `String(number)` formatting is already canonical for every
 * value the body can hold, and a heavier number-canonicalization pass would add risk without changing
 * a single byte. A test pins determinism (key-order independence + idempotence) so the scheme cannot
 * silently drift.
 *
 * It is a leaf with no I/O, clock, or Node built-in, so `./digest` can hash its output behind an
 * injected hash seam and every rule stays deterministically unit-testable.
 */

/** A JSON-serializable value the canonicalizer produces stable output for. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Serialize one value to its canonical fragment (recursively, keys sorted). */
function serialize(value: unknown): string {
  if (value === null || value === undefined) return "null";

  const type = typeof value;
  if (type === "number") {
    return Number.isFinite(value as number) ? String(value) : "null";
  }
  if (type === "boolean") return value ? "true" : "false";
  if (type === "string") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item)).join(",")}]`;
  }

  if (type === "object") {
    // A plain object: sort own enumerable string keys, drop `undefined` values (JSON semantics).
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const child = obj[key];
      if (child === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${serialize(child)}`);
    }
    return `{${parts.join(",")}}`;
  }

  // function / symbol / bigint — never present in the bounded body; normalize to null defensively.
  return "null";
}

/**
 * Canonicalize `value` to a deterministic, key-sorted, minimally-separated JSON string — the exact
 * pre-image the integrity digest is computed over. Accepts `unknown` (the artifact body is a
 * well-typed interface, and a verifier passes a `JSON.parse` result) but only ever emits stable
 * output for JSON-shaped data. Determinism is a pure function of `value`: two structurally-equal
 * inputs (any key order) produce byte-identical output, and running it on its own `JSON.parse`
 * output is idempotent.
 */
export function canonicalize(value: unknown): string {
  return serialize(value);
}

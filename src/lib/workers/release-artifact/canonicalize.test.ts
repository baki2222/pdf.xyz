/**
 * Determinism proof for the canonical JSON serializer (Phase 47). The integrity digest is only as
 * reproducible as this function: two structurally-equal inputs (any key order) MUST canonicalize to
 * byte-identical strings, and canonicalizing a `JSON.parse` round-trip MUST be idempotent.
 */

import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonicalize";

describe("canonicalize", () => {
  it("sorts object keys deterministically regardless of insertion order", () => {
    const a = canonicalize({ b: 1, a: 2, c: 3 });
    const b = canonicalize({ c: 3, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":3}');
  });

  it("sorts nested object keys too", () => {
    expect(canonicalize({ z: { y: 1, x: 2 }, a: [3, { q: 1, p: 2 }] })).toBe(
      '{"a":[3,{"p":2,"q":1}],"z":{"x":2,"y":1}}',
    );
  });

  it("preserves array order (arrays are ordered, objects are not)", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("emits no insignificant whitespace", () => {
    expect(canonicalize({ a: 1, b: [1, 2] })).toBe('{"a":1,"b":[1,2]}');
  });

  it("omits undefined object values (JSON semantics) and renders null as null", () => {
    expect(canonicalize({ a: undefined, b: null, c: 1 })).toBe('{"b":null,"c":1}');
  });

  it("normalizes non-finite numbers to null", () => {
    expect(canonicalize({ a: Number.POSITIVE_INFINITY, b: Number.NaN })).toBe('{"a":null,"b":null}');
  });

  it("escapes strings via standard JSON string encoding", () => {
    expect(canonicalize({ s: 'a"b\\c\n' })).toBe('{"s":"a\\"b\\\\c\\n"}');
  });

  it("is idempotent over a JSON.parse round-trip", () => {
    const value = { b: [2, 1], a: { d: 4, c: 3 }, e: "x" };
    const once = canonicalize(value);
    const twice = canonicalize(JSON.parse(once));
    expect(twice).toBe(once);
  });

  it("is stable across two independently-built equal objects", () => {
    const build1 = () => ({ metadata: { git: { commit: "abc", cleanliness: "clean" } }, verdict: "pass" });
    const build2 = () => ({ verdict: "pass", metadata: { git: { cleanliness: "clean", commit: "abc" } } });
    expect(canonicalize(build1())).toBe(canonicalize(build2()));
  });
});

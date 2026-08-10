// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  normalizeInventoryRecord,
  objectAgeBucket,
  objectSizeBucket,
  parseArtifactInventory,
} from "./inventory";

describe("parseArtifactInventory", () => {
  it("rejects an empty document", () => {
    const r = parseArtifactInventory("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.code).toBe("empty-document");
  });

  it("rejects malformed JSON", () => {
    const r = parseArtifactInventory("{ not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.code).toBe("malformed-json");
  });

  it("rejects a non-inventory scalar", () => {
    const r = parseArtifactInventory("42");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.code).toBe("not-an-object");
  });

  it("rejects an object with no records array", () => {
    const r = parseArtifactInventory(JSON.stringify({ foo: "bar" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.code).toBe("no-records");
  });

  it("rejects an oversized document", () => {
    const big = "x".repeat(1024 * 1024 + 1);
    const r = parseArtifactInventory(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.code).toBe("too-large");
  });

  it("rejects too many records", () => {
    const r = parseArtifactInventory(
      JSON.stringify(new Array(100_001).fill({})),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.code).toBe("too-large");
  });

  it("accepts a bare array", () => {
    const r = parseArtifactInventory(JSON.stringify([{ lifecycle: "live" }]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.inventory.records).toHaveLength(1);
  });

  it("accepts an { artifacts: [...] } envelope", () => {
    const r = parseArtifactInventory(JSON.stringify({ artifacts: [{}, {}] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.inventory.records).toHaveLength(2);
  });

  it("accepts a { records: [...] } envelope", () => {
    const r = parseArtifactInventory(JSON.stringify({ records: [{}] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.inventory.records).toHaveLength(1);
  });

  it("preserves a non-object entry as a structurally invalid record (never dropped)", () => {
    const r = parseArtifactInventory(JSON.stringify([42, "x", null, {}]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.inventory.records).toHaveLength(4);
      expect(r.inventory.records.filter((rec) => !rec.wellFormed)).toHaveLength(
        3,
      );
    }
  });
});

describe("normalizeInventoryRecord", () => {
  it("maps a non-object to a fully-unknown, not-well-formed record", () => {
    const rec = normalizeInventoryRecord(42);
    expect(rec.wellFormed).toBe(false);
    expect(rec).toMatchObject({
      declaredLifecycle: null,
      expiresAtMs: null,
      deleted: false,
      manifest: "unknown",
      provider: "unknown",
      kind: "unknown",
      processor: "other",
      age: "unknown",
      size: "unknown",
    });
  });

  it("keeps recognized enum values and buckets raw age/size", () => {
    const rec = normalizeInventoryRecord({
      lifecycle: "expired",
      manifest: "valid",
      provider: "remote-configured",
      kind: "archive",
      processor: "ocr",
      ageMs: 3_600_000 * 5,
      sizeBytes: 1024 * 200,
    });
    expect(rec).toMatchObject({
      declaredLifecycle: "expired",
      manifest: "valid",
      provider: "remote-configured",
      kind: "archive",
      processor: "ocr",
      age: "1-24h",
      size: "64kb-1mb",
      wellFormed: true,
    });
  });

  it("degrades garbage field values to the honest sentinels (never fabricated)", () => {
    const rec = normalizeInventoryRecord({
      lifecycle: "s3://evil/key",
      manifest: "../etc/passwd",
      provider: "https://bucket.example",
      kind: "not-a-kind",
      processor: "weird",
      ageMs: -5,
      sizeBytes: "big",
    });
    expect(rec).toMatchObject({
      declaredLifecycle: null,
      manifest: "unknown",
      provider: "unknown",
      kind: "unknown",
      processor: "other",
      age: "unknown",
      size: "unknown",
    });
  });

  it("carries retention evidence but resolves lifecycle later", () => {
    const rec = normalizeInventoryRecord({ expiresAtMs: 1000, deleted: true });
    expect(rec.expiresAtMs).toBe(1000);
    expect(rec.deleted).toBe(true);
  });

  it("prefers a pre-bucketed age/size string when present", () => {
    const rec = normalizeInventoryRecord({
      age: "over-30d",
      size: "over-100mb",
    });
    expect(rec.age).toBe("over-30d");
    expect(rec.size).toBe("over-100mb");
  });

  it("only treats deleted === true as a tombstone", () => {
    expect(normalizeInventoryRecord({ deleted: 1 }).deleted).toBe(false);
    expect(normalizeInventoryRecord({ deleted: "true" }).deleted).toBe(false);
    expect(normalizeInventoryRecord({ deleted: true }).deleted).toBe(true);
  });
});

describe("bucketing", () => {
  it("buckets age boundaries", () => {
    expect(objectAgeBucket(null)).toBe("unknown");
    expect(objectAgeBucket(60_000)).toBe("under-1h");
    expect(objectAgeBucket(3_600_000 * 2)).toBe("1-24h");
    expect(objectAgeBucket(3_600_000 * 24 * 3)).toBe("1-7d");
    expect(objectAgeBucket(3_600_000 * 24 * 10)).toBe("7-30d");
    expect(objectAgeBucket(3_600_000 * 24 * 60)).toBe("over-30d");
  });

  it("buckets size boundaries", () => {
    expect(objectSizeBucket(null)).toBe("unknown");
    expect(objectSizeBucket(1024)).toBe("under-64kb");
    expect(objectSizeBucket(1024 * 500)).toBe("64kb-1mb");
    expect(objectSizeBucket(1024 * 1024 * 5)).toBe("1-10mb");
    expect(objectSizeBucket(1024 * 1024 * 50)).toBe("10-100mb");
    expect(objectSizeBucket(1024 * 1024 * 500)).toBe("over-100mb");
  });
});

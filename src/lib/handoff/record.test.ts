import { describe, expect, it } from "vitest";
import {
  DEFAULT_HANDOFF_TTL_MS,
  isHandoffExpired,
  makeHandoffRecord,
  summarizeHandoff,
  totalHandoffBytes,
} from "./record";
import type { HandoffFileEntry } from "./types";

function entry(name: string, size: number): HandoffFileEntry {
  return {
    name,
    size,
    type: "application/pdf",
    blob: new Blob([new Uint8Array(size)]),
  };
}

describe("makeHandoffRecord", () => {
  it("computes expiry from the injected clock + default TTL", () => {
    const record = makeHandoffRecord({
      id: "h_1",
      toolSlug: "merge-pdf",
      files: [entry("a.pdf", 10)],
      now: 1_000,
    });
    expect(record.createdAt).toBe(1_000);
    expect(record.expiresAt).toBe(1_000 + DEFAULT_HANDOFF_TTL_MS);
    expect(record.toolSlug).toBe("merge-pdf");
    expect(record.files).toHaveLength(1);
  });

  it("honors a custom positive TTL and falls back on invalid ones", () => {
    expect(
      makeHandoffRecord({
        id: "h",
        toolSlug: "t",
        files: [],
        now: 0,
        ttlMs: 500,
      }).expiresAt,
    ).toBe(500);
    // Zero/negative/NaN TTLs fall back to the default rather than expiring instantly.
    for (const bad of [0, -100, Number.NaN]) {
      expect(
        makeHandoffRecord({
          id: "h",
          toolSlug: "t",
          files: [],
          now: 0,
          ttlMs: bad,
        }).expiresAt,
      ).toBe(DEFAULT_HANDOFF_TTL_MS);
    }
  });
});

describe("isHandoffExpired", () => {
  const record = makeHandoffRecord({
    id: "h",
    toolSlug: "t",
    files: [],
    now: 0,
    ttlMs: 1_000,
  });

  it("is not expired before the boundary, expired at/after it", () => {
    expect(isHandoffExpired(record, 999)).toBe(false);
    expect(isHandoffExpired(record, 1_000)).toBe(true); // boundary is inclusive
    expect(isHandoffExpired(record, 5_000)).toBe(true);
  });
});

describe("summarizeHandoff / totalHandoffBytes", () => {
  it("sums sizes and drops the bytes from the summary", () => {
    const record = makeHandoffRecord({
      id: "h_2",
      toolSlug: "compress-pdf",
      files: [entry("a.pdf", 100), entry("b.pdf", 250)],
      now: 42,
      ttlMs: 10,
    });
    expect(totalHandoffBytes(record.files)).toBe(350);
    const summary = summarizeHandoff(record);
    expect(summary).toEqual({
      id: "h_2",
      toolSlug: "compress-pdf",
      createdAt: 42,
      expiresAt: 52,
      fileCount: 2,
      totalBytes: 350,
    });
    expect("blob" in summary).toBe(false);
  });
});

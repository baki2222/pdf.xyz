import { describe, expect, it } from "vitest";
import {
  DEFAULT_HANDOFF_TTL_MS,
  isHandoffExpired,
  makeHandoffRecord,
  summarizeHandoff,
  totalHandoffBytes,
} from "./record";
import { MAX_TRAIL } from "./origin";
import type { HandoffFileEntry } from "./types";

const WORKSPACE = { kind: "workspace" } as const;

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
      origin: WORKSPACE,
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
        origin: WORKSPACE,
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
          origin: WORKSPACE,
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
    origin: WORKSPACE,
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
      origin: WORKSPACE,
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

describe("makeHandoffRecord — provenance (hand-off v2)", () => {
  it("records where the files came from, the job's trail and a pending step", () => {
    const record = makeHandoffRecord({
      id: "h_3",
      toolSlug: "word-to-pdf",
      files: [entry("report.docx", 10)],
      now: 0,
      origin: { kind: "drop", surface: "home" },
      trail: ["merge-pdf"],
      pending: { toolSlug: "merge-pdf", parkedId: "h_0123456789abcdef" },
    });
    expect(record.origin).toEqual({ kind: "drop", surface: "home" });
    expect(record.trail).toEqual(["merge-pdf"]);
    expect(record.pending).toEqual({
      toolSlug: "merge-pdf",
      parkedId: "h_0123456789abcdef",
    });
  });

  it("keeps only the most recent steps of a long trail, and omits empty extras", () => {
    const trail = Array.from({ length: MAX_TRAIL + 2 }, (_, i) => `step-${i}`);
    const record = makeHandoffRecord({
      id: "h_4",
      toolSlug: "compress-pdf",
      files: [],
      now: 0,
      origin: WORKSPACE,
      trail,
    });
    expect(record.trail).toEqual(trail.slice(-MAX_TRAIL));
    const bare = makeHandoffRecord({
      id: "h_5",
      toolSlug: "compress-pdf",
      files: [],
      now: 0,
      origin: WORKSPACE,
    });
    expect("trail" in bare).toBe(false);
    expect("pending" in bare).toBe(false);
  });
});

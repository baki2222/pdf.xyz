// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-ack example fixtures under `docs/examples/release-handoff-ack/`.
 * It pins each publish-pack fixture to its schema, asserts it is content-free, and DRIVES the real ack modules over
 * the fixtures to prove the documented acknowledgement verdicts. Offline: it reads committed files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAckResult } from "./build";
import { ingestAckFrom } from "./fixtures";
import type { ReleaseAckDecision, ReleaseAckNote, ReleaseAckVerdict } from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-handoff-ack");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const PACKS = [
  "publish-pack-publishable.json",
  "publish-pack-review.json",
  "publish-pack-incomplete.json",
  "publish-pack-blocked.json",
  "publish-pack-tampered.json",
];
const FILES = [...PACKS, "not-a-publish-pack.json"];

// Locator-SHAPED tokens only (real endpoints, keys, schemes, paths) — never bare prose words like "secret" or "path",
// which the pack's own honesty caveats legitimately mention. Mirrors the release-publish-pack set.
const FORBIDDEN = [
  "amazonaws",
  "akia",
  "://",
  "us-east-1",
  "upstash",
  "cloudflarestorage",
  "/tmp/",
  "customer",
  ".pdf",
  "bearer ",
  "secretaccesskey",
];

/** Acknowledge a committed pack fixture with a decision + optional note, and return the ack verdict. */
function ack(
  file: string,
  decision: ReleaseAckDecision,
  opts: { note?: ReleaseAckNote; strict?: boolean } = {},
): ReleaseAckVerdict {
  return buildAckResult(
    "2026-07-04T00:00:00.000Z",
    ingestAckFrom(readJson(file)),
    decision,
    "unknown",
    opts.note ?? "none",
    opts.strict ?? false,
  ).ack.verdict;
}

describe("release-ack examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("each pack fixture carries the publish-pack schema; the decoy does not", () => {
    for (const f of PACKS) {
      expect((readJson(f) as { schema: string }).schema).toBe("pdfxyz.release-publish-pack/1");
    }
    expect((readJson("not-a-publish-pack.json") as { schema: string }).schema).not.toMatch(/release-/);
  });
});

describe("release-ack examples — drive the documented verdicts", () => {
  it("accepted over the publishable pack is acknowledged (exit 0)", () => {
    expect(ack("publish-pack-publishable.json", "accepted")).toBe("acknowledged");
  });

  it("accepted-with-notes / a note class over the publishable pack is acknowledged-with-followup", () => {
    expect(ack("publish-pack-publishable.json", "accepted-with-notes")).toBe("acknowledged-with-followup");
    expect(ack("publish-pack-publishable.json", "accepted", { note: "security-review" })).toBe("acknowledged-with-followup");
  });

  it("accepted over the review pack is acknowledged-with-followup", () => {
    expect(ack("publish-pack-review.json", "accepted")).toBe("acknowledged-with-followup");
  });

  it("accepted over the incomplete pack, or a deferred decision, is deferred", () => {
    expect(ack("publish-pack-incomplete.json", "accepted")).toBe("deferred");
    expect(ack("publish-pack-publishable.json", "deferred")).toBe("deferred");
  });

  it("rejected / needs-changes, or a blocked pack, is rejected", () => {
    expect(ack("publish-pack-publishable.json", "rejected")).toBe("rejected");
    expect(ack("publish-pack-publishable.json", "needs-changes")).toBe("rejected");
    expect(ack("publish-pack-blocked.json", "accepted")).toBe("rejected");
  });

  it("a tampered pack, or a non-pack, is invalid (never a vacuous pass)", () => {
    expect(ack("publish-pack-tampered.json", "accepted")).toBe("invalid");
    expect(ack("not-a-publish-pack.json", "accepted")).toBe("invalid");
  });

  it("--strict escalates a follow-up / deferral to rejected", () => {
    expect(ack("publish-pack-publishable.json", "accepted", { strict: true })).toBe("acknowledged");
    expect(ack("publish-pack-review.json", "accepted", { strict: true })).toBe("rejected");
    expect(ack("publish-pack-incomplete.json", "accepted", { strict: true })).toBe("rejected");
  });
});

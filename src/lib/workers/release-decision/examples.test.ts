// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-decision example fixtures under `docs/examples/release-decision-record/`.
 * It pins each fixture to its schema, asserts it is content-free, and DRIVES the real decision modules over the
 * pack + acknowledgement pairs to prove the documented decisions. Offline: it reads committed files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeDecision } from "./fixtures";
import type { ReleaseDecisionDecision } from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-decision-record");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const PACKS = [
  "publish-pack-publishable.json",
  "publish-pack-review.json",
  "publish-pack-incomplete.json",
  "publish-pack-blocked.json",
  "publish-pack-tampered.json",
];
const ACKS = [
  "ack-accepted.json",
  "ack-accepted-with-notes.json",
  "ack-deferred.json",
  "ack-rejected.json",
  "ack-accepted-review.json",
  "ack-accepted-blocked.json",
  "ack-accepted-incomplete.json",
  "ack-tampered.json",
];
const FILES = [...PACKS, ...ACKS, "not-a-publish-pack.json", "not-an-ack.json"];

// Locator-SHAPED tokens only (real endpoints, keys, schemes, paths) — never bare prose words like "secret" or "path",
// which the documents' own honesty caveats legitimately mention. Mirrors the release-publish-pack / release-ack set.
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

/** Decide over a committed pack + ack fixture pair, and return the decision. */
function decide(
  packFile: string,
  ackFile: string,
  strict = false,
): ReleaseDecisionDecision {
  return makeDecision(readJson(packFile), readJson(ackFile), { strict })
    .decision.decision;
}

describe("release-decision examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("each pack fixture carries the publish-pack schema; each ack the ack schema; the decoys neither", () => {
    for (const f of PACKS) {
      expect((readJson(f) as { schema: string }).schema).toBe(
        "pdfxyz.release-publish-pack/1",
      );
    }
    for (const f of ACKS) {
      expect((readJson(f) as { schema: string }).schema).toBe(
        "pdfxyz.release-ack/1",
      );
    }
    expect(
      (readJson("not-a-publish-pack.json") as { schema: string }).schema,
    ).not.toMatch(/release-/);
    expect(
      (readJson("not-an-ack.json") as { schema: string }).schema,
    ).not.toMatch(/release-/);
  });
});

describe("release-decision examples — drive the documented decisions", () => {
  it("a publishable pack + a clean accepted acknowledgement of it → proceed (exit 0)", () => {
    expect(decide("publish-pack-publishable.json", "ack-accepted.json")).toBe(
      "proceed",
    );
  });

  it("accepted-with-notes over the publishable pack → proceed-with-followup (exit 3)", () => {
    expect(
      decide("publish-pack-publishable.json", "ack-accepted-with-notes.json"),
    ).toBe("proceed-with-followup");
  });

  it("a review pack accepted → hold (exit 3)", () => {
    expect(decide("publish-pack-review.json", "ack-accepted-review.json")).toBe(
      "hold",
    );
  });

  it("an incomplete pack, or a deferred acknowledgement → insufficient (exit 2)", () => {
    expect(
      decide("publish-pack-incomplete.json", "ack-accepted-incomplete.json"),
    ).toBe("insufficient");
    expect(decide("publish-pack-publishable.json", "ack-deferred.json")).toBe(
      "insufficient",
    );
  });

  it("a rejected acknowledgement, or a blocked pack → reject (exit 4)", () => {
    expect(decide("publish-pack-publishable.json", "ack-rejected.json")).toBe(
      "reject",
    );
    expect(
      decide("publish-pack-blocked.json", "ack-accepted-blocked.json"),
    ).toBe("reject");
  });

  it("a tampered pack, a tampered ack, or a non-document → invalid (never a vacuous pass)", () => {
    expect(decide("publish-pack-tampered.json", "ack-accepted.json")).toBe(
      "invalid",
    );
    expect(decide("publish-pack-publishable.json", "ack-tampered.json")).toBe(
      "invalid",
    );
    expect(decide("publish-pack-publishable.json", "not-an-ack.json")).toBe(
      "invalid",
    );
    expect(decide("not-a-publish-pack.json", "ack-accepted.json")).toBe(
      "invalid",
    );
  });

  it("an acknowledgement of a DIFFERENT pack → invalid via cross-check mismatch", () => {
    // ack-accepted-review acknowledged the REVIEW pack; supplied with the PUBLISHABLE pack the pair is incoherent.
    const result = makeDecision(
      readJson("publish-pack-publishable.json"),
      readJson("ack-accepted-review.json"),
    );
    expect(result.decision.decision).toBe("invalid");
    expect(result.crossCheck.status).toBe("mismatch");
  });

  it("--strict escalates a follow-up to reject", () => {
    expect(
      decide("publish-pack-publishable.json", "ack-accepted.json", true),
    ).toBe("proceed");
    expect(
      decide(
        "publish-pack-publishable.json",
        "ack-accepted-with-notes.json",
        true,
      ),
    ).toBe("reject");
  });
});

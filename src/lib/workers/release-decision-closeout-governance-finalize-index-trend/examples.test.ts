// @vitest-environment node
/**
 * A static no-secret proof over the committed content-free finalize-index-trend example fixtures (Phase 76) that ALSO
 * drives the real trend modules over them, so the documented verdicts stay honest. Offline: it reads committed files
 * only, makes no network call, and mutates nothing.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTrendResult } from "./build";
import { defaultPolicy, ingestWindowsFrom } from "./fixtures";
import type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPolicy,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict,
} from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-decision-closeout-governance-finalize-index-trend");
const read = (f: string) => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string) => JSON.parse(read(f));

const WINDOWS = [
  "window-indexed.json",
  "window-open.json",
  "window-incomplete.json",
  "window-blocked.json",
  "window-invalid.json",
  "window-tampered.json",
];
const FILES = [...WINDOWS, "not-a-finalize-index.json"];

// Locator-SHAPED tokens only (a scheme, a bucket, a credential prefix, a path, a region) — never bare prose words like
// "secret" or "path", which legitimately appear in the authored honesty caveats the windows carry.
const FORBIDDEN = [
  "amazonaws",
  "akia",
  "://",
  "us-east-1",
  "us-gov",
  "upstash",
  "cloudflarestorage",
  "/tmp/",
  ".pdf",
  "bearer ",
  "secretaccesskey",
  "@example",
];

/** Ingest the given fixture files (oldest first) + fold to the trend verdict. */
function trendVerdict(
  files: readonly string[],
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendVerdict {
  const ingested = ingestWindowsFrom(files.map(readJson));
  return buildTrendResult("2026-07-05T00:00:00.000Z", ingested, defaultPolicy(policy)).verdict;
}

describe("release-decision-closeout-governance-finalize-index-trend examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const lower = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(lower.includes(leak), `${file} must not leak ${leak}`).toBe(false);
      }
    }
  });

  it("every window fixture carries the finalize-index schema; the decoy does not", () => {
    for (const file of WINDOWS) {
      expect(readJson(file).schema).toBe("pdfxyz.release-decision-closeout-governance-finalize-index/1");
    }
    expect(String(readJson("not-a-finalize-index.json").schema)).not.toMatch(/release-decision/);
  });
});

describe("release-decision-closeout-governance-finalize-index-trend examples — drive the documented verdicts", () => {
  const IDX = "window-indexed.json";
  const OPEN = "window-open.json";
  const INC = "window-incomplete.json";
  const BLK = "window-blocked.json";
  const INV = "window-invalid.json";
  const TAMP = "window-tampered.json";
  const NOT = "not-a-finalize-index.json";

  it("a coherent all-indexed history is stable", () => {
    expect(trendVerdict([IDX, IDX, IDX])).toBe("stable");
  });

  it("an improving arc to a clean latest is improving; an older open under a clean latest is watch", () => {
    expect(trendVerdict([OPEN, IDX])).toBe("improving");
    expect(trendVerdict([IDX, OPEN, IDX])).toBe("watch");
  });

  it("a latest-open / degrading history is degrading", () => {
    expect(trendVerdict([IDX, OPEN])).toBe("degrading");
  });

  it("a flat incomplete history is insufficient (never a vacuous stable)", () => {
    expect(trendVerdict([INC, INC])).toBe("insufficient");
  });

  it("a blocked window, or an index-invalid usable window, is blocked", () => {
    expect(trendVerdict([IDX, BLK])).toBe("blocked");
    expect(trendVerdict([IDX, INV])).toBe("blocked");
  });

  it("a tampered window, or an unreadable decoy, is invalid (fail closed)", () => {
    expect(trendVerdict([IDX, TAMP, IDX])).toBe("invalid");
    expect(trendVerdict([IDX, NOT, IDX])).toBe("invalid");
  });

  it("--strict-open escalates a non-indexed history to blocked", () => {
    expect(trendVerdict([IDX, OPEN], { strictOpen: true })).toBe("blocked");
  });
});

// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-decision-closeout-index-trend example fixtures under
 * `docs/examples/release-decision-closeout-index-trend/`. It pins each window to its schema, asserts it is content-free,
 * and DRIVES the real trend modules over the histories to prove the documented trend verdicts. Offline: it reads
 * committed files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTrendResult } from "./build";
import { defaultPolicy, ingestIndexesFrom } from "./fixtures";
import type { ReleaseDecisionCloseoutIndexTrendPolicy, ReleaseDecisionCloseoutIndexTrendVerdict } from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-decision-closeout-index-trend");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const WINDOWS = [
  "window-indexed.json",
  "window-watch.json",
  "window-incomplete.json",
  "window-blocked.json",
  "window-tampered.json",
];
const FILES = [...WINDOWS, "not-a-closeout-index.json"];

// Locator-SHAPED tokens only (real endpoints, keys, schemes, paths) — never bare prose words like "secret" or "path",
// which the windows' own honesty caveats legitimately mention.
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

/** Drive the real trend over a list of committed window fixtures and return the verdict. */
function trendVerdict(
  files: string[],
  policy: Partial<ReleaseDecisionCloseoutIndexTrendPolicy> = {},
): ReleaseDecisionCloseoutIndexTrendVerdict {
  const ingested = ingestIndexesFrom(files.map(readJson));
  return buildTrendResult("2026-07-05T00:00:00.000Z", ingested, defaultPolicy(policy)).closeoutIndexTrend
    .verdict;
}

describe("release-decision-closeout-index-trend examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every window fixture carries the closeout-index schema; the decoy does not", () => {
    for (const f of WINDOWS) {
      expect((readJson(f) as { schema: string }).schema).toBe("pdfxyz.release-decision-closeout-index/1");
    }
    expect((readJson("not-a-closeout-index.json") as { schema: string }).schema).not.toMatch(
      /release-decision/,
    );
  });
});

describe("release-decision-closeout-index-trend examples — drive the documented verdicts", () => {
  const IDX = "window-indexed.json";
  const WATCH = "window-watch.json";
  const INC = "window-incomplete.json";
  const BLK = "window-blocked.json";
  const TAMP = "window-tampered.json";
  const NOT = "not-a-closeout-index.json";

  it("a coherent all-indexed history is trend-stable", () => {
    expect(trendVerdict([IDX, IDX, IDX])).toBe("trend-stable");
  });

  it("a latest-open / degrading history is trend-watch", () => {
    expect(trendVerdict([IDX, WATCH])).toBe("trend-watch");
  });

  it("a flat incomplete history is trend-incomplete (never a vacuous stable)", () => {
    expect(trendVerdict([INC, INC])).toBe("trend-incomplete");
  });

  it("a latest-blocked history is trend-blocked", () => {
    expect(trendVerdict([IDX, BLK])).toBe("trend-blocked");
  });

  it("a tampered window is trend-blocked; an unreadable decoy is trend-incomplete", () => {
    expect(trendVerdict([IDX, TAMP, IDX])).toBe("trend-blocked");
    expect(trendVerdict([IDX, NOT, IDX])).toBe("trend-incomplete");
  });

  it("--strict-watch escalates a watch history to trend-blocked", () => {
    expect(trendVerdict([IDX, WATCH], { strictWatch: true })).toBe("trend-blocked");
  });

  it("an improving history that recovers to a tolerated-clean latest is trend-stable", () => {
    // default max-incomplete=0 → the older incomplete window breaches the threshold (a coverage gap remains).
    expect(trendVerdict([INC, IDX])).toBe("trend-incomplete");
    // tolerate the one older incomplete → the arc reads improving and clean → trend-stable.
    expect(trendVerdict([INC, IDX], { maxIncomplete: 1 })).toBe("trend-stable");
  });
});

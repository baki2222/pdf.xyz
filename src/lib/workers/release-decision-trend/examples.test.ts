// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-decision-trend example fixtures under
 * `docs/examples/release-decision-trend/`. It pins each window to its schema, asserts it is content-free, and DRIVES
 * the real trend modules over the window histories to prove the documented trend verdicts. Offline: it reads committed
 * files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTrendResult } from "./build";
import { defaultPolicy, ingestWindowsFrom } from "./fixtures";
import type { ReleaseDecisionTrendPolicy, ReleaseDecisionTrendVerdict } from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-decision-trend");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const WINDOWS = [
  "window-stable.json",
  "window-watch.json",
  "window-insufficient.json",
  "window-blocked.json",
  "window-invalid.json",
  "window-tampered.json",
];
const FILES = [...WINDOWS, "not-a-decision-index.json"];

// Locator-SHAPED tokens only (real endpoints, keys, schemes, paths) — never bare prose words like "secret" or
// "path", which the windows' own honesty caveats legitimately mention. Mirrors the release-decision-index set.
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
  policy: Partial<ReleaseDecisionTrendPolicy> = {},
): ReleaseDecisionTrendVerdict {
  const ingested = ingestWindowsFrom(files.map(readJson));
  return buildTrendResult("2026-07-04T00:00:00.000Z", ingested, defaultPolicy(policy)).trend.verdict;
}

describe("release-decision-trend examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every window fixture carries the release-decision-index schema; the decoy does not", () => {
    for (const f of WINDOWS) {
      expect((readJson(f) as { schema: string }).schema).toBe("pdfxyz.release-decision-index/1");
    }
    expect((readJson("not-a-decision-index.json") as { schema: string }).schema).not.toMatch(
      /release-decision-index/,
    );
  });
});

describe("release-decision-trend examples — drive the documented verdicts", () => {
  const S = "window-stable.json";
  const W = "window-watch.json";
  const I = "window-insufficient.json";
  const B = "window-blocked.json";
  const IV = "window-invalid.json";
  const T = "window-tampered.json";
  const N = "not-a-decision-index.json";

  it("a clean history of stable windows is stable", () => {
    expect(trendVerdict([S, S, S])).toBe("stable");
  });

  it("a watch window recovering to a stable latest window is improving", () => {
    expect(trendVerdict([W, S])).toBe("improving");
  });

  it("a stable window worsening to a watch latest window is degrading", () => {
    expect(trendVerdict([S, W])).toBe("degrading");
  });

  it("a flat watch history is a watch", () => {
    expect(trendVerdict([W, W])).toBe("watch");
  });

  it("an only-insufficient history is insufficient", () => {
    expect(trendVerdict([I, I])).toBe("insufficient");
  });

  it("a blocked or an invalid window is blocked", () => {
    expect(trendVerdict([S, B])).toBe("blocked");
    expect(trendVerdict([S, IV])).toBe("blocked");
  });

  it("a tampered window, or an unreadable decoy, is invalid (never a vacuous pass)", () => {
    expect(trendVerdict([S, T, S])).toBe("invalid");
    expect(trendVerdict([S, N, S])).toBe("invalid");
  });

  it("--strict escalates a non-stable history to blocked", () => {
    expect(trendVerdict([S, W], { strict: true })).toBe("blocked");
    expect(trendVerdict([W, S], { strict: true })).toBe("blocked");
  });
});

// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-decision-…-closeout-index example fixtures under
 * `docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index/`. It pins
 * each record to its schema, asserts it is content-free, and DRIVES the real index modules over the histories to prove the
 * documented index verdicts. Offline: it reads committed files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCloseoutIndexResult } from "./build";
import { defaultPolicy, ingestCloseoutFrom } from "./fixtures";
import type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPolicy,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict,
} from "./types";

const DIR = join(
  process.cwd(),
  "docs",
  "examples",
  "release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index",
);
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const CLOSEOUTS = [
  "closeout-closed.json",
  "closeout-closed-coherent.json",
  "closeout-open.json",
  "closeout-incomplete.json",
  "closeout-blocked.json",
  "closeout-tampered.json",
];
const FILES = [...CLOSEOUTS, "not-a-closeout.json"];

// Locator-SHAPED tokens only (real endpoints, keys, schemes, paths) — never bare prose words like "secret" or "path",
// which the records' own honesty caveats legitimately mention.
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

/** Drive the real index over a list of committed closeout fixtures and return the verdict. */
function indexVerdict(
  files: string[],
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexVerdict {
  const ingested = ingestCloseoutFrom(files.map(readJson));
  return buildCloseoutIndexResult("2026-07-05T00:00:00.000Z", ingested, defaultPolicy(policy)).closeoutIndex.verdict;
}

describe("release-decision-…-closeout-index examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every closeout fixture carries the closeout schema; the decoy does not", () => {
    for (const f of CLOSEOUTS) {
      expect((readJson(f) as { schema: string }).schema).toBe(
        "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout/1",
      );
    }
    expect((readJson("not-a-closeout.json") as { schema: string }).schema).not.toMatch(/release-decision/);
  });
});

describe("release-decision-…-closeout-index examples — drive the documented verdicts", () => {
  const CLO = "closeout-closed.json";
  const COH = "closeout-closed-coherent.json";
  const OPEN = "closeout-open.json";
  const INC = "closeout-incomplete.json";
  const BLK = "closeout-blocked.json";
  const TAMP = "closeout-tampered.json";
  const NOT = "not-a-closeout.json";

  it("a coherent all-closed history is all-closed", () => {
    expect(indexVerdict([CLO, COH, CLO])).toBe("all-closed");
  });

  it("a latest-open history is open", () => {
    expect(indexVerdict([CLO, OPEN])).toBe("open");
  });

  it("a latest-incomplete history is incomplete", () => {
    expect(indexVerdict([CLO, INC])).toBe("incomplete");
  });

  it("a blocked record (latest or older) is blocked", () => {
    expect(indexVerdict([CLO, BLK])).toBe("blocked");
    expect(indexVerdict([BLK, CLO])).toBe("blocked");
  });

  it("a tampered OR unreadable record is invalid (the top precedence, never a vacuous all-closed)", () => {
    expect(indexVerdict([CLO, TAMP, CLO])).toBe("invalid");
    expect(indexVerdict([CLO, NOT, CLO])).toBe("invalid");
    // invalid outranks blocked in the window
    expect(indexVerdict([BLK, TAMP])).toBe("invalid");
  });

  it("--strict-open escalates an open OR incomplete history to blocked", () => {
    expect(indexVerdict([CLO, OPEN], { strictOpen: true })).toBe("blocked");
    expect(indexVerdict([CLO, INC], { strictOpen: true })).toBe("blocked");
  });

  it("--max-open tolerates a bounded number of older opens (an older open, latest closed, becomes all-closed)", () => {
    expect(indexVerdict([OPEN, CLO])).toBe("open"); // default max-open=0
    expect(indexVerdict([OPEN, CLO], { maxOpen: 1 })).toBe("all-closed");
  });

  it("--max-incomplete tolerates a bounded number of older incompletes (latest closed) → all-closed", () => {
    expect(indexVerdict([INC, CLO])).toBe("incomplete"); // default max-incomplete=0
    expect(indexVerdict([INC, CLO], { maxIncomplete: 1 })).toBe("all-closed");
  });
});

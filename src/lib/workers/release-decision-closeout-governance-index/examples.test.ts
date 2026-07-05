// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-decision-closeout-governance-index example fixtures under
 * `docs/examples/release-decision-closeout-governance-index/`. It pins each record to its schema, asserts it is
 * content-free, and DRIVES the real index modules over the histories to prove the documented index verdicts. Offline:
 * it reads committed files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGovernanceIndexResult } from "./build";
import { defaultPolicy, ingestGovernanceFrom } from "./fixtures";
import type {
  ReleaseDecisionCloseoutGovernanceIndexPolicy,
  ReleaseDecisionCloseoutGovernanceIndexVerdict,
} from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-decision-closeout-governance-index");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const GOVERNANCES = [
  "governance-closed.json",
  "governance-closed-coherent.json",
  "governance-open.json",
  "governance-incomplete.json",
  "governance-blocked.json",
  "governance-contradictory.json",
  "governance-tampered.json",
];
const FILES = [...GOVERNANCES, "not-a-governance.json"];

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

/** Drive the real index over a list of committed governance fixtures and return the verdict. */
function indexVerdict(
  files: string[],
  policy: Partial<ReleaseDecisionCloseoutGovernanceIndexPolicy> = {},
): ReleaseDecisionCloseoutGovernanceIndexVerdict {
  const ingested = ingestGovernanceFrom(files.map(readJson));
  return buildGovernanceIndexResult("2026-07-05T00:00:00.000Z", ingested, defaultPolicy(policy)).governanceIndex
    .verdict;
}

describe("release-decision-closeout-governance-index examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every governance fixture carries the governance schema; the decoy does not", () => {
    for (const f of GOVERNANCES) {
      expect((readJson(f) as { schema: string }).schema).toBe("pdfxyz.release-decision-closeout-governance/1");
    }
    expect((readJson("not-a-governance.json") as { schema: string }).schema).not.toMatch(/release-decision/);
  });
});

describe("release-decision-closeout-governance-index examples — drive the documented verdicts", () => {
  const CLOSED = "governance-closed.json";
  const COH = "governance-closed-coherent.json";
  const OPEN = "governance-open.json";
  const INC = "governance-incomplete.json";
  const BLK = "governance-blocked.json";
  const CON = "governance-contradictory.json";
  const TAMP = "governance-tampered.json";
  const NOT = "not-a-governance.json";

  it("a coherent all-closed history is indexed", () => {
    expect(indexVerdict([CLOSED, COH, CLOSED])).toBe("indexed");
  });

  it("a latest-open history is index-open", () => {
    expect(indexVerdict([CLOSED, OPEN])).toBe("index-open");
  });

  it("a latest-incomplete history is index-incomplete", () => {
    expect(indexVerdict([CLOSED, INC])).toBe("index-incomplete");
  });

  it("a latest-blocked or a contradictory bundle is index-blocked", () => {
    expect(indexVerdict([CLOSED, BLK])).toBe("index-blocked");
    expect(indexVerdict([CLOSED, CON])).toBe("index-blocked");
  });

  it("a tampered bundle is index-blocked; an unreadable decoy is index-incomplete (never a vacuous indexed)", () => {
    expect(indexVerdict([CLOSED, TAMP, CLOSED])).toBe("index-blocked");
    expect(indexVerdict([CLOSED, NOT, CLOSED])).toBe("index-incomplete");
  });

  it("--strict-open escalates an open history to index-blocked", () => {
    expect(indexVerdict([CLOSED, OPEN], { strictOpen: true })).toBe("index-blocked");
  });

  it("--max-open tolerates a bounded number of older opens (an older open, latest closed, becomes indexed)", () => {
    expect(indexVerdict([OPEN, CLOSED])).toBe("index-open"); // default max-open=0
    expect(indexVerdict([OPEN, CLOSED], { maxOpen: 1 })).toBe("indexed");
  });
});

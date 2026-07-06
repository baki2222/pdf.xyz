// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-decision-closeout-governance-finalize-index example fixtures under
 * `docs/examples/release-decision-closeout-governance-finalize-index/`. It pins each record to its schema, asserts it is
 * content-free, and DRIVES the real index modules over the histories to prove the documented index verdicts. Offline:
 * it reads committed files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFinalizeIndexResult } from "./build";
import { defaultPolicy, ingestFinalizeFrom } from "./fixtures";
import type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexPolicy,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict,
} from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-decision-closeout-governance-finalize-index");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const FINALIZATIONS = [
  "finalize-finalized.json",
  "finalize-finalized-coherent.json",
  "finalize-open.json",
  "finalize-incomplete.json",
  "finalize-blocked.json",
  "finalize-tampered.json",
];
const FILES = [...FINALIZATIONS, "not-a-finalize.json"];

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

/** Drive the real index over a list of committed finalization fixtures and return the verdict. */
function indexVerdict(
  files: string[],
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict {
  const ingested = ingestFinalizeFrom(files.map(readJson));
  return buildFinalizeIndexResult("2026-07-05T00:00:00.000Z", ingested, defaultPolicy(policy)).finalizeIndex.verdict;
}

describe("release-decision-closeout-governance-finalize-index examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every finalization fixture carries the finalize schema; the decoy does not", () => {
    for (const f of FINALIZATIONS) {
      expect((readJson(f) as { schema: string }).schema).toBe(
        "pdfxyz.release-decision-closeout-governance-finalize/1",
      );
    }
    expect((readJson("not-a-finalize.json") as { schema: string }).schema).not.toMatch(/release-decision/);
  });
});

describe("release-decision-closeout-governance-finalize-index examples — drive the documented verdicts", () => {
  const FIN = "finalize-finalized.json";
  const COH = "finalize-finalized-coherent.json";
  const OPEN = "finalize-open.json";
  const INC = "finalize-incomplete.json";
  const BLK = "finalize-blocked.json";
  const TAMP = "finalize-tampered.json";
  const NOT = "not-a-finalize.json";

  it("a coherent all-finalized history is indexed", () => {
    expect(indexVerdict([FIN, COH, FIN])).toBe("indexed");
  });

  it("a latest-open history is index-open", () => {
    expect(indexVerdict([FIN, OPEN])).toBe("index-open");
  });

  it("a latest-incomplete history is index-incomplete", () => {
    expect(indexVerdict([FIN, INC])).toBe("index-incomplete");
  });

  it("a blocked bundle (latest or older) is index-blocked", () => {
    expect(indexVerdict([FIN, BLK])).toBe("index-blocked");
    expect(indexVerdict([BLK, FIN])).toBe("index-blocked");
  });

  it("a tampered OR unreadable bundle is index-invalid (the top precedence, never a vacuous indexed)", () => {
    expect(indexVerdict([FIN, TAMP, FIN])).toBe("index-invalid");
    expect(indexVerdict([FIN, NOT, FIN])).toBe("index-invalid");
    // invalid outranks blocked in the window
    expect(indexVerdict([BLK, TAMP])).toBe("index-invalid");
  });

  it("--strict-open escalates an open history to index-blocked", () => {
    expect(indexVerdict([FIN, OPEN], { strictOpen: true })).toBe("index-blocked");
  });

  it("--max-open tolerates a bounded number of older opens (an older open, latest finalized, becomes indexed)", () => {
    expect(indexVerdict([OPEN, FIN])).toBe("index-open"); // default max-open=0
    expect(indexVerdict([OPEN, FIN], { maxOpen: 1 })).toBe("indexed");
  });

  it("--require-latest-finalized turns a non-finalized latest coverage gap into index-incomplete", () => {
    expect(indexVerdict([FIN, INC], { requireLatestFinalized: true })).toBe("index-incomplete");
  });
});

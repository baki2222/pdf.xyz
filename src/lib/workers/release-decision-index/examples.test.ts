// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-decision-index example fixtures under
 * `docs/examples/release-decision-index/`. It pins each record to its schema, asserts it is content-free, and DRIVES
 * the real index modules over the batches to prove the documented index verdicts. Offline: it reads committed files
 * only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildIndexResult } from "./build";
import { defaultPolicy, ingestRecordsFrom } from "./fixtures";
import type { ReleaseDecisionIndexPolicy, ReleaseDecisionIndexVerdict } from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-decision-index");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const RECORDS = [
  "decision-proceed.json",
  "decision-proceed-with-followup.json",
  "decision-hold.json",
  "decision-insufficient.json",
  "decision-reject.json",
  "decision-invalid.json",
  "decision-tampered.json",
];
const FILES = [...RECORDS, "not-a-decision.json"];

// Locator-SHAPED tokens only (real endpoints, keys, schemes, paths) — never bare prose words like "secret" or
// "path", which the records' own honesty caveats legitimately mention. Mirrors the release-decision set.
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

/** Drive the real index over a list of committed record fixtures and return the verdict. */
function indexVerdict(
  files: string[],
  policy: Partial<ReleaseDecisionIndexPolicy> = {},
): ReleaseDecisionIndexVerdict {
  const ingested = ingestRecordsFrom(files.map(readJson));
  return buildIndexResult("2026-07-04T00:00:00.000Z", ingested, defaultPolicy(policy)).index.verdict;
}

describe("release-decision-index examples — content-free + parseable", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every record fixture carries the release-decision schema; the decoy does not", () => {
    for (const f of RECORDS) {
      expect((readJson(f) as { schema: string }).schema).toBe("pdfxyz.release-decision/1");
    }
    expect((readJson("not-a-decision.json") as { schema: string }).schema).not.toMatch(/release-decision/);
  });
});

describe("release-decision-index examples — drive the documented verdicts", () => {
  const PR = "decision-proceed.json";
  const FU = "decision-proceed-with-followup.json";
  const HD = "decision-hold.json";
  const INS = "decision-insufficient.json";
  const RJ = "decision-reject.json";
  const INV = "decision-invalid.json";
  const TAMP = "decision-tampered.json";
  const NOT = "not-a-decision.json";

  it("a clean batch of proceed records is stable", () => {
    expect(indexVerdict([PR, PR, PR])).toBe("stable");
  });

  it("a proceed-with-followup or hold record is a watch", () => {
    expect(indexVerdict([PR, FU])).toBe("watch");
    expect(indexVerdict([PR, HD])).toBe("watch");
  });

  it("an insufficient decision is insufficient", () => {
    expect(indexVerdict([PR, INS])).toBe("insufficient");
  });

  it("a reject or an invalid decision is blocked", () => {
    expect(indexVerdict([PR, RJ])).toBe("blocked");
    expect(indexVerdict([PR, INV])).toBe("blocked");
  });

  it("a tampered record, or an unreadable decoy, is invalid (never a vacuous stable)", () => {
    expect(indexVerdict([PR, TAMP, PR])).toBe("invalid");
    expect(indexVerdict([PR, NOT, PR])).toBe("invalid");
  });

  it("--strict escalates a followup / hold batch to blocked", () => {
    expect(indexVerdict([PR, FU], { strict: true })).toBe("blocked");
    expect(indexVerdict([PR, HD], { strict: true })).toBe("blocked");
  });
});

// @vitest-environment node
/**
 * Static, no-secret proof for the committed release-decision-closeout-index example fixtures under
 * `docs/examples/release-decision-closeout-index/`. It pins each record to its schema, asserts it is content-free, and
 * DRIVES the real index modules over the histories to prove the documented index verdicts. Offline: it reads committed
 * files only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCloseoutIndexResult } from "./build";
import { defaultPolicy, ingestCloseoutsFrom } from "./fixtures";
import type { ReleaseDecisionCloseoutIndexPolicy, ReleaseDecisionCloseoutIndexVerdict } from "./types";

const DIR = join(process.cwd(), "docs", "examples", "release-decision-closeout-index");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const CLOSEOUTS = [
  "closeout-closed.json",
  "closeout-closed-coherent.json",
  "closeout-open.json",
  "closeout-incomplete.json",
  "closeout-blocked.json",
  "closeout-contradictory.json",
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
  policy: Partial<ReleaseDecisionCloseoutIndexPolicy> = {},
): ReleaseDecisionCloseoutIndexVerdict {
  const ingested = ingestCloseoutsFrom(files.map(readJson));
  return buildCloseoutIndexResult("2026-07-05T00:00:00.000Z", ingested, defaultPolicy(policy)).closeoutIndex
    .verdict;
}

describe("release-decision-closeout-index examples — content-free + parseable", () => {
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
      expect((readJson(f) as { schema: string }).schema).toBe("pdfxyz.release-decision-closeout/1");
    }
    expect((readJson("not-a-closeout.json") as { schema: string }).schema).not.toMatch(/release-decision/);
  });
});

describe("release-decision-closeout-index examples — drive the documented verdicts", () => {
  const CLOSED = "closeout-closed.json";
  const COH = "closeout-closed-coherent.json";
  const OPEN = "closeout-open.json";
  const INC = "closeout-incomplete.json";
  const BLK = "closeout-blocked.json";
  const CON = "closeout-contradictory.json";
  const TAMP = "closeout-tampered.json";
  const NOT = "not-a-closeout.json";

  it("a coherent all-closed history is indexed", () => {
    expect(indexVerdict([CLOSED, COH, CLOSED])).toBe("indexed");
  });

  it("a latest-open history is index-open", () => {
    expect(indexVerdict([CLOSED, OPEN])).toBe("index-open");
  });

  it("a latest-incomplete history is index-incomplete", () => {
    expect(indexVerdict([CLOSED, INC])).toBe("index-incomplete");
  });

  it("a latest-blocked or a contradictory closeout is index-blocked", () => {
    expect(indexVerdict([CLOSED, BLK])).toBe("index-blocked");
    expect(indexVerdict([CLOSED, CON])).toBe("index-blocked");
  });

  it("a tampered closeout is index-blocked; an unreadable decoy is index-incomplete (never a vacuous indexed)", () => {
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

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Nothing the product says may promise that a worker has no network.
 *
 * It was said three times, and it was false every time: the worker reaches
 * storage, the queue and AI providers by design, and until 2026-09 Chromium
 * on that worker would fetch any address an uploaded page asked for —
 * including the host's own metadata service and local files. What is true now
 * is narrower (the renderer only reaches public addresses, through a check),
 * and a sentence that says the broad thing licenses the next defect.
 *
 * Corpus in BOTH directions (CLAUDE.md guards rule 1): every sentence the
 * product shipped with the claim must be caught by some pattern, and every
 * pattern must catch some shipped sentence.
 */
const SHIPPED = [
  // src/lib/jobs/capabilities.ts, WORKER_PIPELINE_TAIL — every worker tool page
  "A single-job sandbox with no network egress does the work, then is destroyed.",
  // src/components/tools/ocr-worker-panel.tsx
  "recognized in a sandbox with no network egress, and deleted automatically.",
  // src/components/tools/pdf-security-worker-panel.tsx
  "processed in a sandbox with no network egress, and deleted automatically.",
];

/** Near misses a rewrite would reach for. Each must be caught too. */
const SYNONYMS = [
  "runs with no egress at all",
  "processed without network access",
  "an offline, network-isolated sandbox",
  "the worker has no internet access",
  "egress is blocked",
];

const PATTERNS: readonly RegExp[] = [
  /\bno (?:network |internet )?egress\b/i,
  /\bwithout (?:any )?(?:network|internet) access\b/i,
  /\bnetwork[- ]isolated\b/i,
  /\bno (?:network|internet) access\b/i,
  /\begress (?:is )?(?:blocked|disabled|denied)\b/i,
];

/**
 * Pending a copy change outside this lane (see the copy lane's queue): the
 * shared pipeline copy lives in a file this change does not edit.
 *
 * REQUIRED to still match, not merely tolerated. It was first written as
 * "tolerated, never required", which never retires: once the copy lane fixed
 * the file, a regression reintroducing the claim there would have passed
 * silently, with this set as its licence. Now the moment the file stops
 * making the claim, the test below fails until the entry is removed.
 */
const PENDING_COPY = new Set(["src/lib/jobs/capabilities.ts"]);

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (
      /\.(tsx?|mdx?)$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    )
      out.push(full);
  }
  return out;
}

/** Collapse JSX line wraps and `{" "}` so a phrase cannot hide across lines. */
const flatten = (text: string) =>
  text.replace(/\{"\s*"\}/g, " ").replace(/\s+/g, " ");

describe("no surface claims the worker has no network", () => {
  it("every pattern catches a shipped sentence or a named synonym, and every one of those is caught", () => {
    const corpus = [...SHIPPED, ...SYNONYMS];
    const uncaught = corpus.filter((s) => !PATTERNS.some((p) => p.test(s)));
    expect(uncaught).toEqual([]);
    const idle = PATTERNS.filter((p) => !corpus.some((s) => p.test(s)));
    expect(idle).toEqual([]);
    // The claim that actually shipped must be caught, not only synonyms.
    expect(SHIPPED.every((s) => PATTERNS.some((p) => p.test(s)))).toBe(true);
  });

  it("every PENDING_COPY exemption is still needed — remove it once the copy lands", () => {
    const retired = [...PENDING_COPY].filter((rel) => {
      const text = flatten(readFileSync(path.join(ROOT, rel), "utf8"));
      return !PATTERNS.some((p) => p.test(text));
    });
    expect(
      retired,
      "these files no longer make the claim: delete them from PENDING_COPY so the scan below covers them",
    ).toEqual([]);
  });

  it("no source file under src/ makes the claim", () => {
    const files = walk(path.join(ROOT, "src"));
    // Health check: a walk that found nothing would pass vacuously.
    expect(files.length).toBeGreaterThan(500);
    const offenders = files
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
      .filter((rel) => !PENDING_COPY.has(rel))
      .filter((rel) => {
        const text = flatten(readFileSync(path.join(ROOT, rel), "utf8"));
        return PATTERNS.some((p) => p.test(text));
      });
    expect(offenders).toEqual([]);
  });
});

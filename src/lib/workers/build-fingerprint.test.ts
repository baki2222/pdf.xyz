// @vitest-environment node
/**
 * A fingerprint that cannot tell two trees apart is a constant with a hash's
 * reputation — which is exactly what `release` turned out to be.
 *
 * `coarseRelease(npm_package_version)` has published `"0.1"` for every worker
 * image ever built, including the 2026-08-12 one that could not chunk and the
 * one that replaced it. It looks like a build identity. So this file's first
 * job is to prove the replacement is not one too: it must MOVE when the code
 * moves, and stay still when nothing does.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  computeBuildFingerprint,
  FINGERPRINT_PATTERN,
  FINGERPRINT_LENGTH,
} from "./build-fingerprint";

/** A throwaway tree with the shape the fingerprint walks. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "fp-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

describe("computeBuildFingerprint", () => {
  it("is stable: the same tree twice is the same value", () => {
    const root = tree({ "src/a.ts": "export const a = 1;\n" });
    try {
      const first = computeBuildFingerprint(root);
      expect(first).toMatch(FINGERPRINT_PATTERN);
      expect(computeBuildFingerprint(root)).toBe(first);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("MOVES when a byte of code moves", () => {
    // The whole point. `release` fails this test, which is why it could not do
    // this job and why nobody noticed for nine days.
    const before = tree({ "src/a.ts": "export const a = 1;\n" });
    const after = tree({ "src/a.ts": "export const a = 2;\n" });
    try {
      expect(computeBuildFingerprint(before)).not.toBe(
        computeBuildFingerprint(after),
      );
    } finally {
      rmSync(before, { recursive: true, force: true });
      rmSync(after, { recursive: true, force: true });
    }
  });

  it("MOVES when a file is renamed, though every byte is the same", () => {
    // The path is hashed with the content. Without that, moving a module would
    // be invisible — and "the same code in a different place" is a different
    // build.
    const before = tree({ "src/a.ts": "export const a = 1;\n" });
    const after = tree({ "src/b.ts": "export const a = 1;\n" });
    try {
      expect(computeBuildFingerprint(before)).not.toBe(
        computeBuildFingerprint(after),
      );
    } finally {
      rmSync(before, { recursive: true, force: true });
      rmSync(after, { recursive: true, force: true });
    }
  });

  it("MOVES when a file is added", () => {
    const before = tree({ "src/a.ts": "x\n" });
    const after = tree({ "src/a.ts": "x\n", "src/b.ts": "y\n" });
    try {
      expect(computeBuildFingerprint(before)).not.toBe(
        computeBuildFingerprint(after),
      );
    } finally {
      rmSync(before, { recursive: true, force: true });
      rmSync(after, { recursive: true, force: true });
    }
  });

  it("does NOT move on line endings or a trailing newline", () => {
    // Nothing in this repo pins line endings — no `.gitattributes`, and
    // `core.autocrlf` is per-machine. A fingerprint that changed when a Windows
    // checkout touched it would be measuring the checkout, and the two values
    // being compared are computed on different machines by design.
    const lf = tree({ "src/a.ts": "export const a = 1;\nconst b = 2;\n" });
    const crlf = tree({
      "src/a.ts": "export const a = 1;\r\nconst b = 2;\r\n",
    });
    const extra = tree({
      "src/a.ts": "export const a = 1;\nconst b = 2;\n\n\n",
    });
    try {
      const value = computeBuildFingerprint(lf);
      expect(computeBuildFingerprint(crlf)).toBe(value);
      expect(computeBuildFingerprint(extra)).toBe(value);
    } finally {
      for (const root of [lf, crlf, extra]) {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("does NOT move on a non-source file", () => {
    // A changed asset or fixture is not a code change, and treating it as one
    // would make the value churn for reasons nobody can act on.
    const before = tree({ "src/a.ts": "x\n", "src/data.json": "{}\n" });
    const after = tree({ "src/a.ts": "x\n", "src/data.json": '{"k":1}\n' });
    try {
      expect(computeBuildFingerprint(before)).toBe(
        computeBuildFingerprint(after),
      );
    } finally {
      rmSync(before, { recursive: true, force: true });
      rmSync(after, { recursive: true, force: true });
    }
  });

  it("returns null for a tree with no sources, rather than a confident hash", () => {
    // `sha256("")` is twelve perfectly good-looking characters that would
    // compare EQUAL to every other empty tree — the vacuous pass in its most
    // literal form. An image that ships no sources cannot answer, and must say
    // so.
    const empty = tree({ "README.md": "nothing here\n" });
    try {
      expect(computeBuildFingerprint(empty)).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("answers for this repo, in the published shape", () => {
    const value = computeBuildFingerprint();
    expect(value).toMatch(FINGERPRINT_PATTERN);
    expect(value).toHaveLength(FINGERPRINT_LENGTH);
  });

  it("HEALTH CHECK: it is reading a real tree, not an empty one", () => {
    // Every assertion above would also pass if the walk silently found nothing
    // and some other path produced a value. Two trees that differ by one file
    // must differ — proven here against the REAL repo by comparing it to a
    // one-file tree, so the walk is doing work on the thing it will run on.
    const tiny = tree({ "src/a.ts": "x\n" });
    try {
      expect(computeBuildFingerprint()).not.toBe(computeBuildFingerprint(tiny));
    } finally {
      rmSync(tiny, { recursive: true, force: true });
    }
  });
});

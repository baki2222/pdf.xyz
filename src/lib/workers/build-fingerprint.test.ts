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
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  computeBuildFingerprint,
  FINGERPRINT_PATTERN,
  FINGERPRINT_LENGTH,
  ROOTS,
  EXTRA_FILES,
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

/**
 * What the image carries versus what the fingerprint hashes.
 *
 * ── THE GAP THIS MAKES VISIBLE ──────────────────────────────────────────────
 *
 * `publish.yml` holds a deploy until the worker heartbeat publishes this
 * fingerprint, then prints "both tiers serve the build this run pushed —
 * merged IS shipped". That sentence is stronger than the value can carry, and
 * the difference is not a rounding error: the fingerprint is computed from the
 * image's own source tree, so it can only ever see files the image CONTAINS.
 *
 * The Dockerfile, `docker-compose.worker.yml` and `pnpm-lock.yaml` are not
 * copied in. Change only those — add a `tesseract-ocr-*` pack, bump a
 * transitive dependency, alter the CMD — and the fingerprint is byte-identical
 * to the running image's. The hold passes instantly, against the OLD image,
 * and CI declares the deploy verified.
 *
 * That is not hypothetical here. The repo's OCR drift was exactly this shape:
 * `OCR_LANGUAGES` and the Dockerfile's language packs lived in different files
 * with nothing tying them together, and the menu offered 13 languages while
 * the image shipped 1.
 *
 * This test cannot close the gap — hashing a file the image does not have
 * would make CI and the image disagree forever and hang the hold. What it can
 * do is stop the gap being SILENT: it derives what the worker stage copies
 * straight from the Dockerfile, and fails when something joins the image that
 * the fingerprint would not notice. A new `COPY` line is then a decision
 * someone makes on purpose, in this file, instead of a hole nobody sees.
 */
describe("the fingerprint's reach is the image's contents", () => {
  const DOCKERFILE = readFileSync(
    path.join(process.cwd(), "Dockerfile"),
    "utf8",
  );

  /** Paths the `worker` stage copies in, read from the Dockerfile itself. */
  function workerStagePaths(): string[] {
    const start = DOCKERFILE.indexOf("FROM base AS worker");
    expect(
      start,
      "no `FROM base AS worker` stage in the Dockerfile",
    ).toBeGreaterThan(0);
    const after = DOCKERFILE.slice(start);
    const end = after.indexOf(String.fromCharCode(10) + "FROM ", 1);
    const stage = end === -1 ? after : after.slice(0, end);

    const paths: string[] = [];
    for (const line of stage.split(String.fromCharCode(10))) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("COPY ")) continue;
      const parts = trimmed.split(/\s+/).filter((p) => !p.startsWith("--"));
      // COPY <src...> <dest> — the destination is the last token.
      const dest = parts[parts.length - 1] ?? "";
      if (!dest.startsWith("./")) continue;
      paths.push(dest.slice(2).replace(/\/$/, ""));
    }
    return paths;
  }

  it("reads the worker stage (health check)", () => {
    const paths = workerStagePaths();
    // Bounded both ways. Zero would make the assertion below vacuous; the
    // whole file would mean the stage parser ran off the end of its stage.
    expect(
      paths.length,
      "COPY destinations parsed: " + paths.join(", "),
    ).toBeGreaterThanOrEqual(4);
    expect(paths.length).toBeLessThan(20);
    // Positive control through the same parser: the two roots the fingerprint
    // walks are the ones this is meant to find.
    expect(paths).toContain("src");
    expect(paths).toContain("scripts");
  });

  it("hashes everything the worker stage copies, or says why not", () => {
    // `node_modules` is installed from the lockfile, not authored, and hashing
    // ~100k files at daemon start-up is not a 65ms operation. It is covered by
    // `package.json` being in EXTRA_FILES instead — a declared dependency
    // change moves the fingerprint even though the tree itself is not walked.
    const NOT_HASHED_ON_PURPOSE = new Set(["node_modules"]);

    const reach = new Set<string>([...ROOTS, ...EXTRA_FILES]);
    const unseen = workerStagePaths()
      .filter((p) => !NOT_HASHED_ON_PURPOSE.has(p))
      .filter((p) => !reach.has(p))
      .sort();

    expect(
      unseen,
      "the worker image carries these and the fingerprint cannot see them, so " +
        "a change confined to one of them would let `merged IS shipped` print " +
        "against the previous image: " +
        unseen.join(", "),
    ).toEqual([]);
  });

  it("records the files it provably cannot reach", () => {
    // Not a ban list — a bound. These determine the image and are absent from
    // it, so no in-image hash can include them. The test exists so that the
    // limitation is a statement someone has to edit, rather than a silence.
    for (const outside of [
      "Dockerfile",
      "pnpm-lock.yaml",
      "docker-compose.worker.yml",
    ]) {
      expect(
        [...ROOTS, ...EXTRA_FILES],
        outside +
          " is now hashed — if the image carries it, delete this line; " +
          "if it does not, CI and the image will disagree forever",
      ).not.toContain(outside);
      // And each really is absent from the worker stage, which is WHY.
      expect(workerStagePaths()).not.toContain(outside);
    }
  });
});

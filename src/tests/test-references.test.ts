// @vitest-environment node
/**
 * Every test a file NAMES is a test that exists.
 *
 * WHAT SHIPPED: four comments cited guards nobody could run.
 *
 *   src/lib/structured-data.ts       `howto-names.test.tsx` renders every
 *                                    guide and every tool page …
 *   src/lib/tools/category-pages.ts  `category-pages.test.ts` holds the H1s
 *                                    and titles unique.
 *   src/lib/tools/processing.ts      `processing-hue.test.ts` fails any other
 *                                    file that maps all four modes to colours.
 *   runner-kit.a11y.test.tsx         The panels themselves are guarded by
 *                                    source scan, in
 *                                    `worker-run-trigger.a11y.test.ts` …
 *
 * The first two were written in the same change as the tests they meant, which
 * landed under other names. The third named a test that was never committed at
 * all, so from 2026-09-20 (959370d) the codebase said in writing that an invariant was
 * enforced when nothing enforced it. The fourth pointed a reader at a file that
 * does not exist instead of at `run-trigger-focus.test.ts`, which does the job.
 * A reader who goes looking for the guard finds nothing, and a reader who does
 * not look believes it. That is CLAUDE.md's "a comment is not a guard" in its
 * cheapest form: the comment did not even point at one.
 *
 * WHAT IT CHECKS, precisely: every `<name>.test.<ext>` or `<name>.spec.<ext>`
 * spelled in a text file git knows about resolves to a test file git knows
 * about — by basename, or, when the reference carries a directory, by path
 * suffix. It does NOT check that the named test asserts what the sentence
 * around it says. A comment can name a real file and still describe it wrongly
 * (`structured-data.ts` did both: the file it meant does not render the tool
 * page). This catches the name, not the claim.
 *
 * THE CORPUS IS DERIVED from `git ls-files`, tracked plus untracked-but-not-
 * ignored, so a new file is read before it is committed and a stray agent
 * worktree under `.claude/` (ignored) is not. Its size is bounded below, and
 * the reference extractor has positive controls taken from the four sentences
 * above — the tests that pinned the defect, kept as the evidence that the
 * predicate can fire.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
/** This file quotes the defects it guards against, so it is not read. */
const SELF = path
  .relative(ROOT, fileURLToPath(import.meta.url))
  .split(path.sep)
  .join("/");

function gitFiles(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return [...new Set(out.split("\0").filter(Boolean))];
}

const TEXT = /\.(?:[cm]?[jt]sx?|md)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
/** A spelled test-file name, with or without a directory in front of it. */
const REFERENCE =
  /[\w./[\]-]*[\w\]]\.(?:test|spec)\.[cm]?[jt]sx?(?![\w-]|\.\w)/g;

/**
 * Illustrative names, not references: `mock-isolation.test.ts` explains a
 * module-cache hazard with two hypothetical files, `a.test.ts` and
 * `b.test.ts`, and a `panel.test.tsx`; its graph fixtures also name a
 * `guard.test.tsx` observer and parse a made-up `src/tests/sample.test.ts`.
 * `comment-pointers.test.ts` feeds `no-such-file.test.ts` to its own resolver
 * as the name that must NOT resolve. Scoped to each file, and ratcheted
 * below — each must still appear there and must still NOT exist, so the
 * exemption cannot quietly cover a real file of the same name.
 */
const ILLUSTRATIVE: Record<string, readonly string[]> = {
  "src/tests/mock-isolation.test.ts": [
    "a.test.ts",
    "b.test.ts",
    "panel.test.tsx",
    "guard.test.tsx",
    "src/tests/sample.test.ts",
  ],
  "src/lib/workers/html-render/comment-pointers.test.ts": [
    "no-such-file.test.ts",
  ],
};

function referencesIn(source: string): string[] {
  return [...source.matchAll(REFERENCE)].map((m) => m[0]);
}

/**
 * `./` and `../` resolve against the naming file's directory, exactly; a bare
 * name matches any test's basename; anything else with a directory must be a
 * path suffix of a real test. A leading `/` is what is left of `…/name` in an
 * error message quoted into a comment, so it reads as a bare name.
 */
function resolves(ref: string, tests: readonly string[], from = ""): boolean {
  if (/^\.\.?\//.test(ref)) {
    const target = path.posix.normalize(
      path.posix.join(path.posix.dirname(from), ref),
    );
    return tests.includes(target);
  }
  const clean = ref.replace(/^\/+/, "");
  if (!clean.includes("/"))
    return tests.some((t) => path.posix.basename(t) === clean);
  return tests.some((t) => t === clean || t.endsWith(`/${clean}`));
}

describe("every test a file names exists", () => {
  const files = gitFiles();
  const texts = files.filter((f) => TEXT.test(f) && f !== SELF);
  const tests = files.filter((f) => TEST_FILE.test(f));
  const refs = texts.flatMap((file) => {
    let source: string;
    try {
      source = readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      return []; // listed by git, deleted in the working tree
    }
    return referencesIn(source).map((ref) => ({ file, ref }));
  });

  it("the corpus is the repository, not a sliver of it", () => {
    // Health checks in both directions: an empty listing passes every ⊆,
    // and a listing that swallowed a second checkout would double these.
    expect(texts.length).toBeGreaterThan(1000);
    expect(tests.length).toBeGreaterThan(300);
    expect(refs.length).toBeGreaterThan(200);
    expect(texts.some((f) => f.startsWith(".claude/"))).toBe(false);
    expect(tests).toContain(SELF);
    expect(texts).not.toContain(SELF);
  });

  it("the extractor catches the shapes that shipped", () => {
    // Positive controls: the four sentences that named a missing test.
    expect(
      referencesIn(
        "`howto-names.test.tsx` renders every guide and every tool page",
      ),
    ).toEqual(["howto-names.test.tsx"]);
    expect(referencesIn("and `category-pages.test.ts` holds the H1s")).toEqual([
      "category-pages.test.ts",
    ]);
    expect(referencesIn("nowhere: `processing-hue.test.ts` fails any")).toEqual(
      ["processing-hue.test.ts"],
    );
    expect(
      referencesIn("`worker-run-trigger.a11y.test.ts` — a component"),
    ).toEqual(["worker-run-trigger.a11y.test.ts"]);
    // …with directories, route segments, and e2e specs.
    expect(
      referencesIn(
        "see src/app/tools/[slug]/page.test.tsx and e2e/workspace.spec.ts.",
      ),
    ).toEqual(["src/app/tools/[slug]/page.test.tsx", "e2e/workspace.spec.ts"]);
    // …and not a glob or a regex that mentions the suffix.
    expect(referencesIn('include: ["src/**/*.test.ts"]')).toEqual([]);
    expect(referencesIn("/\\.(test|spec)\\./.test(name)")).toEqual([]);
  });

  it("the resolver fails the missing names and passes the real ones", () => {
    for (const missing of [
      "howto-names.test.tsx",
      "category-pages.test.ts",
      "processing-hue.test.ts",
      "worker-run-trigger.a11y.test.ts",
    ]) {
      expect(resolves(missing, tests), missing).toBe(false);
    }
    expect(resolves("guide-structured-data.test.tsx", tests)).toBe(true);
    expect(
      resolves("src/app/tools/category/category-page.test.tsx", tests),
    ).toBe(true);
    expect(resolves("tools/category/category-page.test.tsx", tests)).toBe(true);
    // A right basename in the wrong directory is still wrong.
    expect(resolves("src/lib/category-page.test.tsx", tests)).toBe(false);
  });

  it("no file names a test that does not exist", () => {
    const dangling = refs
      .filter(({ file, ref }) => !ILLUSTRATIVE[file]?.includes(ref))
      .filter(({ file, ref }) => !resolves(ref, tests, file))
      .map(({ file, ref }) => `${file} -> ${ref}`);
    expect([...new Set(dangling)]).toEqual([]);
  });

  it("every illustrative exemption is still illustrative", () => {
    for (const [file, names] of Object.entries(ILLUSTRATIVE)) {
      const inFile = new Set(
        refs.filter((r) => r.file === file).map((r) => r.ref),
      );
      for (const name of names) {
        expect(inFile.has(name), `${file} no longer names ${name}`).toBe(true);
        expect(
          resolves(name, tests),
          `${name} now exists — drop the exemption`,
        ).toBe(false);
      }
    }
  });
});

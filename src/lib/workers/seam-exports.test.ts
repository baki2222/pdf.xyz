// @vitest-environment node
/**
 * Every value the worker seam exports must be named by some code other than
 * its own declaration.
 *
 * THE DEFECT. `adapter.ts` exported `createDisabledAdapter` under the docblock
 * "The default adapter: no backend, no dev worker. Answers
 * `worker_not_configured`", and `createRemoteNotImplementedAdapter` beside it.
 * Neither was called anywhere. `getWorkerAdapter` never used them: it composes
 * the adapter from the storage and queue factories, which fall back to the
 * not-configured providers themselves. A reader asking "what does an
 * unconfigured deployment answer?" was sent to two functions no request
 * reaches. Both are deleted; the claim now sits on `getWorkerAdapter`, and
 * `adapter.test.ts` asserts it ("returns the disabled adapter by default").
 *
 * THE SUBJECTS are discovered, not typed: the runtime exports of the
 * `@/lib/workers` barrel, which is what the route handlers import. The set is
 * read by importing the barrel, so a module added to it is covered without
 * editing this file.
 *
 * THE CORPUS is every non-test .ts/.tsx file under src and scripts with its
 * comments removed, because a comment that mentions a function is not a use.
 * A name counts as used when it appears there anywhere other than its own
 * `export function|const|class` declaration.
 *
 * WHAT THIS DOES NOT PROVE. Being named is not being called: a name referenced
 * only from another dead function still passes. The guard catches the shape
 * that shipped (an export nothing names at all), not every unreachable path.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as seam from "@/lib/workers";

const ROOT = process.cwd();
const CORPUS_DIRS = ["src", "scripts"];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full);
      } else if (/\.(?:ts|tsx|mts|mjs)$/.test(entry.name)) {
        if (!/\.test\.|\.spec\./.test(entry.name)) out.push(full);
      }
    }
  };
  for (const dir of CORPUS_DIRS) walk(path.join(ROOT, dir));
  return out;
}

/** Remove block and line comments. A `//` inside a URL (`https://`) is kept. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[\s;{}(),])\/\/.*$/gm, "$1");
}

const escape = (s: string) => s.replace(/[$]/g, "\\$&");

/** Names in `names` that no source in `corpus` mentions beyond declaring it. */
function unnamedExports(
  names: readonly string[],
  corpus: readonly string[],
): string[] {
  return names.filter((name) => {
    const n = escape(name);
    const mention = new RegExp(String.raw`(?<![\w$])${n}(?![\w$])`, "g");
    const declaration = new RegExp(
      String.raw`\bexport\s+(?:async\s+)?(?:function\*?|const|let|class)\s+${n}(?![\w$])`,
      "g",
    );
    let uses = 0;
    for (const code of corpus) {
      const mentions = code.match(mention)?.length ?? 0;
      const declarations = code.match(declaration)?.length ?? 0;
      uses += mentions - declarations;
    }
    return uses === 0;
  });
}

const corpus = sourceFiles().map((f) => stripComments(readFileSync(f, "utf8")));
const subjects = Object.keys(seam).sort();

/**
 * Exports named only by their own unit tests. Each is a probe with an injected
 * resolver that no runtime path calls yet. They were found by this guard's
 * first run and are out of scope for the change that added it; they are
 * listed so the guard can go green without hiding them, and the list is
 * checked in BOTH directions: an entry that gains a caller, or disappears,
 * fails until it is removed here.
 */
const TEST_ONLY_EXPORTS = ["probeCompressionTools", "probeOcrEngines"];

/** Route handlers, found by the App Router convention rather than listed. */
function routeHandlers(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^route\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(ROOT, "src", "app"));
  return out;
}

describe("the worker seam exports nothing that no code names", () => {
  it("the subject set and the corpus are plausibly sized (health check)", () => {
    // Measured when this guard was written: 68 runtime exports (70 before the
    // two dead factories were deleted) and 592 non-test sources. A broken
    // import or walk collapses these; the bounds sit well below both.
    expect(subjects.length).toBeGreaterThan(40);
    expect(corpus.length).toBeGreaterThan(400);
    // The subject set is the barrel the route handlers actually import.
    const importers = routeHandlers().filter((f) =>
      /from\s+["']@\/lib\/workers["']/.test(readFileSync(f, "utf8")),
    );
    expect(importers.length).toBeGreaterThan(0);
    expect(subjects).toContain("getWorkerAdapter");
  });

  it("every runtime export of @/lib/workers is named outside its declaration", () => {
    const unnamed = unnamedExports(subjects, corpus);
    expect(unnamed.filter((n) => !TEST_ONLY_EXPORTS.includes(n))).toEqual([]);
    // The exception list cannot go stale: every entry is still a subject and
    // still unnamed. Remove an entry when it gains a caller or is deleted.
    expect(TEST_ONLY_EXPORTS.filter((n) => !unnamed.includes(n))).toEqual([]);
  });

  it("positive control: an export nothing names is caught, a used one is not", () => {
    const synthetic = [
      "/** The default thing. Answers `x`. */\nexport function lonelyExport() { return 1; }",
      "export function usedExport() { return 2; }\n// lonelyExport() is only mentioned in a comment",
      "import { usedExport } from './a';\nconst u = 'https://example.test'; usedExport();",
    ].map(stripComments);
    expect(unnamedExports(["lonelyExport", "usedExport"], synthetic)).toEqual([
      "lonelyExport",
    ]);
    // Against the real corpus, the route seam's entry point is found in use.
    expect(unnamedExports(["getWorkerAdapter"], corpus)).toEqual([]);
  });

  it("the claim that replaced the dead factories names tests that exist", () => {
    // getWorkerAdapter's docblock says what an unconfigured deployment answers
    // and names the tests that assert it. A comment is not a guard, so the
    // names it cites must be real test titles in adapter.test.ts.
    const here = path.join(ROOT, "src", "lib", "workers");
    const adapter = readFileSync(path.join(here, "adapter.ts"), "utf8");
    const tests = readFileSync(path.join(here, "adapter.test.ts"), "utf8");
    const doc = adapter.slice(
      adapter.lastIndexOf(
        "/**",
        adapter.indexOf("export async function getWorkerAdapter"),
      ),
      adapter.indexOf("export async function getWorkerAdapter"),
    );
    // Join the wrapped comment lines, then read the quoted titles that follow
    // the file name the docblock cites.
    const flat = doc.replace(/\n\s*\*\s*/g, " ");
    const citation = flat.slice(flat.indexOf("adapter.test.ts"));
    const cited = [...citation.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    expect(cited.length).toBeGreaterThanOrEqual(2);
    for (const title of cited) {
      expect(tests, title).toContain(`it("${title}`);
    }
  });
});

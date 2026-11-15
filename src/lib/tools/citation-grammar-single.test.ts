import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ONE citation grammar (audit #30, chat-with-pdf#3, 2026-11-15).
 *
 * The worker counts `[p.N]` markers into manifest.answer.citedPages, and the
 * chat panel turns the same markers into buttons that open the page. If the
 * two ever read the answer with different grammars, a button opens a page the
 * manifest does not list, or a listed page has no button — and every unit test
 * of each grammar stays green. So the bracket regex may be DEFINED in exactly
 * one file, `src/lib/jobs/chat-citations.ts`, which both import.
 *
 * The subjects are DISCOVERED (CLAUDE.md rule 4): every non-test TS/TSX file
 * under `src/` and `scripts/` (the worker's entry point lives in scripts/),
 * not a list of files someone remembered.
 */

const ROOT = process.cwd();
const HOME = ["src", "lib", "jobs", "chat-citations.ts"].join("/");
/** The regex source's opening, as it is written in a regex literal. */
const SIGNATURE = String.raw`\[(pp?`;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(name) && !/\.test\.tsx?$/.test(name))
      out.push(path);
  }
}

function sourceFiles(): Map<string, string> {
  const paths: string[] = [];
  for (const top of ["src", "scripts"]) walk(join(ROOT, top), paths);
  const files = new Map<string, string>();
  for (const path of paths)
    files.set(
      relative(ROOT, path).split(sep).join("/"),
      readFileSync(path, "utf8"),
    );
  return files;
}

/** The files that define the bracket grammar. */
function definers(files: Map<string, string>): string[] {
  return [...files]
    .filter(([, text]) => text.includes(SIGNATURE))
    .map(([path]) => path)
    .sort();
}

/** The property, as a function, so the positive control runs THROUGH it. */
function assertOneGrammar(files: Map<string, string>): void {
  expect(definers(files)).toEqual([HOME]);
}

describe("the citation grammar is defined once", () => {
  const files = sourceFiles();

  it("health check: the walk saw the codebase, including both readers", () => {
    expect(files.size).toBeGreaterThanOrEqual(500);
    expect(files.has(HOME)).toBe(true);
    expect(files.has("src/lib/workers/chat-with-pdf/engine.ts")).toBe(true);
    expect(files.has("src/components/tools/chat-answer.tsx")).toBe(true);
  });

  it("exactly one file defines the bracket regex, and it is chat-citations.ts", () => {
    assertOneGrammar(files);
  });

  it("both readers import it rather than parsing for themselves", () => {
    for (const reader of [
      "src/lib/workers/chat-with-pdf/engine.ts",
      "src/components/tools/chat-answer.tsx",
    ])
      expect(files.get(reader), reader).toMatch(
        /from "@\/lib\/jobs\/chat-citations"/,
      );
  });

  it("positive control: a second definition is caught", () => {
    const copy = new Map(files);
    const engine = "src/lib/workers/chat-with-pdf/engine.ts";
    copy.set(
      engine,
      `${copy.get(engine)}\nconst bracket = /${SIGNATURE}\\.?\\s*[^\\[\\]]{1,80})\\]/gi;\n`,
    );
    expect(() => assertOneGrammar(copy)).toThrow();
    // ...and so is the home losing it.
    const gone = new Map(files);
    gone.set(HOME, "export {};");
    expect(() => assertOneGrammar(gone)).toThrow();
  });
});

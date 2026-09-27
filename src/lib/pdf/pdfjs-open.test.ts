import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `pdfjs.ts` claims every `getDocument` caller goes through
 * `awaitPdfjsDocument`, so no tool can surface pdfjs's raw "No password given"
 * again. Only two readers had a behavioural test of that, and reverting any
 * other caller (the rasterizer, the thumbnail renderer, the layout reader) to
 * `await loadingTask.promise` stayed green. This pins the claim as a
 * RELATIONSHIP over every shipped file: each loading task a `getDocument` call
 * creates is handed to `awaitPdfjsDocument` in the same file.
 *
 * The files are DISCOVERED by walking the repository, not named: a new reader
 * is exactly the one a list would not name.
 */

const ROOT = join(__dirname, "..", "..", "..");
// Not shipped: VCS/tool state, dependencies, and the e2e harness (test code).
const SKIP = (name: string) =>
  name.startsWith(".") || name === "node_modules" || name === "e2e";
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    if (SKIP(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(name) &&
      !/\.test\.tsx?$/.test(name)
      ? [path]
      : [];
  });

// Code, not prose: this file's own subject is named in comments everywhere.
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

interface Opens {
  /** `getDocument(` calls in the file. */
  calls: number;
  /** The loading tasks among them never handed to `awaitPdfjsDocument`. */
  unguarded: string[];
}

/**
 * Each open is paired with the code between it and the NEXT open, not with the
 * whole file: two readers in one file both name their task `loadingTask`, and
 * a per-file match let one guarded call vouch for both (the render.ts
 * mutation below stayed green that way on the first draft).
 */
function pdfjsOpens(source: string): Opens {
  const body = code(source);
  const opens = [...body.matchAll(/\.getDocument\s*\(/g)].map((m) => m.index);
  const unguarded = opens.map((at, i) => {
    const declaration = body
      .slice(0, at)
      .match(/\b(?:const|let)\s+(\w+)\s*=\s*[\w.]*$/);
    // A call that is not assigned to a name cannot be handed on at all.
    if (!declaration) return "?";
    const task = declaration[1]!;
    const until = body.slice(at, opens[i + 1] ?? body.length);
    const handed = new RegExp(
      `\\bawaitPdfjsDocument\\s*\\(\\s*${task}\\s*\\)`,
    ).test(until);
    return handed ? null : task;
  });
  return {
    calls: opens.length,
    unguarded: unguarded.filter((t): t is string => t !== null),
  };
}

describe("every pdfjs open goes through awaitPdfjsDocument", () => {
  it("the predicate tells a guarded open from an unguarded one (controls)", () => {
    const open = "const task = pdfjs.getDocument({ data });\n";
    expect(pdfjsOpens(`${open}await awaitPdfjsDocument(task);`)).toEqual({
      calls: 1,
      unguarded: [],
    });
    expect(pdfjsOpens(`${open}await task.promise;`)).toEqual({
      calls: 1,
      unguarded: ["task"],
    });
    expect(pdfjsOpens("await pdfjs.getDocument({ data }).promise;")).toEqual({
      calls: 1,
      unguarded: ["?"],
    });
    // Two opens with one task name: the second open's guard does not vouch
    // for the first.
    expect(
      pdfjsOpens(
        `${open}await task.promise;\n${open}await awaitPdfjsDocument(task);`,
      ),
    ).toEqual({ calls: 2, unguarded: ["task"] });
    // A comment naming the call is not a call.
    expect(pdfjsOpens("// pdfjs.getDocument(x)\nconst a = 1;").calls).toBe(0);
  });

  it("finds no unguarded getDocument in shipped source", () => {
    const files = walk(ROOT);
    // Health check: the walk read the codebase, and found the readers.
    expect(files.length).toBeGreaterThan(200);
    const opens = files
      .map((file) => ({
        file: relative(ROOT, file).replace(/\\/g, "/"),
        ...pdfjsOpens(readFileSync(file, "utf8")),
      }))
      .filter((o) => o.calls > 0);
    // The rasterizer, thumbnails, text (x2), layout and the page reader: a
    // collapse to a handful would mean the pattern stopped matching.
    expect(opens.reduce((n, o) => n + o.calls, 0)).toBeGreaterThanOrEqual(6);
    expect(opens.filter((o) => o.unguarded.length > 0)).toEqual([]);
  });
});

// @vitest-environment node
/**
 * One definition of what qpdf's exit statuses mean, and every runner that reads
 * one reading it from there.
 *
 * History: the repair runner knew exit 3 was "warnings, output written" and
 * kept that in a private constant; the protect/unlock runner threw on any
 * `result.code !== 0`, so every damaged-but-recoverable PDF failed Protect after
 * qpdf had written a correctly encrypted file. Nothing compared the two runners,
 * because nothing knew there were two.
 *
 * The runners are DISCOVERED, not named: any non-test module under
 * `src/lib/workers` that mentions qpdf and reads an exit status. A new qpdf
 * runner is in the set the moment it exists.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  QPDF_EXIT_ERROR,
  QPDF_EXIT_WARNINGS,
  qpdfWroteOutput,
} from "./qpdf-exit";

const ROOT = process.cwd();
const WORKERS = path.join(ROOT, "src", "lib", "workers");
const SHARED = path.join(WORKERS, "qpdf-exit.ts");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** A module that runs qpdf and interprets how the process exited. */
const isQpdfExitReader = (source: string): boolean =>
  /\bqpdf\b/i.test(source) && /\bresult\.code\b/.test(source);

/**
 * The two shapes the defect took: "any non-zero exit is failure", and a qpdf
 * status re-typed as a bare number instead of read from the shared module.
 * `=== 0` stays legal — it is the one status that needs no name.
 */
const EXIT_SHAPE_VIOLATIONS: readonly RegExp[] = [
  /\.code\s*!==\s*0\b/,
  /\.code\s*[!=]==\s*[1-9]\d*\b/,
];

const violationsIn = (source: string): string[] =>
  EXIT_SHAPE_VIOLATIONS.filter((re) => re.test(source)).map(String);

const IMPORTS_SHARED = /from\s+["']\.\.\/qpdf-exit["']/;

const rel = (file: string) => path.relative(ROOT, file).replace(/\\/g, "/");

describe("qpdf exit statuses — one definition, read by every runner", () => {
  const files = walk(WORKERS);
  const readers = files
    .filter((f) => f !== SHARED)
    .filter((f) => isQpdfExitReader(readFileSync(f, "utf8")));

  it("health check: the walk saw the worker tree and found the runners", () => {
    // A walk that quietly shrinks makes every assertion below vacuous.
    expect(files.length).toBeGreaterThan(100);
    // Today: pdf-security/native.ts and pdf-structure/native.ts. Fewer than two
    // means the discovery predicate went blind, not that the runners left.
    expect(readers.map(rel)).toEqual(
      expect.arrayContaining([
        "src/lib/workers/pdf-security/native.ts",
        "src/lib/workers/pdf-structure/native.ts",
      ]),
    );
  });

  it("positive control: the violation shapes catch the defect as it shipped", () => {
    // The pre-fix protect/unlock interpretation, verbatim.
    expect(
      violationsIn(
        "if (result.timedOut || result.code !== 0) { throw new Error(); }",
      ),
    ).not.toEqual([]);
    expect(violationsIn("const recovered = result.code === 3;")).not.toEqual(
      [],
    );
    expect(violationsIn("if (result.code === 0) return true;")).toEqual([]);
    expect(
      isQpdfExitReader('exec("qpdf", args); if (result.code !== 0) throw e;'),
    ).toBe(true);
  });

  it("every qpdf runner imports the shared statuses and re-types none", () => {
    const offenders = readers.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const problems = violationsIn(source);
      if (!IMPORTS_SHARED.test(source))
        problems.push("does not import ../qpdf-exit");
      return problems.map((p) => `${rel(file)}: ${p}`);
    });
    expect(offenders).toEqual([]);
  });

  it("nothing else in src or scripts defines a QPDF_EXIT_* constant", () => {
    const everywhere = [
      ...walk(path.join(ROOT, "src")),
      ...walk(path.join(ROOT, "scripts")),
    ];
    const definers = everywhere
      .filter((f) => /\bQPDF_EXIT_\w*\s*=\s*\d/.test(readFileSync(f, "utf8")))
      .map(rel);
    // Positive control built in: the shared module itself must be found.
    expect(definers).toEqual(["src/lib/workers/qpdf-exit.ts"]);
  });
});

describe("qpdfWroteOutput", () => {
  it("accepts clean and warnings exits, nothing else, and never a timeout", () => {
    expect(qpdfWroteOutput({ code: 0, timedOut: false })).toBe(true);
    expect(qpdfWroteOutput({ code: QPDF_EXIT_WARNINGS, timedOut: false })).toBe(
      true,
    );
    for (const code of [1, QPDF_EXIT_ERROR, 4, -1]) {
      expect(qpdfWroteOutput({ code, timedOut: false })).toBe(false);
    }
    expect(qpdfWroteOutput({ code: 0, timedOut: true })).toBe(false);
  });
});

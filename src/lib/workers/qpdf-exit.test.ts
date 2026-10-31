// @vitest-environment node
/**
 * One definition of what qpdf's exit statuses mean, and the qpdf runners this
 * test can find reading it from there — or recorded, by name and by defect, as
 * not doing so.
 *
 * History: the repair runner knew exit 3 was "warnings, output written" and
 * kept that in a private constant; the protect/unlock runner threw on any
 * `result.code !== 0`, so every damaged-but-recoverable PDF failed Protect after
 * qpdf had written a correctly encrypted file. Nothing compared the two runners.
 *
 * History of THIS guard, kept because its first version was the defect it
 * exists to catch. It found runners by the spelling `result.code`, titled itself
 * "every qpdf runner", and claimed a new runner "is in the set the moment it
 * exists". A third qpdf runner already existed: `compression/native.ts` runs
 * qpdf through `promisify(execFile)`, which REJECTS on every non-zero exit, so
 * exit 3 is thrown away there too — spelled as a rejection, never as
 * `result.code`, and so outside the set. The guard reported green over a set
 * missing the one runner with the defect still in it.
 *
 * WHAT THE SET IS NOW. Discovered by what a module does, not how it spells the
 * exit status: a non-test module under `src/` or `scripts/` that spawns a
 * process itself (imports `child_process`) AND names qpdf. That is every
 * module today that can hand a qpdf exit status to anything.
 *
 * WHAT IT CANNOT SEE, stated so nobody reads more into a green than it proves:
 *  - a module that runs qpdf through ANOTHER module's exec helper, without
 *    importing `child_process` itself;
 *  - a spawner that reaches qpdf only through configuration and never names it;
 *  - shell scripts (`scripts/*.sh` names qpdf only to check it is on PATH).
 * A spawner that names qpdf only in a comment IS in the set; that errs red.
 *
 * KNOWN EXCEPTION — NOT COVERED: `compression/native.ts` (Compress PDF, qpdf
 * engine) still rejects exit 3. A damaged PDF that qpdf repairs and compresses
 * is reported as an engine failure. It is out of this lane (pdf-security), so
 * it is recorded below, and the test asserts the defect is STILL there: the day
 * someone fixes it, this test goes red until the exception is deleted, so the
 * record cannot outlive the defect.
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
const SHARED = path.join(ROOT, "src", "lib", "workers", "qpdf-exit.ts");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (
      /\.(?:[cm]?[jt]s|tsx)$/.test(entry.name) &&
      !/\.test\.(?:[cm]?[jt]s|tsx)$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

/** The module starts processes itself. */
const SPAWNS =
  /(?:from\s+|require\(\s*|import\(\s*)["'](?:node:)?child_process["']/;

/** A module that spawns a process and names qpdf: it can run qpdf and read how it exited. */
const isQpdfRunner = (source: string): boolean =>
  SPAWNS.test(source) && /\bqpdf\b/i.test(source);

/**
 * The shapes the defect has taken, over ANY spelling of the exit value
 * (`result.code`, a destructured `code`, `exitCode`, `status`):
 *  - "any non-zero exit is failure", either operand order;
 *  - a qpdf status re-typed as a bare number instead of read from the shared
 *    module (`=== 0` stays legal — the one status that needs no name);
 *  - an exec that REJECTS on a non-zero exit, so 3 never reaches an
 *    interpreter at all: `promisify(execFile)`, the sync variants, or a
 *    callback wrapper that calls `reject(`.
 */
const EXIT_VALUE = String.raw`\b(?:[\w$]+\.)*\w*(?:code|status)\b`;
const EXIT_SHAPE_VIOLATIONS: readonly RegExp[] = [
  new RegExp(String.raw`${EXIT_VALUE}\s*!==?\s*0\b`, "i"),
  new RegExp(String.raw`\b0\s*!==?\s*${EXIT_VALUE}`, "i"),
  new RegExp(String.raw`${EXIT_VALUE}\s*[!=]==?\s*[1-9]\d*\b`, "i"),
  new RegExp(String.raw`\b[1-9]\d*\s*[!=]==?\s*${EXIT_VALUE}`, "i"),
  /\bpromisify\(\s*(?:execFile|exec)\s*\)/,
  /\b(?:execFileSync|execSync)\b/,
  // A rejection is the defect when it carries the exit. An abort (the attempt
  // lost its lease, `./attempt-abort`) has no exit to carry; rejecting it is
  // what keeps it from being read as a status at all.
  /\breject\s*\((?!\s*new AttemptAbortedError\(\s*\))/,
];

const violationsIn = (source: string): string[] =>
  EXIT_SHAPE_VIOLATIONS.filter((re) => re.test(source)).map(String);

const IMPORTS_SHARED = /from\s+["'][^"']*\/qpdf-exit["']/;

const rel = (file: string) => path.relative(ROOT, file).replace(/\\/g, "/");

/**
 * qpdf runners that do NOT honour exit 3, each with the defect it still has.
 * Every entry is asserted to be discovered AND still defective, so an entry can
 * neither hide a runner the discovery lost nor outlive its fix.
 */
const KNOWN_EXCEPTIONS: Readonly<Record<string, string>> = {
  "src/lib/workers/compression/native.ts":
    "Compress PDF (qpdf engine) runs qpdf through promisify(execFile), which " +
    "rejects on exit 3 ('warnings, output written'): a damaged PDF qpdf " +
    "repaired and compressed is reported as an engine failure. Follow-up for " +
    "compress-pdf: resolve with the exit status and accept qpdfWroteOutput().",
};

describe("qpdf exit statuses — one definition, and the runners found reading it", () => {
  const files = [
    ...walk(path.join(ROOT, "src")),
    ...walk(path.join(ROOT, "scripts")),
  ];
  const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
  const spawners = files.filter((f) => SPAWNS.test(sources.get(f)!));
  const runners = files
    .filter((f) => f !== SHARED)
    .filter((f) => isQpdfRunner(sources.get(f)!));

  it("health check: the walk saw the tree, and discovery discriminates", () => {
    // A walk that quietly shrinks makes every assertion below vacuous.
    expect(files.length).toBeGreaterThan(500);
    // Spawners are the set runners are drawn from. Too few means the import
    // pattern went blind; runners === spawners means "names qpdf" stopped
    // discriminating and the set is answering an easier question.
    expect(spawners.length).toBeGreaterThanOrEqual(8);
    expect(runners.length).toBeLessThan(spawners.length);
  });

  it("positive control: discovery finds all three qpdf runners, including the one that never spells result.code", () => {
    expect(runners.map(rel)).toEqual(
      expect.arrayContaining([
        "src/lib/workers/compression/native.ts",
        "src/lib/workers/pdf-security/native.ts",
        "src/lib/workers/pdf-structure/native.ts",
      ]),
    );
    // The spelling the first version of this guard keyed on is absent from it.
    expect(
      sources
        .get(path.join(ROOT, "src/lib/workers/compression/native.ts"))!
        .includes("result.code"),
    ).toBe(false);
  });

  it("positive control: the violation shapes catch the defect in every spelling it has shipped in", () => {
    // The pre-fix protect/unlock interpretation, verbatim.
    expect(
      violationsIn(
        "if (result.timedOut || result.code !== 0) { throw new Error(); }",
      ),
    ).not.toEqual([]);
    // The compression runner's default exec, verbatim.
    expect(
      violationsIn("const runExecFile = promisify(execFile);"),
    ).not.toEqual([]);
    // Spellings the first version let through.
    expect(
      violationsIn("const { code } = r; if (code !== 0) throw e;"),
    ).not.toEqual([]);
    expect(violationsIn("if (exitCode != 0) return;")).not.toEqual([]);
    expect(violationsIn("if (0 !== r.status) return;")).not.toEqual([]);
    expect(violationsIn("const recovered = result.code === 3;")).not.toEqual(
      [],
    );
    expect(violationsIn("if (3 === code) ok();")).not.toEqual([]);
    expect(
      violationsIn("execFile(bin, args, (e) => e ? reject(e) : resolve())"),
    ).not.toEqual([]);
    expect(
      violationsIn("if (error) return reject(pdfTextExecErrorFrom(error));"),
    ).not.toEqual([]);
    // Negative controls: the legal shapes the fixed runners use.
    expect(
      violationsIn(
        "if (isAttemptAbort(error)) return reject(new AttemptAbortedError());",
      ),
    ).toEqual([]);
    expect(violationsIn("if (result.code === 0) return true;")).toEqual([]);
    expect(
      violationsIn("if (result.code === QPDF_EXIT_WARNINGS) return x;"),
    ).toEqual([]);
    expect(
      violationsIn('typeof error.code === "number" ? error.code : -1'),
    ).toEqual([]);
    // Discovery sees a runner by what it does, however it spells the exit.
    expect(
      isQpdfRunner(
        'import { execFile } from "node:child_process"; run("qpdf", args);',
      ),
    ).toBe(true);
    expect(
      isQpdfRunner('import { execFile } from "node:child_process"; run("gs");'),
    ).toBe(false);
  });

  it("every discovered qpdf runner imports the shared statuses and re-types none, except the recorded exceptions", () => {
    const offenders = runners
      .filter((file) => !(rel(file) in KNOWN_EXCEPTIONS))
      .flatMap((file) => {
        const source = sources.get(file)!;
        const problems = violationsIn(source);
        if (!IMPORTS_SHARED.test(source))
          problems.push("does not import qpdf-exit");
        return problems.map((p) => `${rel(file)}: ${p}`);
      });
    expect(offenders).toEqual([]);
  });

  it("every recorded exception is a discovered runner that STILL has its defect (delete the entry when it is fixed)", () => {
    const found = new Set(runners.map(rel));
    for (const file of Object.keys(KNOWN_EXCEPTIONS)) {
      // Not discovered: the entry hides nothing, or discovery lost a runner.
      expect(found.has(file), `${file} is not a discovered runner`).toBe(true);
      const source = sources.get(path.join(ROOT, file))!;
      // Still defective. If this fails, the runner was fixed: remove the entry
      // so the main assertion above covers it.
      expect(
        violationsIn(source).length > 0 || !IMPORTS_SHARED.test(source),
        `${file} no longer shows its recorded defect`,
      ).toBe(true);
    }
  });

  it("nothing else in src or scripts defines a QPDF_EXIT_* constant", () => {
    const definers = files
      .filter((f) => /\bQPDF_EXIT_\w*\s*=\s*\d/.test(sources.get(f)!))
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

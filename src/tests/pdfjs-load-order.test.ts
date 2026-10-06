// @vitest-environment node
/**
 * The files that drive pdf.js's real browser build pass whatever ran before
 * them in their worker.
 *
 * ── THE DEFECT, AND THE NOTE IT CORRECTS ────────────────────────────────────
 *
 * af37efb's check recorded "One earlier fixed run showed 5 grayscale-runner
 * tests red in that single-thread mode; not reproduced in the three runs after
 * it." It was deterministic, and review reproduced it on every run of
 *
 *   vitest run signed-input-notice grayscale-runner grayscale-runner-size
 *     --no-file-parallelism --sequence.shuffle.files --sequence.seed=3
 *
 * (seed 3 is the seed that puts signed-input-notice first). The mechanism:
 *
 *  1. `signed-input-notice.test.tsx` renders every single-file runner in jsdom.
 *     Loading a PDF starts the thumbnail renderer, which loads pdf.js.
 *  2. On that tree the loader imported the BROWSER build unconditionally. Its
 *     evaluation needs `DOMMatrix`, which jsdom does not have, so evaluating it
 *     threw "DOMMatrix is not defined".
 *  3. A module whose evaluation threw stays in the module cache as that error.
 *     Under `isolate: false` the cache is shared by every later file in the
 *     worker, so the grayscale files — which import pdf.js's legacy build first
 *     exactly so that `DOMMatrix` exists, then drive the browser build — were
 *     handed the cached error: 3 tests in grayscale-runner.test.tsx and 2 in
 *     grayscale-runner-size.test.tsx, the 5 that were seen.
 *
 * Whether the two files shared a worker in that order followed the CPU count,
 * which is why one run in four went red and the next three did not.
 *
 * ── THE FIX, AND WHY THIS CHECK EXISTS ──────────────────────────────────────
 *
 * `loadPdfjs` in `src/lib/pdf/pdfjs.ts` takes the legacy build wherever
 * `DOMMatrix` is absent, so the browser build is only ever evaluated where it
 * can succeed, and no file can leave a failed evaluation behind. That arrived
 * on this branch with the merge of wave1/l01 (cd5515e8, from 87316b85), which
 * is why the seeded command above is green here and red on integrate/tools.
 *
 * Nothing tested it. Every file passes alone, so the only test of the property
 * is the ORDER: this runs a fresh vitest, one worker, the file that loads pdf.js
 * with no `DOMMatrix` first, and every file that drives the browser build
 * after it. Mutation: make `loadPdfjs` import "pdfjs-dist" even where
 * `DOMMatrix` is absent, and this goes red with the five original failures.
 *
 * ── THE SET ─────────────────────────────────────────────────────────────────
 *
 * The files run after the first one are DISCOVERED: every test file that puts
 * pdf.js's worker module on the main thread (it imports the legacy worker) and
 * does not replace "pdfjs-dist" with a mock — that is, every file whose pages
 * are parsed by the real browser build. A file that mocks "pdfjs-dist" to the
 * legacy build never evaluates the browser build, so it cannot be poisoned
 * this way, and running it here would only answer an easier question.
 *
 * The first file is NAMED, because what makes it the poisoner is behaviour,
 * not text: it loads pdf.js where `DOMMatrix` is absent. That is checked from
 * the child's own trace (`pdfjs-load-order.probe.ts`) rather than assumed — if
 * signed-input-notice ever stops loading pdf.js, this goes red and says so,
 * instead of passing an order that no longer tests anything.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const POISONER = "src/components/tools/runner/signed-input-notice.test.tsx";
const CONFIG = "src/tests/pdfjs-load-order.vitest.config.ts";

const repoPath = (path: string) => relative(ROOT, path).replaceAll("\\", "/");

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return /\.test\.tsx?$/.test(entry.name) ? [repoPath(path)] : [];
  });
}

/** Imports pdf.js's legacy worker module, i.e. runs pdf.js on the main thread. */
const RUNS_PDFJS_IN_THREAD =
  /import\(\s*(?:\/\/[^\n]*\n\s*)*["']pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs["']\s*\)/;
/** Replaces the browser build with something else for the whole file. */
const MOCKS_PDFJS = /\bvi\.mock\(\s*["']pdfjs-dist["']/;

function browserBuildDrivers(): string[] {
  return testFiles(join(ROOT, "src"))
    .filter((file) => file !== POISONER)
    .filter((file) => {
      const source = readFileSync(join(ROOT, file), "utf8");
      return RUNS_PDFJS_IN_THREAD.test(source) && !MOCKS_PDFJS.test(source);
    })
    .sort();
}

interface JsonReport {
  testResults: {
    name: string;
    status: string;
    startTime: number;
    assertionResults: { status: string; fullName: string }[];
    message?: string;
  }[];
}

interface Trace {
  file: string;
  at: "start" | "end";
  domMatrix: string;
}

describe("the discovery of the files that drive pdf.js's browser build", () => {
  it("finds the grayscale files and leaves out a file that mocks pdf.js", () => {
    const drivers = browserBuildDrivers();
    // Health: a broken walk or pattern would leave nothing to run after the
    // poisoner, and an empty order passes vacuously.
    expect(drivers).toContain(
      "src/components/tools/runner/grayscale-runner.test.tsx",
    );
    expect(drivers).toContain(
      "src/components/tools/runner/grayscale-runner-size.test.tsx",
    );
    // Bound: this is a handful of slow, real-render files, not the suite.
    expect(drivers.length).toBeLessThanOrEqual(10);
    // Control: it imports the legacy worker too, but mocks "pdfjs-dist".
    const chain = "src/components/tools/runner/pdf-to-image-chain.test.tsx";
    expect(existsSync(join(ROOT, chain))).toBe(true);
    const source = readFileSync(join(ROOT, chain), "utf8");
    expect(RUNS_PDFJS_IN_THREAD.test(source)).toBe(true);
    expect(drivers).not.toContain(chain);
  });
});

describe("pdf.js load order under isolate:false", () => {
  it("a file that loads pdf.js with no DOMMatrix does not break the files after it", () => {
    const order = [POISONER, ...browserBuildDrivers()];
    const work = mkdtempSync(join(tmpdir(), "pdfjs-load-order-"));
    const report = join(work, "report.json");
    const trace = join(work, "trace.jsonl");
    writeFileSync(trace, "");

    const vitestCli = join(
      dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
      "vitest.mjs",
    );
    // A fresh vitest, not this one: the property is about what the FIRST
    // evaluation of pdf.js in a worker leaves behind, and this worker's module
    // cache has already decided that for itself.
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("VITEST")) delete env[key];
    }
    const run = spawnSync(
      process.execPath,
      [
        vitestCli,
        "run",
        "--config",
        CONFIG,
        "--no-file-parallelism",
        "--reporter=json",
        `--outputFile=${report}`,
        ...order,
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 150_000,
        env: {
          ...env,
          PDFJS_LOAD_ORDER: JSON.stringify(order),
          PDFJS_LOAD_ORDER_LOG: trace,
        },
      },
    );
    const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`.slice(-4000);
    const wrote = existsSync(report);
    const results = wrote
      ? (
          JSON.parse(readFileSync(report, "utf8")) as JsonReport
        ).testResults.map((r) => ({ ...r, file: repoPath(r.name) }))
      : [];
    const traces = readFileSync(trace, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Trace)
      .map((t) => ({ ...t, file: repoPath(t.file) }));
    rmSync(work, { recursive: true, force: true });
    expect(wrote, `the child run wrote a report:\n${output}`).toBe(true);

    // The order is the test: every listed file ran, in the listed order.
    const ran = [...results]
      .sort((a, b) => a.startTime - b.startTime)
      .map((r) => r.file);
    expect(ran).toEqual(order);

    // The first file started where pdf.js's browser build cannot evaluate —
    // a fresh worker, jsdom, no DOMMatrix. Otherwise the order tests nothing.
    expect(
      traces.find((t) => t.file === POISONER && t.at === "start")?.domMatrix,
      "DOMMatrix when the poisoner started",
    ).toBe("undefined");

    // THE PROPERTY: every test in every file after it passed.
    const failed = results.flatMap((r) =>
      r.assertionResults
        .filter((a) => a.status !== "passed")
        .map((a) => `${r.file} > ${a.fullName}`)
        .concat(
          r.status === "passed" || !r.message
            ? []
            : [`${r.file}: ${r.message}`],
        ),
    );
    expect(failed, output).toEqual([]);
    for (const file of order) {
      const passed = results
        .find((r) => r.file === file)!
        .assertionResults.filter((a) => a.status === "passed");
      expect(passed.length, `${file} ran tests`).toBeGreaterThan(0);
    }

    // Health: the poisoner did load pdf.js in that DOM. The legacy build
    // polyfills DOMMatrix when it is evaluated, so its presence at the end of
    // the file is the trace of pdf.js having been loaded during it.
    expect(
      traces.find((t) => t.file === POISONER && t.at === "end")?.domMatrix,
      `${POISONER} loaded pdf.js where DOMMatrix was absent`,
    ).toBe("function");
    expect(run.status, output).toBe(0);
  }, 180_000);
});

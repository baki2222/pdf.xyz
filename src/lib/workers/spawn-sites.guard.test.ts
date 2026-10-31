// @vitest-environment node
/**
 * GUARD: every child process the worker can start is started with the
 * attempt's abort signal.
 *
 * A lost attempt (its lease renewal REJECTED, PR #245) has its result
 * discarded by the executor. An engine that spawns without `{ signal }` keeps
 * that discarded work running to completion on a single small VPS. This guard
 * makes a NEW engine that forgets the signal fail CI, without anyone having to
 * remember to add it to a list: the spawning modules are DISCOVERED from the
 * worker image's entry point (`src/tests/spawn-sites.ts` says how), and each
 * spawn site's options are typed by the compiler.
 *
 * Its controls, each of which this file runs:
 *  - health: the import graph and the spawning-module set are plausibly sized
 *    in BOTH directions, and every spawning module has at least one site the
 *    detector found (a module importing child_process with zero sites is a
 *    blind detector, not a clean module);
 *  - positive control: a fake engine that spawns without `signal` IS reported,
 *    through the same function, as are a sync spawn and a `promisify` alias;
 *  - negative control: the same fake with `signal` is not.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  discoverWorkerSpawnSites,
  rel,
  unsignalledSites,
} from "@/tests/spawn-sites";

const discovered = discoverWorkerSpawnSites();
const checked = unsignalledSites(discovered.modules);

const FIXTURES = mkdtempSync(path.join(tmpdir(), "pdfxyz-spawn-guard-"));
afterAll(() => rmSync(FIXTURES, { recursive: true, force: true }));

function fixture(name: string, body: string): string {
  const file = path.join(FIXTURES, `${name}.ts`);
  writeFileSync(file, body);
  return file;
}

describe("spawn-site discovery (health)", () => {
  it("prints what it found", () => {
    // The members, never only a count (a zero from a search is a claim too).
    console.log(
      [
        `entry: ${discovered.entries.map((f) => rel(f)).join(", ")}`,
        `value-import graph: ${discovered.graph.length} modules`,
        `spawning modules (${discovered.modules.length}):`,
        ...discovered.modules.map((f) => `  ${rel(f)}`),
        `spawn sites (${checked.sites.length}):`,
        ...checked.sites.map(
          (s) => `  ${rel(s.file)}:${s.line} ${s.fn} — ${s.text}`,
        ),
      ].join("\n"),
    );
    expect(discovered.entries.map((f) => rel(f))).toContain(
      "scripts/worker-daemon.ts",
    );
  });

  it("the import graph is plausibly sized", () => {
    // Measured 2026-10-31 well inside both bounds. Below: a BFS bug collapsed
    // the graph. Above: it followed something it should not (a type edge,
    // the whole tree).
    expect(discovered.graph.length).toBeGreaterThan(150);
    expect(discovered.graph.length).toBeLessThan(2_000);
  });

  it("the spawning-module set is plausibly sized, and every member has sites", () => {
    // Eight families spawned on 2026-10-31 (compression, OCR, qpdf x2,
    // Ghostscript, LibreOffice, Chromium, pdftotext).
    expect(discovered.modules.length).toBeGreaterThanOrEqual(8);
    expect(discovered.modules.length).toBeLessThan(30);
    for (const file of discovered.modules) {
      const sites = checked.sites.filter((s) => s.file === file);
      expect(
        sites.length,
        `${rel(file)} imports child_process but no spawn call was detected`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("GUARD: every reachable spawn site passes the attempt's signal", () => {
  it("no spawn site reachable from the worker entry lacks `signal`", () => {
    const report = checked.unsignalled.map(
      (s) => `${rel(s.file)}:${s.line} ${s.fn}: ${s.why}`,
    );
    expect(report).toEqual([]);
  });
});

describe("the detector itself (controls)", () => {
  it("positive control: a fake engine that spawns without a signal is reported", () => {
    const bad = fixture(
      "fake-engine-unsignalled",
      `import { execFile, spawn, execFileSync } from "node:child_process";
       import * as cp from "node:child_process";
       import { promisify } from "node:util";
       const run = promisify(execFile);
       export function a() { execFile("gs", ["-q"], { timeout: 1 }, () => {}); }
       export function b() { return spawn("soffice", [], { windowsHide: true }); }
       export function c() { return run("qpdf", ["--version"], { timeout: 1 }); }
       export function d() { return cp.execFile("mutool", []); }
       export function e() { return execFileSync("gs", []); }
      `,
    );
    const { sites, unsignalled } = unsignalledSites([bad]);
    expect(sites.map((s) => s.fn).sort()).toEqual([
      "execFile",
      "execFile",
      "execFile",
      "execFileSync",
      "spawn",
    ]);
    // Every one of them: none can be stopped by a lost attempt.
    expect(unsignalled.map((s) => s.line).sort()).toEqual(
      sites.map((s) => s.line).sort(),
    );
  });

  it("negative control: the same calls with a signal pass", () => {
    const good = fixture(
      "fake-engine-signalled",
      `import { execFile, spawn } from "node:child_process";
       import { promisify } from "node:util";
       const run = promisify(execFile);
       type Opts = { timeout: number; signal?: AbortSignal };
       export function a(signal: AbortSignal) { execFile("gs", ["-q"], { timeout: 1, signal }, () => {}); }
       export function b(o: Opts) { return spawn("soffice", [], { ...o, windowsHide: true }); }
       export function c(o: Opts) { return run("qpdf", ["--version"], o); }
      `,
    );
    const { sites, unsignalled } = unsignalledSites([good]);
    expect(sites).toHaveLength(3);
    expect(unsignalled).toEqual([]);
  });
});

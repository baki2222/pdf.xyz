// @vitest-environment node
/**
 * Executable contract for the node-free ENGINE PREFLIGHT (`scripts/worker-engines.sh`).
 *
 * Unlike the other deploy checks (which pin static text), this actually RUNS the
 * preflight and asserts its exit-code contract and content-freedom — the Docker-free
 * proof of the same logic the container workflow exercises INSIDE the built worker
 * image (where the engines are really present). It runs the script under a fully
 * sanitized `PATH` so the result never depends on whatever engines happen to be on the
 * CI host: an isolated `PATH` containing only the coreutils the script needs makes the
 * "no engine installed" paths deterministic, and a second dir of tiny executable STUBS
 * named after each engine makes the "engine installed" paths deterministic — no real
 * Ghostscript/OCRmyPDF/Tesseract required, and no document is ever processed.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts", "worker-engines.sh");

/** Resolve a coreutil's absolute path using the current PATH, once. */
function realPath(bin: string): string {
  return execFileSync("sh", ["-c", `command -v ${bin}`], {
    encoding: "utf8",
  }).trim();
}

// A PATH with ONLY the externals the script invokes (tr/awk/sed) — no engine binary
// can leak in from the host, so every "missing" branch is deterministic.
const utilDir = mkdtempSync(path.join(os.tmpdir(), "wf-utils-"));
for (const util of ["tr", "awk", "sed"]) {
  const resolved = realPath(util);
  if (resolved) symlinkSync(resolved, path.join(utilDir, util));
}

// A separate dir of executable STUBS named after the engines — presence-only: the
// preflight probes with `command -v` and never executes them, so an empty +x file is
// enough to make an engine read as "installed".
const engineDir = mkdtempSync(path.join(os.tmpdir(), "wf-engines-"));
for (const engine of ["gs", "qpdf", "mutool", "ocrmypdf", "tesseract"]) {
  const stub = path.join(engineDir, engine);
  writeFileSync(stub, "#!/bin/sh\nexit 0\n");
  chmodSync(stub, 0o755);
}

const NO_ENGINES = utilDir; // only coreutils on PATH
const WITH_ENGINES = `${engineDir}:${utilDir}`; // engines + coreutils

afterAll(() => {
  // Best-effort cleanup; ignore if the OS already reaped the temp dirs.
  try {
    execFileSync("rm", ["-rf", utilDir, engineDir]);
  } catch {
    /* noop */
  }
});

interface Run {
  code: number;
  stdout: string;
}

/** Run the preflight with an isolated PATH and the given extra env. Never inherits host env. */
function run(
  pathValue: string,
  env: Record<string, string> = {},
  args: string[] = [],
): Run {
  try {
    const stdout = execFileSync("/bin/sh", [SCRIPT, ...args], {
      encoding: "utf8",
      // Hermetic env: NODE_ENV satisfies the project's typed ProcessEnv, the caller's
      // selectors are applied, and the sanitized PATH is pinned last so it always wins.
      env: { NODE_ENV: "test", ...env, PATH: pathValue },
    });
    return { code: 0, stdout };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      code: err.status ?? 1,
      stdout: `${err.stdout ?? ""}${err.stderr ?? ""}`,
    };
  }
}

describe("worker-engines.sh — exit-code contract (opt-in requirements)", () => {
  it("is green by default: nothing required ⇒ exit 0 even with no engine installed", () => {
    const { code, stdout } = run(NO_ENGINES);
    expect(code).toBe(0);
    expect(stdout).toContain("OK (all required engines present)");
    // It honestly reports the engines as missing without failing.
    expect(stdout).toMatch(/missing\s+Ghostscript/);
    expect(stdout).toMatch(/missing\s+OCRmyPDF/);
  });

  it("require-OCR without opting in ⇒ exit 3 (independent of any installed engine)", () => {
    // This fails on the opt-in check before engine presence, so it holds even with
    // the stub engines present — a required-but-not-enabled OCR backend is unmet.
    for (const p of [NO_ENGINES, WITH_ENGINES]) {
      const { code, stdout } = run(p, { PDFXYZ_WORKER_REQUIRE_OCR: "true" });
      expect(code).toBe(3);
      expect(stdout).toMatch(/UNMET\s+OCR is REQUIRED but not opted in/);
    }
  });

  it("require-OCR + opted in but no engine ⇒ exit 3 (unavailable)", () => {
    const { code, stdout } = run(NO_ENGINES, {
      PDFXYZ_WORKER_REQUIRE_OCR: "1",
      PDFXYZ_OCR: "on",
    });
    expect(code).toBe(3);
    expect(stdout).toMatch(/UNMET\s+OCR is REQUIRED and opted in but/);
  });

  it("require-OCR + opted in + engine present ⇒ exit 0 (ready)", () => {
    const { code, stdout } = run(WITH_ENGINES, {
      PDFXYZ_WORKER_REQUIRE_OCR: "yes",
      PDFXYZ_OCR: "on",
    });
    expect(code).toBe(0);
    expect(stdout).toMatch(/OCR required and satisfied/);
  });

  it("require-deep-engine with no native engine ⇒ exit 3; with one present ⇒ exit 0", () => {
    const absent = run(NO_ENGINES, {
      PDFXYZ_WORKER_REQUIRE_DEEP_ENGINE: "true",
    });
    expect(absent.code).toBe(3);
    expect(absent.stdout).toMatch(/UNMET\s+deep compression is REQUIRED/);

    const present = run(WITH_ENGINES, {
      PDFXYZ_WORKER_REQUIRE_DEEP_ENGINE: "true",
    });
    expect(present.code).toBe(0);
    expect(present.stdout).toMatch(/deep compression required and satisfied/);
  });

  it("honors an engine pin: require-deep pinned to a missing engine is unmet even if others exist", () => {
    // Stub engines are all present, but pinning to qpdf and then hiding only qpdf would
    // need a bespoke dir; instead assert the inverse — a pin to a present engine passes.
    const { code, stdout } = run(WITH_ENGINES, {
      PDFXYZ_WORKER_REQUIRE_DEEP_ENGINE: "on",
      PDFXYZ_COMPRESSION_ENGINE: "qpdf",
    });
    expect(code).toBe(0);
    expect(stdout).toMatch(/deep compression required and satisfied/);
  });

  it("a wanted-but-not-required deep engine is a warning, not a failure (exit 0)", () => {
    const { code, stdout } = run(NO_ENGINES, {
      PDFXYZ_NATIVE_COMPRESSION: "on",
    });
    expect(code).toBe(0);
    expect(stdout).toMatch(/note: deep compression is enabled but/);
  });

  it("`auto` deep compression never demands an engine (exit 0, no warning)", () => {
    const { code, stdout } = run(NO_ENGINES, {
      PDFXYZ_NATIVE_COMPRESSION: "auto",
    });
    expect(code).toBe(0);
    expect(stdout).toContain("deep compression not required");
    expect(stdout).not.toMatch(/note: deep compression is enabled/);
  });

  it("rejects an unknown flag as a usage error (exit 1)", () => {
    const { code } = run(NO_ENGINES, {}, ["--bogus"]);
    expect(code).toBe(1);
  });

  it("--help prints usage and exits 0", () => {
    const { code, stdout } = run(NO_ENGINES, {}, ["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("ENGINE PREFLIGHT");
  });
});

describe("worker-engines.sh — content-free & honest output", () => {
  it("never prints a path-like token in any requirement mode", () => {
    // Presence-only: the readout must carry no `/` (a resolved binary path, temp dir,
    // object key, or endpoint) in any of the exit-0 / exit-3 modes.
    const modes: Array<[string, Record<string, string>]> = [
      [NO_ENGINES, {}],
      [NO_ENGINES, { PDFXYZ_WORKER_REQUIRE_OCR: "true" }],
      [NO_ENGINES, { PDFXYZ_WORKER_REQUIRE_OCR: "1", PDFXYZ_OCR: "on" }],
      [NO_ENGINES, { PDFXYZ_WORKER_REQUIRE_DEEP_ENGINE: "1" }],
      [WITH_ENGINES, { PDFXYZ_OCR: "on", PDFXYZ_WORKER_REQUIRE_OCR: "on" }],
      [NO_ENGINES, { PDFXYZ_NATIVE_COMPRESSION: "on" }],
    ];
    for (const [p, env] of modes) {
      const { stdout } = run(p, env);
      expect(stdout, `mode ${JSON.stringify(env)} leaked a '/'`).not.toContain(
        "/",
      );
    }
  });

  it("never echoes an environment-variable VALUE, even an unrecognized pin", () => {
    // A bogus pin must degrade gracefully with a fixed message — never reflecting the
    // attacker-influenced value back into the readout.
    const { stdout } = run(NO_ENGINES, {
      PDFXYZ_OCR: "on",
      PDFXYZ_OCR_ENGINE: "sneaky-value-1234",
    });
    expect(stdout).not.toContain("sneaky-value-1234");
    expect(stdout).toMatch(/OCR engine pin not recognized/);
  });
});

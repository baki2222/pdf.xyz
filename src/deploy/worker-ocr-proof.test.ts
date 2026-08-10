// @vitest-environment node
/**
 * Executable + static contract for the deterministic OCR proof
 * (`scripts/worker-ocr-proof.sh`).
 *
 * The real recognition run happens INSIDE the built worker image (the container
 * workflow, where Ghostscript + Tesseract + English data are installed). Here we
 * prove — Docker-free and without any real OCR engine — that the script's PLUMBING is
 * correct and honest:
 *
 *  - with no engine on PATH it reports a prerequisite failure (exit 2), never a faked
 *    pass;
 *  - driven by tiny STUB `gs`/`tesseract` executables (presence + canned output, never
 *    real recognition) it runs the full pipeline: it exits 0 only when a %PDF sidecar
 *    PDF and a sentinel-bearing text sidecar are produced, and exits 3 when the
 *    sentinel is absent or the PDF is missing — so the recognition check is genuinely
 *    ENFORCED, not decorative;
 *  - it never prints a temp path or the recognized text, and it always removes its
 *    temp dir (no `pdfxyz-ocr-proof.*` survives a run).
 *
 * Stubs make presence deterministic exactly like `worker-engines.test.ts` — no real
 * Ghostscript/Tesseract is required and no document is ever processed.
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts", "worker-ocr-proof.sh");
const SOURCE = readFileSync(SCRIPT, "utf8");
/** Executable lines only — the prose comments legitimately NAME what the script avoids. */
const CODE = SOURCE.split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");

/** Resolve a coreutil's absolute path using the current PATH, once. */
function realPath(bin: string): string {
  return execFileSync("sh", ["-c", `command -v ${bin}`], {
    encoding: "utf8",
  }).trim();
}

// A PATH with ONLY the coreutils the script invokes (NO gs/tesseract) — so the
// "missing engine" path is deterministic regardless of what the host has installed.
const utilDir = mkdtempSync(path.join(os.tmpdir(), "ocrproof-utils-"));
for (const util of ["sed", "tr", "grep", "head", "mktemp", "rm"]) {
  const resolved = realPath(util);
  if (resolved) symlinkSync(resolved, path.join(utilDir, util));
}

// A separate dir of STUB engines: a `gs` that writes a non-empty file at its
// `-sOutputFile=` target, and a `tesseract` that writes canned outputs selected by
// $STUB_TESS_MODE. Presence + canned bytes only — never real rasterization/recognition.
const stubDir = mkdtempSync(path.join(os.tmpdir(), "ocrproof-stubs-"));
writeFileSync(
  path.join(stubDir, "gs"),
  [
    "#!/bin/sh",
    "out=''",
    'for a in "$@"; do case "$a" in -sOutputFile=*) out=${a#-sOutputFile=} ;; esac; done',
    '[ -n "$out" ] && printf PNGSTUB > "$out"',
    "exit 0",
    "",
  ].join("\n"),
);
writeFileSync(
  path.join(stubDir, "tesseract"),
  [
    "#!/bin/sh",
    // argv: <png> <base> -l eng pdf txt
    "base=$2",
    "mode=${STUB_TESS_MODE:-ok}",
    'case "$mode" in',
    "  no-pdf) : ;;",
    "  *) printf '%%PDF-1.5\\nstub pdf\\n%%%%EOF\\n' > \"$base.pdf\" ;;",
    "esac",
    'case "$mode" in',
    "  no-sentinel) printf 'lorem ipsum dolor sit\\n' > \"$base.txt\" ;;",
    "  no-txt) : ;;",
    // The sentinel appears (split + joined) so normalization must recover it.
    "  *) printf 'OCR PROOF header\\nOCRPROOF body line\\n' > \"$base.txt\" ;;",
    "esac",
    "exit 0",
    "",
  ].join("\n"),
);
chmodSync(path.join(stubDir, "gs"), 0o755);
chmodSync(path.join(stubDir, "tesseract"), 0o755);

const NO_ENGINES = utilDir;
const WITH_STUB_ENGINES = `${stubDir}:${utilDir}`;

afterAll(() => {
  for (const dir of [utilDir, stubDir]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  }
});

interface Run {
  code: number;
  stdout: string;
  tmpdir: string;
  leftover: string[];
}

/** Run the proof with an isolated PATH + a private TMPDIR; report exit, output, and leftovers. */
function run(
  pathValue: string,
  env: Record<string, string> = {},
  args: string[] = [],
): Run {
  const tmpdir = mkdtempSync(path.join(os.tmpdir(), "ocrproof-tmp-"));
  let code = 0;
  let stdout = "";
  try {
    stdout = execFileSync("/bin/sh", [SCRIPT, ...args], {
      encoding: "utf8",
      env: { NODE_ENV: "test", ...env, TMPDIR: tmpdir, PATH: pathValue },
    });
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    code = err.status ?? 1;
    stdout = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
  const leftover = readdirSync(tmpdir).filter((n) =>
    n.startsWith("pdfxyz-ocr-proof."),
  );
  rmSync(tmpdir, { recursive: true, force: true });
  return { code, stdout, tmpdir, leftover };
}

describe("worker-ocr-proof.sh — prerequisite + flag contract", () => {
  it("reports a prerequisite failure (exit 2) when no OCR engine is on PATH — never a faked pass", () => {
    const { code, stdout } = run(NO_ENGINES);
    expect(code).toBe(2);
    expect(stdout).toMatch(/prerequisite engine missing/);
    expect(stdout).not.toMatch(/all checks passed/);
  });

  it("--help exits 0 and prints the proof's purpose", () => {
    const { code, stdout } = run(NO_ENGINES, {}, ["--help"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/DETERMINISTIC native OCR PROOF/);
  });

  it("an unknown flag is a usage error (exit 1)", () => {
    const { code } = run(NO_ENGINES, {}, ["--not-a-flag"]);
    expect(code).toBe(1);
  });
});

describe("worker-ocr-proof.sh — full pipeline under stub engines (recognition is enforced)", () => {
  it("passes (exit 0) when a %PDF PDF and a sentinel-bearing sidecar are produced, and cleans up", () => {
    const { code, stdout, leftover } = run(WITH_STUB_ENGINES, {
      STUB_TESS_MODE: "ok",
    });
    expect(code).toBe(0);
    expect(stdout).toMatch(/all checks passed/);
    expect(stdout).toMatch(/searchable PDF was produced/);
    expect(stdout).toMatch(/sentinel was recognized/);
    // Temp dir removed on success — nothing survives the run.
    expect(leftover).toEqual([]);
  });

  it("FAILS (exit 3) when the sidecar lacks the sentinel — the recognition check is real, not decorative", () => {
    const { code, stdout, leftover } = run(WITH_STUB_ENGINES, {
      STUB_TESS_MODE: "no-sentinel",
    });
    expect(code).toBe(3);
    expect(stdout).toMatch(/FAIL {2}the expected sentinel was recognized/);
    expect(stdout).toMatch(/worker ocr proof: FAILED/);
    // …and the recognized sidecar text is NEVER printed, even on failure.
    expect(stdout).not.toContain("lorem");
    expect(stdout).not.toContain("ipsum");
    // Temp dir removed on failure too (trap on every exit path).
    expect(leftover).toEqual([]);
  });

  it("FAILS (exit 3) when no searchable PDF is produced", () => {
    const { code, stdout } = run(WITH_STUB_ENGINES, {
      STUB_TESS_MODE: "no-pdf",
    });
    expect(code).toBe(3);
    expect(stdout).toMatch(/FAIL {2}a searchable PDF was produced/);
  });

  it("never prints a temp path or the recognized text on the happy path", () => {
    const { stdout } = run(WITH_STUB_ENGINES, { STUB_TESS_MODE: "ok" });
    // Presence-only: no '/' (a temp path, object key, or command path) anywhere.
    expect(stdout).not.toContain("/");
    // The recognized sidecar body never leaks into the readout.
    expect(stdout).not.toContain("body line");
    expect(stdout).not.toContain("header");
  });
});

describe("worker-ocr-proof.sh — static hygiene guarantees", () => {
  it("is strict, self-cleaning, and bounded by construction", () => {
    expect(SOURCE).toMatch(/^set -u/m);
    // A trap removes the temp dir on EXIT (and signals) — cleanup is load-bearing.
    expect(SOURCE).toMatch(/trap '.*rm -rf "\$workdir".*' EXIT/);
    expect(SOURCE).toMatch(/mktemp -d/);
  });

  it("recognizes the sentinel without ever printing recognized text", () => {
    // Quiet, fixed-string match — never echoes the sidecar; and nothing `cat`s the txt.
    expect(SOURCE).toMatch(/grep -qF "\$SENTINEL"/);
    expect(SOURCE).not.toMatch(/cat\s+["']?\$(base|txt|workdir)/);
    expect(SOURCE).toMatch(/SENTINEL='[A-Z0-9]+'/);
  });

  it("runs the baseline by argv (no shell interpolation of an external value) and sandboxes gs", () => {
    expect(SOURCE).toMatch(/tesseract "\$png" "\$base" -l eng pdf txt/);
    expect(SOURCE).toMatch(/gs [^\n]*-dSAFER/);
    // No eval / `sh -c` building a command from interpolated values (executable code only;
    // the comments legitimately say "no eval").
    expect(CODE).not.toMatch(/\beval\b/);
    expect(CODE).not.toMatch(/sh -c/);
  });

  it("contacts no cloud service, queue, store, scanner, or secret (executable code only)", () => {
    // Prose comments NAME what the proof avoids ("no … secret"); scan executable lines.
    expect(CODE).not.toMatch(
      /redis|upstash|s3|r2|clamav|clamd|secret|token|password/i,
    );
  });

  it("is wired as a package script", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8"),
    );
    expect(pkg.scripts["worker:ocr-proof"]).toBe(
      "sh scripts/worker-ocr-proof.sh",
    );
  });
});

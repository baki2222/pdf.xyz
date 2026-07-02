// @vitest-environment node
/**
 * Executable + static contract for the deterministic OCRmyPDF searchable-PDF proof
 * (`scripts/worker-ocrmypdf-proof.sh`).
 *
 * The real conversion happens INSIDE the built worker image (the container workflow,
 * where Ghostscript + OCRmyPDF + Tesseract + poppler-utils are installed). Here we
 * prove — Docker-free and without any real OCR engine — that the script's PLUMBING is
 * correct and honest:
 *
 *  - with a prerequisite tool missing it reports a prerequisite failure (exit 2), never
 *    a faked pass;
 *  - driven by tiny STUB `gs`/`ocrmypdf`/`pdftotext` executables (presence + canned
 *    output, never real rasterization/recognition) it runs the full pipeline and exits 0
 *    only when the source PDF is image-only, a %PDF output is produced, the OUTPUT is
 *    searchable, and the sidecar bears the sentinel — and exits 3 when ANY of those
 *    fails, so every check is genuinely ENFORCED, not decorative;
 *  - it never prints a temp path or the recognized text, and it always removes its temp
 *    dir (no `pdfxyz-ocrmypdf-proof.*` survives a run).
 *
 * Stubs make presence deterministic exactly like `worker-ocr-proof.test.ts` — no real
 * Ghostscript/OCRmyPDF/pdftotext is required and no document is ever processed. The
 * stub `pdftotext` keys off a marker the stub `ocrmypdf` writes into the OUTPUT PDF, so
 * the "image-only in, searchable out" differential is modeled faithfully.
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
const SCRIPT = path.join(ROOT, "scripts", "worker-ocrmypdf-proof.sh");
const SOURCE = readFileSync(SCRIPT, "utf8");
/** Executable lines only — the prose comments legitimately NAME what the script avoids. */
const CODE = SOURCE.split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");

/** Resolve a coreutil's absolute path using the current PATH, once. */
function realPath(bin: string): string {
  return execFileSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).trim();
}

// A PATH with ONLY the coreutils the script invokes (NO gs/ocrmypdf/pdftotext) — so the
// "missing prerequisite" path is deterministic regardless of what the host has installed.
const utilDir = mkdtempSync(path.join(os.tmpdir(), "ocrmypdf-utils-"));
for (const util of ["sed", "tr", "grep", "head", "mktemp", "rm"]) {
  const resolved = realPath(util);
  if (resolved) symlinkSync(resolved, path.join(utilDir, util));
}

// A separate dir of STUB tools — presence + canned bytes only, never real work:
//   * `gs`        writes a non-empty file at its `-sOutputFile=` target. Default: an
//                 image-only marker; $STUB_GS_MODE=hastext writes the OCR-layer marker so
//                 the (stub) pdftotext "extracts" the sentinel from the INPUT.
//   * `ocrmypdf`  parses `--sidecar <path>` + the trailing output path and writes a
//                 %PDF output (with an OCR-layer marker) and a sentinel-bearing sidecar,
//                 both selectable by $STUB_OCRMYPDF_MODE.
//   * `pdftotext` prints the sentinel iff the target file carries the OCR-layer marker,
//                 else nothing — modeling "image-only extracts nothing, searchable does".
const stubDir = mkdtempSync(path.join(os.tmpdir(), "ocrmypdf-stubs-"));
writeFileSync(
  path.join(stubDir, "gs"),
  [
    "#!/bin/sh",
    "out=''",
    'for a in "$@"; do case "$a" in -sOutputFile=*) out=${a#-sOutputFile=} ;; esac; done',
    '[ -z "$out" ] && exit 0',
    'case "${STUB_GS_MODE:-ok}" in',
    // hastext: the source already has a selectable text layer (NOT image-only).
    "  hastext) printf '%%PDF-1.5\\nPDFXYZ-OCR-LAYER OCRPROOF preexisting\\n%%%%EOF\\n' > \"$out\" ;;",
    // no-source: gs fails to emit anything, so the source PDF is absent.
    "  no-source) : ;;",
    "  *) printf '%%PDF-1.5\\nPDFXYZ-IMAGE-ONLY\\n%%%%EOF\\n' > \"$out\" ;;",
    "esac",
    "exit 0",
    "",
  ].join("\n"),
);
writeFileSync(
  path.join(stubDir, "ocrmypdf"),
  [
    "#!/bin/sh",
    // argv: --language eng --output-type pdf --sidecar <path> --quiet <in> <out>
    "sidecar=''; prev=''",
    'for a in "$@"; do case "$prev" in --sidecar) sidecar=$a ;; esac; prev=$a; done',
    'for a in "$@"; do out=$a; done', // last positional is the output PDF
    'mode=${STUB_OCRMYPDF_MODE:-ok}',
    'case "$mode" in',
    "  no-pdf) : ;;",
    // not-searchable: a %PDF is written but WITHOUT the OCR-layer marker, so the stub
    // pdftotext extracts nothing from it — the output is not searchable.
    "  not-searchable) printf '%%PDF-1.5\\nplain no text layer\\n%%%%EOF\\n' > \"$out\" ;;",
    "  *) printf '%%PDF-1.5\\nPDFXYZ-OCR-LAYER OCRPROOF\\n%%%%EOF\\n' > \"$out\" ;;",
    "esac",
    'case "$mode" in',
    "  no-sidecar-sentinel) [ -n \"$sidecar\" ] && printf 'lorem ipsum dolor sit\\n' > \"$sidecar\" ;;",
    "  *) [ -n \"$sidecar\" ] && printf 'OCRPROOF recognized body line\\n' > \"$sidecar\" ;;",
    "esac",
    "exit 0",
    "",
  ].join("\n"),
);
writeFileSync(
  path.join(stubDir, "pdftotext"),
  [
    "#!/bin/sh",
    // argv: <pdf> -   → print the sentinel iff the file carries the OCR-layer marker.
    'if grep -q PDFXYZ-OCR-LAYER "$1" 2>/dev/null; then',
    "  printf 'OCR PROOF searchable\\n'",
    "else",
    "  printf '\\n'",
    "fi",
    "exit 0",
    "",
  ].join("\n"),
);
for (const tool of ["gs", "ocrmypdf", "pdftotext"]) {
  chmodSync(path.join(stubDir, tool), 0o755);
}

const NO_TOOLS = utilDir;
const WITH_STUB_TOOLS = `${stubDir}:${utilDir}`;

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
  leftover: string[];
}

/** Run the proof with an isolated PATH + a private TMPDIR; report exit, output, leftovers. */
function run(pathValue: string, env: Record<string, string> = {}, args: string[] = []): Run {
  const tmpdir = mkdtempSync(path.join(os.tmpdir(), "ocrmypdf-tmp-"));
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
  const leftover = readdirSync(tmpdir).filter((n) => n.startsWith("pdfxyz-ocrmypdf-proof."));
  rmSync(tmpdir, { recursive: true, force: true });
  return { code, stdout, leftover };
}

describe("worker-ocrmypdf-proof.sh — prerequisite + flag contract", () => {
  it("reports a prerequisite failure (exit 2) when a tool is missing — never a faked pass", () => {
    const { code, stdout } = run(NO_TOOLS);
    expect(code).toBe(2);
    expect(stdout).toMatch(/prerequisite tool missing/);
    expect(stdout).not.toMatch(/all checks passed/);
  });

  it("--help exits 0 and prints the proof's purpose", () => {
    const { code, stdout } = run(NO_TOOLS, {}, ["--help"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/DETERMINISTIC OCRmyPDF searchable-PDF PROOF/);
  });

  it("an unknown flag is a usage error (exit 1)", () => {
    const { code } = run(NO_TOOLS, {}, ["--not-a-flag"]);
    expect(code).toBe(1);
  });
});

describe("worker-ocrmypdf-proof.sh — full pipeline under stub tools (every check is enforced)", () => {
  it("passes (exit 0) when the source is image-only and the OUTPUT is searchable, and cleans up", () => {
    const { code, stdout, leftover } = run(WITH_STUB_TOOLS, { STUB_OCRMYPDF_MODE: "ok" });
    expect(code).toBe(0);
    expect(stdout).toMatch(/all checks passed/);
    expect(stdout).toMatch(/no selectable sentinel text \(is image-only\)/);
    expect(stdout).toMatch(/output PDF is searchable/);
    expect(stdout).toMatch(/sidecar corroborates recognition/);
    // Temp dir removed on success — nothing survives the run.
    expect(leftover).toEqual([]);
  });

  it("FAILS (exit 3) when the OUTPUT PDF is not searchable — the searchability check is real", () => {
    const { code, stdout, leftover } = run(WITH_STUB_TOOLS, { STUB_OCRMYPDF_MODE: "not-searchable" });
    expect(code).toBe(3);
    expect(stdout).toMatch(/FAIL {2}the output PDF is searchable/);
    expect(stdout).toMatch(/worker ocrmypdf proof: FAILED/);
    // Temp dir removed on failure too (trap on every exit path).
    expect(leftover).toEqual([]);
  });

  it("FAILS (exit 3) when no searchable PDF is produced", () => {
    const { code, stdout } = run(WITH_STUB_TOOLS, { STUB_OCRMYPDF_MODE: "no-pdf" });
    expect(code).toBe(3);
    expect(stdout).toMatch(/FAIL {2}a searchable PDF was produced/);
  });

  it("FAILS (exit 3) when the sidecar lacks the sentinel — corroboration is enforced", () => {
    const { code, stdout } = run(WITH_STUB_TOOLS, { STUB_OCRMYPDF_MODE: "no-sidecar-sentinel" });
    expect(code).toBe(3);
    expect(stdout).toMatch(/FAIL {2}the sidecar corroborates recognition/);
    // …and the recognized sidecar text is NEVER printed, even on failure.
    expect(stdout).not.toContain("lorem");
    expect(stdout).not.toContain("ipsum");
  });

  it("FAILS (exit 3) when the source PDF already has selectable text — the image-only precondition is enforced", () => {
    const { code, stdout } = run(WITH_STUB_TOOLS, { STUB_GS_MODE: "hastext" });
    expect(code).toBe(3);
    expect(stdout).toMatch(/FAIL {2}the source PDF has no selectable sentinel text/);
  });

  it("FAILS (exit 3) when no source PDF is produced — a missing source is never a spurious 'image-only' pass", () => {
    // Even though the stub OCRmyPDF would gladly emit a searchable-looking output, a
    // missing image-only SOURCE means there is nothing to prove image-only→searchable
    // against — so the proof fails honestly rather than reading a spurious "ok".
    const { code, stdout, leftover } = run(WITH_STUB_TOOLS, { STUB_GS_MODE: "no-source" });
    expect(code).toBe(3);
    expect(stdout).toMatch(/FAIL {2}a source PDF exists to verify it is image-only/);
    expect(leftover).toEqual([]);
  });

  it("never prints a temp path or the recognized text on the happy path", () => {
    const { stdout } = run(WITH_STUB_TOOLS, { STUB_OCRMYPDF_MODE: "ok" });
    // Presence-only: no '/' (a temp path, object key, or command path) anywhere.
    expect(stdout).not.toContain("/");
    // The recognized text (sidecar body / extracted words) never leaks into the readout.
    expect(stdout).not.toContain("recognized body");
    expect(stdout).not.toContain("body line");
  });
});

describe("worker-ocrmypdf-proof.sh — static hygiene guarantees", () => {
  it("is strict, self-cleaning, and bounded by construction", () => {
    expect(SOURCE).toMatch(/^set -u/m);
    // A trap removes the temp dir on EXIT (and signals) — cleanup is load-bearing.
    expect(SOURCE).toMatch(/trap '.*rm -rf "\$workdir".*' EXIT/);
    expect(SOURCE).toMatch(/mktemp -d/);
  });

  it("proves searchability by extracting the sentinel, without ever printing recognized text", () => {
    // The image-only source and the searchable output are both checked with the SAME
    // pdftotext helper; the extracted text is piped to a quiet fixed-string grep and
    // never echoed. Nothing `cat`s the sidecar or the extracted stream.
    expect(SOURCE).toMatch(/grep -qF "\$SENTINEL"/);
    expect(SOURCE).toMatch(/pdftotext "\$1" -/);
    expect(SOURCE).not.toMatch(/cat\s+["']?\$(pdf_out|pdf_in|sidecar|workdir)/);
    expect(SOURCE).toMatch(/SENTINEL='[A-Z0-9]+'/);
  });

  it("makes an image-only PDF with gs (pdfimage, sandboxed) and OCRs it by argv — no shell interpolation", () => {
    // The fixture is an IMAGE-ONLY PDF (pdfimage device), so any extracted text is real OCR.
    expect(SOURCE).toMatch(/-sDEVICE=pdfimage\d+/);
    expect(SOURCE).toMatch(/gs [^\n]*-dSAFER/);
    // OCRmyPDF is invoked by argv with the runner's option shape (sidecar, plain-PDF output).
    expect(SOURCE).toMatch(/ocrmypdf --language eng --output-type pdf --sidecar "\$sidecar" --quiet "\$pdf_in" "\$pdf_out"/);
    // No eval / `sh -c` building a command from interpolated values (executable code only).
    expect(CODE).not.toMatch(/\beval\b/);
    expect(CODE).not.toMatch(/sh -c/);
  });

  it("contacts no cloud service, queue, store, scanner, or secret (executable code only)", () => {
    // Prose comments NAME what the proof avoids ("no … secret"); scan executable lines.
    expect(CODE).not.toMatch(/redis|upstash|s3|r2|clamav|clamd|secret|token|password/i);
  });

  it("is wired as a package script", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["worker:ocrmypdf-proof"]).toBe("sh scripts/worker-ocrmypdf-proof.sh");
  });
});

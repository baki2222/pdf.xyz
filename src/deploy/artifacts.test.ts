// @vitest-environment node
/**
 * Static checks for the Phase 19 worker deployment artifacts. The Docker daemon
 * is not available in this repo's build environment, so the images are never
 * built here — instead these assertions pin the structure that keeps the web app
 * and the worker image separated, and prove no artifact carries a real-looking
 * secret. They are the testable stand-in for a Docker build.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

// --------------------------------------------------------------------------- //
// Minimal Dockerfile stage model: split the file on `FROM … [AS name]` lines.
// --------------------------------------------------------------------------- //
interface Stage {
  name: string;
  body: string;
}

function parseStages(dockerfile: string): Stage[] {
  const stages: Stage[] = [];
  let current: Stage | null = null;
  for (const line of dockerfile.split("\n")) {
    const from = /^\s*FROM\s+\S+(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from) {
      if (current) stages.push(current);
      current = { name: from[1] ?? "", body: "" };
    } else if (current) {
      current.body += `${line}\n`;
    }
  }
  if (current) stages.push(current);
  return stages;
}

/**
 * The build INSTRUCTIONS of a stage, with `#` comment lines removed — so
 * assertions about what an image actually does are never fooled by documentation
 * (e.g. a comment that mentions `.next` or the other target's command). Dockerfile
 * comments are whole-line (`#` as the first non-space char); inline `#` is literal.
 */
function stageInstructions(stages: Stage[], name: string): string {
  const found = stages.find((s) => s.name === name);
  if (!found) throw new Error(`Dockerfile stage '${name}' not found`);
  return found.body
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

describe("Dockerfile — two independent targets, web ↔ worker separation", () => {
  const dockerfile = read("Dockerfile");
  const stages = parseStages(dockerfile);
  const names = stages.map((s) => s.name);

  it("defines the base, deps, build, web, and worker stages", () => {
    for (const name of ["base", "deps", "build", "web", "worker"]) {
      expect(names).toContain(name);
    }
  });

  it("the worker image installs the native deep-compression engines", () => {
    const worker = stageInstructions(stages, "worker");
    expect(worker).toMatch(/apt-get install[\s\S]*ghostscript/);
    expect(worker).toContain("qpdf");
    expect(worker).toContain("mupdf-tools"); // provides `mutool`
  });

  it("the worker image installs the OCR engine stack (OCRmyPDF/Tesseract + English data)", () => {
    // Phase 24: the worker image now ships the native OCR stack it advertises so the
    // optional `PDFXYZ_OCR` backend can actually run there. Tesseract is the
    // guaranteed baseline (image → searchable PDF); `tesseract-ocr-eng` is the minimal
    // English traineddata (must be explicit — `--no-install-recommends` skips it);
    // OCRmyPDF is the PDF-first engine.
    const worker = stageInstructions(stages, "worker");
    expect(worker).toMatch(/apt-get install[\s\S]*ocrmypdf/);
    expect(worker).toContain("tesseract-ocr"); // the engine (provides `tesseract`)
    expect(worker).toContain("tesseract-ocr-eng"); // minimal English language data
  });

  it("the worker image installs the proof-only pdftotext tool (poppler-utils)", () => {
    // Phase 27: the OCRmyPDF searchable-PDF proof uses `pdftotext` (poppler-utils) to
    // confirm the synthetic source PDF has no selectable text and the OCRmyPDF output
    // does — i.e. image-only became searchable. It is NOT on the OCR runtime path; it is
    // packaged in the worker image ONLY so that proof can run inside the built image.
    const worker = stageInstructions(stages, "worker");
    expect(worker).toMatch(/apt-get install[\s\S]*poppler-utils/);
  });

  it("the worker image runs the daemon and never the web server", () => {
    const worker = stageInstructions(stages, "worker");
    expect(worker).toContain("worker:daemon");
    expect(worker).not.toContain("next start");
    expect(worker).not.toMatch(/CMD\s*\[\s*"pnpm",\s*"start"\s*\]/);
    // A worker never serves HTTP, so it exposes no port.
    expect(worker).not.toMatch(/^\s*EXPOSE/m);
  });

  it("the worker image owns Corepack/pnpm cache paths before dropping privileges", () => {
    const worker = stageInstructions(stages, "worker");
    expect(worker).toContain("PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false");
    expect(worker).toContain("COREPACK_HOME=/home/worker/.cache/node/corepack");
    expect(worker).toMatch(/useradd[\s\S]*--home-dir\s+\/home\/worker[\s\S]*--create-home[\s\S]*worker/);
    expect(worker).toContain("mkdir -p /home/worker/.cache/node/corepack /pnpm");
    expect(worker).toContain("chown -R worker:worker /home/worker /pnpm /app");
    expect(worker).toMatch(/COPY --from=build --chown=worker:worker[\s\S]*\/app\/node_modules/);
    expect(worker).toMatch(/COPY --from=build --chown=worker:worker[\s\S]*\/app\/src/);
    expect(worker.indexOf("chown -R worker:worker /home/worker /pnpm /app")).toBeLessThan(
      worker.indexOf("USER worker"),
    );
  });

  it("the worker image does not bundle the web build (.next)", () => {
    expect(stageInstructions(stages, "worker")).not.toContain(".next");
  });

  it("the worker HEALTHCHECK is the presence-only readiness probe; the default CMD drains", () => {
    const worker = stageInstructions(stages, "worker");
    // A container health probe must claim nothing — it resolves config and reports
    // drainable/not via `--dry-run-status`, never a processing mode that could
    // fabricate or attempt work. In the worker stage that flag appears only here.
    expect(worker).toMatch(/^\s*HEALTHCHECK\b/m);
    expect(worker).toContain("--dry-run-status");
    // The default command is the long-running drain-then-poll daemon, not the probe.
    expect(worker).toMatch(/CMD\s*\[\s*"pnpm",\s*"worker:daemon"\s*\]\s*$/m);
  });

  it("the web image serves the site and ships no worker daemon or native engines", () => {
    const web = stageInstructions(stages, "web");
    expect(web).toMatch(/CMD\s*\[\s*"pnpm",\s*"start"\s*\]/);
    expect(web).toContain("PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false");
    expect(web).not.toContain("worker:daemon");
    expect(web).not.toContain("apt-get install");
    // Neither the deep-compression engines, the OCR stack, NOR the proof-only pdftotext
    // tool (poppler-utils) belong in the web image.
    expect(web).not.toMatch(/ghostscript|qpdf|mupdf|ocrmypdf|tesseract|poppler|pdftotext/);
  });
});

describe(".dockerignore keeps secrets, prompts, and build output out of the context", () => {
  const patterns = read(".dockerignore")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  it("excludes dependencies, build output, VCS/CI, and internal prompts", () => {
    for (const needed of ["node_modules", ".next", ".git", ".github", ".claude-*.md"]) {
      expect(patterns).toContain(needed);
    }
  });

  it("excludes every secret shape — .env variants and private keys", () => {
    // The load-bearing rule: no secret file may ever reach an image layer. The
    // plain `.env` and the `.env*.local` glob together cover `.env*`.
    for (const needed of [".env", ".env.local", ".env*.local", "*.pem"]) {
      expect(patterns).toContain(needed);
    }
  });

  it("excludes test-only assets and local build artifacts", () => {
    // The web/worker images ship no tests or fixtures, and host-only outputs must
    // not bloat (or leak into) the build context.
    for (const needed of ["**/*.test.ts", "test-results", "e2e", "coverage", "vitest.config.ts"]) {
      expect(patterns).toContain(needed);
    }
  });
});

describe("docker-compose.worker.yml — example wiring, names only", () => {
  const compose = read("docker-compose.worker.yml");

  it("builds both the web and worker targets", () => {
    expect(compose).toMatch(/target:\s*web\b/);
    expect(compose).toMatch(/target:\s*worker\b/);
  });

  it("references the worker's provider variables by name", () => {
    for (const name of [
      "PDFXYZ_STORAGE_PROVIDER",
      "PDFXYZ_S3_BUCKET",
      "PDFXYZ_S3_SECRET_ACCESS_KEY",
      "PDFXYZ_REDIS_REST_URL",
      "PDFXYZ_REDIS_REST_TOKEN",
    ]) {
      expect(compose).toContain(name);
    }
  });

  it("supplies every provider value by interpolation, never inline", () => {
    // Each PDFXYZ_* mapping must be `${...}` (or a non-secret literal like `auto`),
    // so no value is committed. Assert every secret-ish mapping interpolates.
    const secretMappings = compose
      .split("\n")
      .filter((l) => /PDFXYZ_\w*(SECRET|TOKEN|ACCESS_KEY)\w*\s*:/.test(l));
    expect(secretMappings.length).toBeGreaterThan(0);
    for (const line of secretMappings) {
      expect(line).toContain("${");
    }
  });

  it("healthchecks the worker with the presence-only readiness probe", () => {
    expect(compose).toContain("--dry-run-status");
  });
});

describe("worker smoke script is present and honest", () => {
  const script = read("scripts/worker-smoke.sh");

  it("is a shell script that exercises the daemon's honest exit codes", () => {
    expect(script.startsWith("#!")).toBe(true);
    expect(script).toContain("worker:daemon");
    expect(script).toContain("--dry-run-status");
    // The full exit-code contract: clean (0), not-configured (2), usage error (1),
    // and the fail-fast guardrail (4) — so the smoke proves guardrails aren't a no-op.
    expect(script).toMatch(/\bcheck 0\b/);
    expect(script).toMatch(/\bcheck 1\b/);
    expect(script).toMatch(/\bcheck 2\b/);
    expect(script).toMatch(/\bcheck_env 4\b/);
  });

  it("never invokes the bare default (loop) mode, which would run forever", () => {
    // Every assertion passes an explicit flag; a bare `worker:daemon` with no mode
    // is the long-running loop and would block the smoke (and CI) indefinitely.
    const invocations = script
      .split("\n")
      .filter((l) => /^\s*check(_env)?\s+\d/.test(l)); // an actual `check[_env] <exit> …` call
    expect(invocations.length).toBeGreaterThan(0);
    for (const line of invocations) {
      // Drop the quoted label (it also contains `--`) before checking the flags.
      const flags = line.replace(/"[^"]*"/g, "");
      expect(flags, `smoke invocation must pass a mode flag: ${line}`).toMatch(/--\w/);
    }
  });
});

describe("worker IMAGE smoke script proves the engine contract, presence-only", () => {
  const script = read("scripts/worker-image-smoke.sh");
  const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const container = read(".github/workflows/container.yml");

  it("is a shell script wired as `worker:image-smoke` and run by the container workflow", () => {
    expect(script.startsWith("#!")).toBe(true);
    expect(pkg.scripts?.["worker:image-smoke"]).toBe("sh scripts/worker-image-smoke.sh");
    // The image proof only means something if CI actually runs it inside the image.
    expect(container).toMatch(/docker run[\s\S]*?worker:image-smoke/);
  });

  it("verifies the deep-compression AND OCR binaries are installed (presence only)", () => {
    // Presence probes via `command -v` — the deep-compression trio and both OCR engines.
    expect(script).toContain("command -v");
    for (const bin of ["gs", "qpdf", "mutool", "tesseract", "ocrmypdf"]) {
      expect(script, `image smoke must probe for ${bin}`).toContain(bin);
    }
  });

  it("verifies the English OCR language data is present", () => {
    // `--list-langs` + a match on the `eng` line — the minimal traineddata the image ships.
    expect(script).toContain("--list-langs");
    expect(script).toMatch(/\beng\b/);
  });

  it("re-proves daemon honesty and reads OCR/deep readiness presence-only", () => {
    // Native engines present must NOT fake drainability: the probe still exits 2.
    expect(script).toContain("--dry-run-status");
    expect(script).toMatch(/-eq 2\b/);
    // Presence-only readiness is read from the content-free health lines, not a path.
    expect(script).toContain("ocr_health");
    expect(script).toContain("compression_health");
    // Opting into OCR is exercised so an installed engine reports ready in the image.
    expect(script).toContain("PDFXYZ_OCR=on");
  });

  it("only ever runs the daemon in the terminating readiness mode (never the forever loop)", () => {
    const invocations = script
      .split("\n")
      .filter((l) => !/^\s*#/.test(l) && /worker:daemon/.test(l));
    expect(invocations.length).toBeGreaterThan(0);
    for (const line of invocations) {
      expect(line, `image smoke daemon call must be the probe: ${line}`).toMatch(
        /--dry-run-status/,
      );
    }
  });

  it("checks OCR readiness WITHOUT exposing paths (asserts a path-free readout)", () => {
    // The presence-only contract: the health readout must contain no `/` — the script
    // asserts exactly that, so a leaked path fails the smoke instead of passing silently.
    expect(script).toMatch(/grep\s+-q\s+'\/'/);
  });

  it("never echoes an env value or the captured daemon output to its visible output", () => {
    const lines = script.split("\n");
    // No user-facing `echo` may surface a captured-output var or a PDFXYZ_* value.
    const CAPTURED = /\$\{?(out|onout|health|ocr_off|ocr_on|comp_on|PDFXYZ)/;
    for (const line of lines) {
      if (/^\s*echo\b/.test(line)) {
        expect(line, `echo must not surface captured output/env: ${line}`).not.toMatch(CAPTURED);
      }
    }
    // Any printf that references the captured daemon output must consume it via a pipe
    // to grep (pattern-matching), never print it to the visible stream.
    for (const line of lines) {
      if (/\bprintf\b/.test(line) && /\$\{?(out|onout|health)\b/.test(line)) {
        expect(line, `printf of captured output must pipe to grep: ${line}`).toMatch(/\|\s*grep/);
      }
    }
  });

  it("carries no committed secret", () => {
    expect(script).not.toMatch(AWS_KEY);
  });
});

describe("worker ENGINE PREFLIGHT script is present, wired, and opt-in gated", () => {
  // Static half of the preflight's contract; its RUNTIME exit-code behavior (green by
  // default, exit 3 when a required engine is missing) is exercised end-to-end in
  // `worker-engines.test.ts`. This node-free probe is the dependency-light companion of
  // the image smoke — it runs anywhere `command -v` does, with or without Node.
  const script = read("scripts/worker-engines.sh");
  const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const container = read(".github/workflows/container.yml");

  it("is a shell script wired as `worker:engines`", () => {
    expect(script.startsWith("#!")).toBe(true);
    expect(pkg.scripts?.["worker:engines"]).toBe("sh scripts/worker-engines.sh");
  });

  it("probes every deep-compression and OCR engine, presence-only", () => {
    expect(script).toContain("command -v"); // presence, never a resolved path
    for (const bin of ["gs", "qpdf", "mutool", "tesseract", "ocrmypdf"]) {
      expect(script, `preflight must probe for ${bin}`).toContain(bin);
    }
  });

  it("gates its exit code on the documented opt-in require flags only", () => {
    // The require flags it honors are exactly the daemon's engine-family guardrails.
    expect(script).toContain("PDFXYZ_WORKER_REQUIRE_OCR");
    expect(script).toContain("PDFXYZ_WORKER_REQUIRE_DEEP_ENGINE");
    // …and an unmet requirement is a non-zero exit (3), so a require flag is not a no-op.
    expect(script).toMatch(/fail=3\b/);
  });

  it("is a pure local probe — it contacts no provider and processes no document", () => {
    // No network/provider client, and nothing that could touch a real job's bytes.
    expect(script).not.toMatch(/\b(curl|wget|nc|redis|http|https|s3:)/i);
  });

  it("is exercised inside the built worker image by the container workflow", () => {
    // CI runs the preflight INSIDE the image with the production require-flags armed, so
    // the packaged engines must satisfy the exact gates an operator arms in production.
    expect(container).toMatch(/worker:engines/);
    expect(container).toContain("PDFXYZ_WORKER_REQUIRE_OCR");
    expect(container).toContain("PDFXYZ_WORKER_REQUIRE_DEEP_ENGINE");
  });

  it("carries no committed secret", () => {
    expect(script).not.toMatch(AWS_KEY);
  });
});

describe("worker OCRmyPDF searchable-PDF PROOF script is present, wired, and image-only", () => {
  // Static deployment-artifact half of the Phase 27 proof's contract; its full runtime
  // plumbing (prerequisite-missing exit 2, enforced-check exit 3, temp cleanup, and no
  // path/text leak) is exercised Docker-free with stub tools in
  // `worker-ocrmypdf-proof.test.ts`.
  const script = read("scripts/worker-ocrmypdf-proof.sh");
  const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const container = read(".github/workflows/container.yml");
  const worker = stageInstructions(parseStages(read("Dockerfile")), "worker");

  it("is a shell script wired as `worker:ocrmypdf-proof`", () => {
    expect(script.startsWith("#!")).toBe(true);
    expect(pkg.scripts?.["worker:ocrmypdf-proof"]).toBe("sh scripts/worker-ocrmypdf-proof.sh");
  });

  it("builds an IMAGE-ONLY PDF and OCRs it with OCRmyPDF by argv", () => {
    // The source is an image-only PDF (Ghostscript pdfimage device — no text layer) so any
    // extracted text is genuine OCR; OCRmyPDF is invoked by argv (no shell) with a sidecar
    // and a plain-PDF output type, mirroring the native runner's option shape.
    expect(script).toMatch(/-sDEVICE=pdfimage\d+/);
    expect(script).toMatch(/\bocrmypdf\b[^\n]*--sidecar/);
    expect(script).toContain("--output-type pdf");
  });

  it("proves searchability with pdftotext, and the worker image packages it (poppler-utils)", () => {
    // The differential proof runs pdftotext on BOTH the input (image-only ⇒ no sentinel)
    // and the output (searchable ⇒ the sentinel), so the worker image must package it —
    // and it must NOT be on the OCR runtime path (it is proof-only tooling).
    expect(script).toContain("pdftotext");
    expect(worker).toContain("poppler-utils");
  });

  it("is exercised inside the built worker image by the container workflow, after the Tesseract proof", () => {
    // CI runs the conversion proof INSIDE the built image; recognition (image→PDF) is
    // established first, then this PDF→searchable-PDF conversion.
    expect(container).toMatch(/docker run[\s\S]*?worker:ocrmypdf-proof/);
    expect(container.indexOf("worker:ocr-proof")).toBeLessThan(
      container.indexOf("worker:ocrmypdf-proof"),
    );
  });

  it("carries no committed secret", () => {
    expect(script).not.toMatch(AWS_KEY);
  });
});

// --------------------------------------------------------------------------- //
// Secret hygiene — no committed artifact may carry a real-looking credential.
// --------------------------------------------------------------------------- //
const CONFIG_FILES = ["Dockerfile", "docker-compose.worker.yml", ".env.worker.example"];
const DOC_FILES = [
  "docs/DEPLOYMENT.md",
  "docs/WORKER_ARCHITECTURE.md",
  "docs/RUNBOOK.md",
  "docs/OCR_BACKEND.md",
];

/** AWS-style access-key ids — a hard fail wherever they appear. */
const AWS_KEY = /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[A-Z0-9]{16}\b/;

/** A value is safe-by-inspection when it is empty, an interpolation, or a placeholder. */
const PLACEHOLDER =
  /(REPLACE|EXAMPLE|CHANGE|CHANGEME|YOUR[-_]|PLACEHOLDER|\bXXX+\b|<[^>]+>|\.\.\.|\.invalid\b)/i;

/** Variable names whose committed value must be a placeholder/reference/empty. */
const SECRETISH = /(SECRET|TOKEN|PASSWORD|ACCESS_KEY_ID|ACCESS_KEY|PRIVATE_KEY|_KEY)$/i;

/** Drop `#` comments (whole-line and inline) so doc text can safely name a rule. */
function stripHashComments(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, "$1"))
    .join("\n");
}

/** Extract `NAME=value` / `NAME: value` (env, compose, Dockerfile ENV/ARG) assignments. */
function assignments(text: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^\s*#.*$/, ""); // drop full-line comments
    if (!line.trim()) continue;
    const m = /^\s*(?:-\s*)?(?:ENV\s+|ARG\s+)?([A-Z][A-Z0-9_]+)\s*[:=]\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2]!
      .replace(/\s+#.*$/, "") // drop trailing inline comment
      .replace(/^["']|["']$/g, "") // unquote
      .trim();
    out.push({ name: m[1]!, value });
  }
  return out;
}

describe("deployment artifacts carry no real-looking secrets", () => {
  for (const rel of CONFIG_FILES) {
    it(`${rel}: no AWS keys; every secret var is a placeholder or interpolation`, () => {
      const text = read(rel);
      expect(text).not.toMatch(AWS_KEY);
      for (const { name, value } of assignments(text)) {
        if (!SECRETISH.test(name)) continue;
        const safe = value === "" || value.includes("${") || PLACEHOLDER.test(value);
        expect(safe, `${rel}: ${name} looks like a committed secret ("${value}")`).toBe(true);
      }
    });

    it(`${rel}: exposes no server-only provider secret via NEXT_PUBLIC_`, () => {
      // A comment MAY state the "never NEXT_PUBLIC_" rule; no instruction may set one.
      expect(stripHashComments(read(rel))).not.toContain("NEXT_PUBLIC_");
    });
  }

  for (const rel of DOC_FILES) {
    it(`${rel}: documents provider variables without embedding AWS keys`, () => {
      if (!existsSync(path.join(ROOT, rel))) return;
      expect(read(rel)).not.toMatch(AWS_KEY);
    });
  }
});

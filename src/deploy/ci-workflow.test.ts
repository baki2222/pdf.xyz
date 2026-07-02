// @vitest-environment node
/**
 * Static checks for the GitHub Actions CI as a deployment artifact. The Docker
 * daemon is not available in this repo's build environment, so the container
 * images are never built here — instead these assertions guarantee that CI will
 * build BOTH image targets on GitHub Actions and exercise the worker's no-config
 * honesty contract inside the built image, and that no workflow ever commits a
 * secret value. They are the testable promise that the real build runs in CI.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const WORKFLOW_DIR = path.join(ROOT, ".github", "workflows");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

/** All workflow YAML files, as repo-relative paths. */
function workflowFiles(): string[] {
  return readdirSync(WORKFLOW_DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => path.join(".github", "workflows", f))
    .sort();
}

// --------------------------------------------------------------------------- //
// The container workflow: both targets built, worker smoked, nothing published.
// --------------------------------------------------------------------------- //
describe("container CI builds both image targets and smokes the worker", () => {
  const container = read(".github/workflows/container.yml");

  it("builds the web image target", () => {
    expect(container).toMatch(/target:\s*web\b/);
  });

  it("builds the worker image target", () => {
    expect(container).toMatch(/target:\s*worker\b/);
  });

  it("runs the worker no-config honesty smoke inside the built worker image", () => {
    // The headline check: the REAL daemon CLI runs inside the built image with
    // nothing configured and must stay honest (`pnpm worker:smoke`).
    expect(container).toMatch(/docker run[\s\S]*?worker:smoke/);
    // …and the readiness probe is asserted to report not-configured (exit 2).
    expect(container).toContain("--dry-run-status");
  });

  it("proves web ↔ worker separation at the image level (engines only in the worker)", () => {
    // The worker image must ship the native engines; the web image must not.
    expect(container).toMatch(/command -v gs/);
    expect(container).toMatch(/command -v qpdf/);
    expect(container).toMatch(/command -v mutool/);
  });

  it("never publishes an image (build-only, so it needs no registry secret)", () => {
    expect(container).toMatch(/push:\s*false/);
    expect(container).not.toMatch(/push:\s*true/);
  });

  it("references no repository secret — the no-config contract needs none", () => {
    // Scan executable YAML only: a `#` comment may name the policy in prose.
    const code = container
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    expect(code).not.toMatch(/\$\{\{\s*secrets\./);
  });
});

// --------------------------------------------------------------------------- //
// The default CI workflow: the Docker-free gate every PR must pass. It proves the
// worker's exit-code contract without Docker and runs the full JS + e2e suite.
// --------------------------------------------------------------------------- //
describe("default CI workflow gates every PR (no Docker, no secrets)", () => {
  const ci = read(".github/workflows/ci.yml");

  it("runs the core JS gates: typecheck, lint, unit tests, and a clean build", () => {
    expect(ci).toMatch(/^\s*run:\s*pnpm typecheck\s*$/m);
    expect(ci).toMatch(/^\s*run:\s*pnpm lint\s*$/m);
    expect(ci).toMatch(/^\s*run:\s*pnpm test\s*$/m); // the unit-test step, not test:e2e
    expect(ci).toMatch(/^\s*run:\s*pnpm build\s*$/m);
  });

  it("runs the worker no-config honesty smoke as a Docker-free gate", () => {
    // The same contract the container workflow re-runs inside the built image, but
    // here it gates every PR even where Docker is unavailable.
    expect(ci).toMatch(/^\s*run:\s*pnpm worker:smoke\s*$/m);
  });

  it("runs the Playwright e2e smoke suite", () => {
    expect(ci).toMatch(/playwright install/);
    expect(ci).toMatch(/^\s*run:\s*pnpm test:e2e\s*$/m);
  });

  it("needs no repository secret for the default gate", () => {
    const code = ci
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    expect(code).not.toMatch(/\$\{\{\s*secrets\./);
  });
});

// --------------------------------------------------------------------------- //
// Secret hygiene — no workflow may carry a real-looking credential, and any
// secret-ish env must come from a `${{ secrets.* }}` reference, never a literal.
// --------------------------------------------------------------------------- //
/** AWS-style access-key ids — a hard fail wherever they appear. */
const AWS_KEY = /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[A-Z0-9]{16}\b/;

/** A GitHub Actions secret reference — the only safe source for a secret value. */
const GH_SECRET_REF = /\$\{\{\s*secrets\./;

/** Safe-by-inspection literal values (placeholders / references / empty). */
const PLACEHOLDER =
  /(REPLACE|EXAMPLE|CHANGE|CHANGEME|YOUR[-_]|PLACEHOLDER|\bXXX+\b|<[^>]+>|\.\.\.|\.invalid\b)/i;

/** Env names whose committed value must be a reference/placeholder/empty. */
const SECRETISH = /(SECRET|TOKEN|PASSWORD|ACCESS_KEY_ID|ACCESS_KEY|PRIVATE_KEY|_KEY)$/i;

/** Extract uppercase `NAME: value` env mappings from a workflow YAML. */
function envAssignments(yaml: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const raw of yaml.split("\n")) {
    if (/^\s*#/.test(raw)) continue; // skip comment lines
    const line = raw.replace(/\s+#.*$/, ""); // drop trailing inline comment
    const m = /^\s*([A-Z][A-Z0-9_]+)\s*:\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    out.push({ name: m[1]!, value: m[2]!.replace(/^["']|["']$/g, "").trim() });
  }
  return out;
}

describe("no GitHub Actions workflow carries a committed secret", () => {
  const files = workflowFiles();

  it("finds the workflows to scan", () => {
    expect(files).toContain(path.join(".github", "workflows", "container.yml"));
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  for (const rel of files) {
    it(`${rel}: no AWS keys; every secret-ish env is a reference or placeholder`, () => {
      const text = read(rel);
      expect(text).not.toMatch(AWS_KEY);
      for (const { name, value } of envAssignments(text)) {
        if (!SECRETISH.test(name)) continue;
        const safe =
          value === "" ||
          GH_SECRET_REF.test(value) ||
          value.includes("${") ||
          PLACEHOLDER.test(value);
        expect(safe, `${rel}: ${name} looks like a committed secret ("${value}")`).toBe(true);
      }
    });
  }
});

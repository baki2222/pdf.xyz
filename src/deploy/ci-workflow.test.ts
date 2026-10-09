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
const read = (rel: string): string =>
  readFileSync(path.join(ROOT, rel), "utf8");

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

  it("runs the native-engine + OCR image smoke inside the built worker image", () => {
    // Phase 24: the second in-image smoke proves the worker image actually contains
    // the deep-compression + OCR engine stack it advertises and reads OCR readiness
    // presence-only — run inside the built image, no cloud, no secret.
    expect(container).toMatch(/docker run[\s\S]*?worker:image-smoke/);
  });

  it("runs the deterministic OCR recognition proof inside the built worker image", () => {
    // Phase 25: after presence is established, the proof generates a synthetic raster
    // of a known sentinel and recognizes it with the packaged Tesseract baseline —
    // real recognition end-to-end, no user document, no cloud, no secret.
    expect(container).toMatch(/docker run[\s\S]*?worker:ocr-proof/);
  });

  it("runs the engine presence preflight before the OCR recognition proof", () => {
    // The presence smoke (`worker:engines`) must appear before the behavior proof
    // (`worker:ocr-proof`) — you establish the engines exist, then prove they work.
    expect(container.indexOf("worker:engines")).toBeLessThan(
      container.indexOf("worker:ocr-proof"),
    );
  });

  it("runs the OCRmyPDF searchable-PDF proof inside the built worker image", () => {
    // Phase 27: the PDF→searchable-PDF proof turns a synthetic IMAGE-ONLY PDF into a
    // searchable one with the packaged OCRmyPDF and confirms searchability with pdftotext
    // — run inside the built image, no user document, no cloud, no secret.
    expect(container).toMatch(/docker run[\s\S]*?worker:ocrmypdf-proof/);
  });

  it("runs the OCRmyPDF conversion proof after the Tesseract recognition proof", () => {
    // Recognition (image→PDF, `worker:ocr-proof`) is proven first; then the PDF→PDF
    // conversion (`worker:ocrmypdf-proof`) — the two proofs build on each other in order.
    expect(container.indexOf("worker:ocr-proof")).toBeLessThan(
      container.indexOf("worker:ocrmypdf-proof"),
    );
  });

  it("proves web ↔ worker separation at the image level (engines only in the worker)", () => {
    // The worker image must ship the native deep-compression AND OCR engines; the web
    // image must ship none of them.
    expect(container).toMatch(/command -v gs/);
    expect(container).toMatch(/command -v qpdf/);
    expect(container).toMatch(/command -v mutool/);
    expect(container).toMatch(/command -v tesseract/);
    expect(container).toMatch(/command -v ocrmypdf/);
    // …and the proof-only pdftotext tool ships in the worker image but not the web one.
    expect(container).toMatch(/command -v pdftotext/);
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
// The publish workflow's deploy step: after pushing, the same run must make
// something RUN the images — and must not trust Coolify's 200, which means
// "queued". These pins exist because the property they guard was LOST once
// already: the Vercel exit on 2026-08-24 silently ended auto-deploy for both
// tiers, and nothing red appeared anywhere.
// --------------------------------------------------------------------------- //
describe("publish workflow deploys what it pushed, and verifies at the wire", () => {
  const publish = read(".github/workflows/publish.yml");

  it("gates the deploy exactly like the push — main only, and both exist", () => {
    // A branch dispatch must validate the pipeline without touching
    // production; count the gates rather than trusting step prose.
    const gates = publish.match(/if:\s*github\.ref == 'refs\/heads\/main'/g);
    expect(publish).toContain("Push both images");
    expect(publish).toContain("Deploy both tiers");
    expect(gates?.length).toBe(2);
  });

  it("the worker rides the Service restart endpoint with latest=true — never the generic /deploy", () => {
    // The generic /deploy on a compose Service calls StartService without
    // pullLatestImages (Coolify 4.3.10, DeployController.php:571): it answers
    // 200 while restarting the OLD image. The restart endpoint with
    // latest=true is the one that pulls (verified by a docker `image pull`
    // event on the worker host, 2026-08-25).
    const restart = publish.match(
      /\/api\/v1\/services\/([a-z0-9]+)\/restart\?latest=true/,
    );
    expect(restart, "worker restart?latest=true call is missing").toBeTruthy();
    const workerUuid = restart![1]!;
    expect(publish).not.toMatch(new RegExp(`/deploy\\?uuid=${workerUuid}`));
  });

  it("reads expected identities from the built images, never the checkout", () => {
    // The image tree is the .dockerignore-filtered one; a checkout-computed
    // fingerprint measures a different set (measured: they differ).
    expect(publish).toMatch(/docker run [^\n]*cat \.next\/BUILD_ID/);
    expect(publish).toMatch(/build-fingerprint/);
  });

  it("holds until the wire serves both identities, and fails loudly otherwise", () => {
    // Equality against served values — not "the deploy API said 200", and not
    // "the value changed" (a full-cache rebuild legitimately changes nothing).
    expect(publish).toMatch(
      /_next\/static\/\$\{WEB_BUILD_ID\}\/_buildManifest\.js/,
    );
    expect(publish).toMatch(/Running build \$\{WORKER_FP\}/);
    expect(publish).toMatch(/::error::deploy did not reach the wire/);
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
const SECRETISH =
  /(SECRET|TOKEN|PASSWORD|ACCESS_KEY_ID|ACCESS_KEY|PRIVATE_KEY|_KEY)$/i;

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
        expect(
          safe,
          `${rel}: ${name} looks like a committed secret ("${value}")`,
        ).toBe(true);
      }
    });
  }
});

/*
 * Two loaded images do not fit beside ubuntu-latest's preinstalled
 * toolchains. On 2026-10-09 publish.yml died loading the worker image ("no
 * space left on device") once the worker gained the fonts its Office
 * conversions draw in; container.yml's identical build had just fit on the
 * PR. The set is DERIVED: every workflow that builds an image with
 * `load: true` must free the runner disk before its FIRST such build.
 */
describe("image-loading workflows free the runner disk before building", () => {
  /** Index of the first `load: true` build and of the disk-freeing step. */
  const positions = (yaml: string) => ({
    firstLoad: yaml.search(/^\s*load:\s*true\s*$/m),
    freeDisk: yaml.search(/sudo rm -rf [^\n]*\/usr\/local\/lib\/android/),
  });
  const loaders = workflowFiles().filter(
    (rel) => positions(read(rel)).firstLoad !== -1,
  );

  it("finds the image-loading workflows (health check)", () => {
    expect(loaders).toContain(path.join(".github", "workflows", "publish.yml"));
    expect(loaders).toContain(
      path.join(".github", "workflows", "container.yml"),
    );
  });

  for (const rel of loaders) {
    it(`${rel}: frees disk before its first loaded image build`, () => {
      const { firstLoad, freeDisk } = positions(read(rel));
      expect(freeDisk, "no disk-freeing step").toBeGreaterThan(-1);
      expect(freeDisk).toBeLessThan(firstLoad);
    });
  }

  it("positive control: the same file without the step fails", () => {
    const yaml = read(".github/workflows/publish.yml").replace(
      /sudo rm -rf [^\n]*\/usr\/local\/lib\/android[^\n]*\n/,
      "",
    );
    expect(positions(yaml).freeDisk).toBe(-1);
    expect(positions(yaml).firstLoad).toBeGreaterThan(-1);
  });
});

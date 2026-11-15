// @vitest-environment node
/**
 * `scripts/healthcheck-budget.mjs` — the container CI step that times the
 * worker HEALTHCHECK in the built image — derives its bound, its probe and
 * its cache writer from the Dockerfile and compose file, and refuses a
 * timing that is not of the path it names. Docker is not available here, so
 * the image run itself is CI's; everything up to it is pinned below, and the
 * in-container script runs through a real `sh` with a stand-in probe.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUDGET_FRACTION,
  composeTimeoutsMs,
  containerScript,
  judge,
  parseDuration,
  parseRun,
  planHealthcheckProbe,
  workerStage,
} from "../../scripts/healthcheck-budget.mjs";

const read = (rel: string) =>
  readFileSync(path.join(process.cwd(), rel), "utf8");
const DOCKERFILE = read("Dockerfile");
const COMPOSE = read("docker-compose.worker.yml");

/** A minimal two-stage Dockerfile; only the worker stage's HEALTHCHECK counts. */
const fixture = (hc: string, cmd = 'CMD ["pnpm", "worker:daemon"]') =>
  [
    "FROM node:22-slim AS base",
    "FROM base AS web",
    'HEALTHCHECK --timeout=1s CMD ["true"]',
    'CMD ["next", "start"]',
    "FROM base AS worker",
    "# a comment",
    hc,
    cmd,
  ].join("\n");
const HC =
  'HEALTHCHECK --interval=1m --timeout=45s --retries=3 \\\n  CMD ["pnpm", "worker:daemon", "--dry-run-status"]';

describe("the bound is read from the files, never typed", () => {
  it("matches an independent read of the real Dockerfile's worker HEALTHCHECK", () => {
    const plan = planHealthcheckProbe(DOCKERFILE, COMPOSE);
    // Second derivation, deliberately cruder: the text after the worker
    // stage's FROM, its first --timeout=Ns.
    const worker = DOCKERFILE.slice(DOCKERFILE.search(/^FROM .* AS worker/m));
    const secs = Number(/--timeout=(\d+)s/.exec(worker)?.[1]);
    expect(secs).toBeGreaterThan(0);
    expect(plan.timeouts.dockerfileMs).toBe(secs * 1000);
    expect(plan.timeoutMs).toBeLessThanOrEqual(secs * 1000);
    expect(plan.budgetMs).toBe(Math.floor(plan.timeoutMs * BUDGET_FRACTION));
    // The probe timed IS the healthcheck's command; the writer is the CMD.
    expect(plan.probe).toContain("--dry-run-status");
    expect(plan.daemon).toEqual(
      JSON.parse(
        /^CMD (\[.*\])\s*$/m.exec(worker.split("\n").reverse().join("\n"))![1]!,
      ),
    );
    // Compose's healthcheck runs the same probe and is counted.
    expect(plan.timeouts.composeMs.length).toBe(1);
  });

  it("moves with the Dockerfile (positive control on a changed timeout)", () => {
    const plan = planHealthcheckProbe(fixture(HC), "");
    expect(plan.timeoutMs).toBe(45_000);
    expect(plan.budgetMs).toBe(30_000);
    expect(plan.daemon).toEqual(["pnpm", "worker:daemon"]);
  });

  it("takes the smallest timeout of every healthcheck that runs the probe", () => {
    const compose = [
      "services:",
      "  worker:",
      "    healthcheck:",
      '      test: ["CMD", "pnpm", "worker:daemon", "--dry-run-status"]',
      "      timeout: 12s",
      "  other:",
      "    healthcheck:",
      '      test: ["CMD", "true"]',
      "      timeout: 1s",
    ].join("\n");
    expect(composeTimeoutsMs(compose, "--dry-run-status")).toEqual([12_000]);
    expect(planHealthcheckProbe(fixture(HC), compose).timeoutMs).toBe(12_000);
  });

  it("a broken link is FATAL, never a default", () => {
    expect(() =>
      workerStage(fixture('HEALTHCHECK CMD ["pnpm", "x", "--dry-run-status"]')),
    ).toThrow(/no --timeout/);
    expect(() =>
      workerStage(
        fixture("HEALTHCHECK --timeout=30s CMD pnpm x --dry-run-status"),
      ),
    ).toThrow(/exec-form/);
    expect(() => workerStage(fixture(HC, ""))).toThrow(/no CMD/);
    expect(() => workerStage(fixture(`${HC}\n${HC}`))).toThrow(
      /2 HEALTHCHECKs/,
    );
    expect(() =>
      workerStage(DOCKERFILE.replace(/ AS worker/, " AS wrk")),
    ).toThrow(/no "worker" stage/);
    const noTimeout =
      '  w:\n    healthcheck:\n      test: ["CMD", "--dry-run-status"]\n';
    expect(() => composeTimeoutsMs(noTimeout, "--dry-run-status")).toThrow(
      /no timeout/,
    );
  });

  it("parses Docker durations and nothing else", () => {
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("1m30s")).toBe(90_000);
    expect(parseDuration("500ms")).toBe(500);
    for (const bad of ["", "30", "30x", "s", "0s", "1m 30s"])
      expect(() => parseDuration(bad), bad).toThrow();
  });
});

describe("a timing must be of the path it names", () => {
  const plan = planHealthcheckProbe(fixture(HC), "");
  const ok = { ms: 2_000, exit: 2, source: "none" };
  const warm = { ms: 2_000, exit: 2, source: "cache" };

  it("passes inside the budget with the right sources", () => {
    expect(judge(plan, ok, warm)).toEqual([]);
  });

  it("fails over the budget", () => {
    expect(judge(plan, ok, { ...warm, ms: plan.budgetMs + 1 })).toHaveLength(1);
    expect(judge(plan, ok, { ...warm, ms: plan.budgetMs })).toEqual([]);
    expect(judge(plan, { ...ok, ms: plan.budgetMs + 1 }, warm)).toHaveLength(1);
  });

  it("fails a warm run that read no cache, and a run with no timing", () => {
    expect(judge(plan, ok, { ...warm, source: "none" })[0]).toMatch(
      /not "cache"/,
    );
    expect(judge(plan, { ...ok, source: "cache" }, warm)[0]).toMatch(
      /not "none"/,
    );
    expect(judge(plan, ok, { ...warm, ms: null })[0]).toMatch(/no timing/);
  });

  it("the in-container script times the probe and reports its source (real sh)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pdfxyz-hc-"));
    try {
      // A stand-in probe that prints the line the daemon prints. The writer
      // runs first in the warm script, the probe second.
      const stand = (source: string) => [
        "sh",
        "-c",
        `sleep 0.2; echo '{"src":"daemon","event":"heartbeat_proofs","source":"${source}"}'; exit 2`,
      ];
      const script = containerScript(
        { ...plan, probe: stand("cache"), daemon: stand("proved") },
        true,
      );
      const r = spawnSync("sh", ["-c", script], {
        encoding: "utf8",
        cwd: dir,
      });
      const run = parseRun(r.stdout);
      expect(run.source).toBe("cache");
      expect(run.exit).toBe(2);
      expect(run.ms).toBeGreaterThanOrEqual(150);
      expect(r.stdout).toMatch(/writer: .*"proved"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("container CI runs it against the image it built", () => {
  const container = read(".github/workflows/container.yml");
  const steps = container.split(/\n(?=\s+- name: )/);
  const step = steps.find((s) => s.includes("scripts/healthcheck-budget.mjs"));

  it("has the step, on the worker image tag the build step produced", () => {
    expect(step).toBeDefined();
    const build = steps.find((s) => /target:\s*worker\b/.test(s));
    const tag = /tags:\s*(\S+)/.exec(build ?? "")?.[1];
    expect(tag).toMatch(/^pdfxyz-worker:/);
    expect(step).toContain(
      `node scripts/healthcheck-budget.mjs --image ${tag}`,
    );
    expect(container.indexOf(build!)).toBeLessThan(container.indexOf(step!));
  });

  it("types no bound of its own — the script reads the Dockerfile", () => {
    const run = step!.slice(step!.indexOf("run:"));
    expect(run).not.toMatch(/\d+\s*(ms|s)\b|timeout|20000|30000/i);
  });
});

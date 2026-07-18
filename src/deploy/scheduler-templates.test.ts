// @vitest-environment node
/**
 * Static tests for Phase 32 scheduler/systemd/Kubernetes/CI deployment examples.
 * These tests intentionally do not run Docker, kubectl, systemd, cron, or GitHub
 * Actions. They pin the committed blueprints' safety and command semantics offline.
 */
import { runWorkerCliSync } from "@/tests/run-worker-cli";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DIR = "docs/examples/deployment";
const read = (rel: string): string =>
  readFileSync(path.join(ROOT, rel), "utf8");

const files = [
  `${DIR}/systemd/pdfxyz-worker-daemon.service`,
  `${DIR}/kubernetes/namespace.yaml`,
  `${DIR}/kubernetes/configmap.yaml`,
  `${DIR}/kubernetes/secret.example.yaml`,
  `${DIR}/kubernetes/web-deployment.yaml`,
  `${DIR}/kubernetes/worker-deployment.yaml`,
  `${DIR}/kubernetes/ops-check-cronjob.yaml`,
  `${DIR}/github-actions/ops-check-fixture.yml`,
  `${DIR}/scheduler/ops-check-notify.sh`,
  `${DIR}/scheduler/pdfxyz-ops-check.service`,
  `${DIR}/scheduler/pdfxyz-ops-check.timer`,
];

function noTabs(text: string): void {
  expect(text).not.toContain("\t");
}

function expectNoSecrets(text: string): void {
  expect(text).not.toMatch(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/);
  expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{20,}/);
  expect(text).not.toMatch(/https:\/\/[^\s<>]*:[^\s<>@]+@/);
  expect(text).not.toMatch(/NEXT_PUBLIC_.*(?:SECRET|TOKEN|PASSWORD|KEY)/i);
  expect(text).not.toMatch(
    /(?:amazonaws\.com|\.upstash\.io|\.r2\.cloudflarestorage\.com|googleapis\.com|\.blob\.core\.windows\.net)/i,
  );
}

describe("deployment example templates — privacy and static syntax", () => {
  it("keeps every scheduler/deploy example tab-free and secret-free", () => {
    for (const rel of files) {
      const text = read(rel);
      noTabs(text);
      expectNoSecrets(text);
    }
  });

  it("validates through the repo's deployment example validator", () => {
    const out = runWorkerCliSync(["-s", "deploy:examples:check"], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(out).toContain("deployment examples:");
    expect(out).toContain("validated");
  });
});

describe("systemd examples", () => {
  it("defines a hardened worker daemon service that runs the daemon directly", () => {
    const unit = read(`${DIR}/systemd/pdfxyz-worker-daemon.service`);
    expect(unit).toContain("ExecStart=/usr/bin/env pnpm -s worker:daemon");
    expect(unit).toContain("EnvironmentFile=/etc/pdfxyz/worker.env");
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("NoNewPrivileges=true");
    expect(unit).toContain("ProtectSystem=strict");
    expect(unit).toContain("PrivateTmp=true");
    expect(unit).not.toMatch(/worker:ops-check/);
  });

  it("keeps the ops-check timer persistent and separate from the daemon", () => {
    const svc = read(`${DIR}/scheduler/pdfxyz-ops-check.service`);
    const timer = read(`${DIR}/scheduler/pdfxyz-ops-check.timer`);
    expect(svc).toContain("Type=oneshot");
    expect(svc).toContain("PDFXYZ_OPSCHECK_SOURCE=--runtime");
    expect(svc).toContain("ops-check-notify.sh");
    expect(timer).toContain("OnUnitActiveSec=5min");
    expect(timer).toContain("Persistent=true");
  });
});

describe("Kubernetes examples", () => {
  it("separates public web from private worker and secret-bearing env", () => {
    const web = read(`${DIR}/kubernetes/web-deployment.yaml`);
    const worker = read(`${DIR}/kubernetes/worker-deployment.yaml`);
    expect(web).toContain("kind: Deployment");
    expect(web).toContain("name: pdfxyz-web");
    expect(web).toContain("kind: Service");
    expect(web).not.toContain("secretRef:");
    expect(web).not.toMatch(/PDFXYZ_(S3|REDIS|MALWARE|WORKER_HEARTBEAT)/);

    expect(worker).toContain("name: pdfxyz-worker");
    expect(worker).toContain('command: ["pnpm", "-s", "worker:daemon"]');
    expect(worker).toContain("secretRef:");
    expect(worker).toContain(
      'command: ["pnpm", "-s", "worker:daemon", "--dry-run-status"]',
    );
    expect(worker).not.toContain("kind: Service");
  });

  it("defines placeholder-only secrets and heartbeat config", () => {
    const secret = read(`${DIR}/kubernetes/secret.example.yaml`);
    const config = read(`${DIR}/kubernetes/configmap.yaml`);
    expect(secret).toContain("kind: Secret");
    expect(secret).toContain("REPLACE_WITH_SECRET_ACCESS_KEY");
    expect(secret).toContain("REPLACE_WITH_REDIS_REST_TOKEN");
    expect(config).toContain('PDFXYZ_WORKER_HEARTBEAT: "true"');
    expect(config).toContain("PDFXYZ_OPSCHECK_SOURCE: --runtime");
  });

  it("runs ops-check from a CronJob without masking failures", () => {
    const cron = read(`${DIR}/kubernetes/ops-check-cronjob.yaml`);
    expect(cron).toContain("kind: CronJob");
    expect(cron).toContain('schedule: "*/5 * * * *"');
    expect(cron).toContain(
      'command: ["pnpm", "-s", "worker:ops-check", "--runtime", "--json"]',
    );
    expect(cron).toContain("backoffLimit: 0");
    expect(cron).not.toMatch(/\|\|\s*true/);
    expect(cron).not.toMatch(/exit\s+0/);
  });
});

describe("GitHub Actions ops-check fixture gate", () => {
  it("checks healthy, warn, and critical fixtures without requiring real credentials", () => {
    const workflow = read(`${DIR}/github-actions/ops-check-fixture.yml`);
    expect(workflow).toContain(
      "worker:ops-check --file=docs/examples/observability/healthcheck/healthy.json",
    );
    expect(workflow).toContain(
      "worker:ops-check --file=docs/examples/observability/healthcheck/stale-heartbeat.json",
    );
    expect(workflow).toContain('test "$code" -eq 3');
    expect(workflow).toContain(
      "worker:ops-check --file=docs/examples/observability/healthcheck/lifecycle-drift.json",
    );
    expect(workflow).toContain('test "$code" -eq 4');
    expect(workflow).not.toMatch(/secrets\./i);
  });
});

describe("Phase 44 cleanup evidence pipeline examples", () => {
  const notify = `${DIR}/cleanup/cleanup-pipeline-notify.sh`;
  const fixture = `${DIR}/github-actions/cleanup-pipeline-fixture.yml`;

  it("keeps the pipeline notifier and CI fixture tab-free and secret-free", () => {
    for (const rel of [notify, fixture]) {
      const text = read(rel);
      noTabs(text);
      expectNoSecrets(text);
    }
  });

  it("the notifier runs the one composite command and re-raises its exit code (fail closed)", () => {
    const text = read(notify);
    expect(text).toContain("worker:cleanup-pipeline");
    // It must NOT run `set -e` as a command (that would abort before the non-zero code can be
    // read), but MUST re-raise. Anchor to a command line so the explanatory comment does not count.
    expect(text).toMatch(/^set -u$/m);
    expect(text).not.toMatch(/^\s*set -e/m);
    expect(text).toContain('exit "$code"');
    // A usage (1) is surfaced but explicitly not a cleanup incident; a breach (4) is critical.
    expect(text).toMatch(/1\)\s*severity="usage"/);
    expect(text).toMatch(/4\)\s*severity="breach"/);
  });

  it("the CI fixture pins the documented composite exit codes and needs no credentials", () => {
    const text = read(fixture);
    expect(text).toContain(
      "worker:cleanup-pipeline --file=docs/examples/cleanup-project/raw-unsafe-tombstoned.json",
    );
    expect(text).toContain('test "$code" -eq 4'); // present-tombstoned → breach
    expect(text).toContain('test "$code" -eq 2'); // no wired backend → unknown
    expect(text).toContain('test "$code" -eq 1'); // malformed → usage, fail closed
    expect(text).not.toMatch(/secrets\./i);
  });
});

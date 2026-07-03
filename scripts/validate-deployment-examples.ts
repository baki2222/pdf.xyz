#!/usr/bin/env tsx
/**
 * Static validator for Phase 32 deployment blueprints.
 *
 * This intentionally does NOT talk to Docker, Kubernetes, Redis, S3, ClamAV, or a pager.
 * It validates committed example text for structure and privacy invariants only.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIR = "docs/examples/deployment";

const FILES = [
  `${DIR}/docker-compose.blueprint.yml`,
  `${DIR}/.env.blueprint.example`,
  `${DIR}/README.md`,
  `${DIR}/reverse-proxy/nginx.conf.example`,
  `${DIR}/scheduler/ops-check-notify.sh`,
  `${DIR}/scheduler/ops-check.cron`,
  `${DIR}/scheduler/pdfxyz-ops-check.service`,
  `${DIR}/scheduler/pdfxyz-ops-check.timer`,
  `${DIR}/systemd/pdfxyz-worker-daemon.service`,
  `${DIR}/kubernetes/namespace.yaml`,
  `${DIR}/kubernetes/configmap.yaml`,
  `${DIR}/kubernetes/secret.example.yaml`,
  `${DIR}/kubernetes/web-deployment.yaml`,
  `${DIR}/kubernetes/worker-deployment.yaml`,
  `${DIR}/kubernetes/ops-check-cronjob.yaml`,
  `${DIR}/github-actions/ops-check-fixture.yml`,
  // Phase 43 — storage-artifact cleanup evidence pipeline (project → verify → dry-run sweep).
  `${DIR}/cleanup/README.md`,
  `${DIR}/cleanup/cleanup-evidence-notify.sh`,
  `${DIR}/kubernetes/cleanup-check-cronjob.yaml`,
  `${DIR}/scheduler/pdfxyz-cleanup-check.service`,
  `${DIR}/scheduler/pdfxyz-cleanup-check.timer`,
  `${DIR}/scheduler/cleanup-check.cron`,
  `${DIR}/github-actions/cleanup-evidence-fixture.yml`,
];

const PLACEHOLDER = /(REPLACE|EXAMPLE|PLACEHOLDER|\.invalid\b|\.local\b)/i;
const SECRET_VALUE = /(AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._-]{20,}|https:\/\/[^\s<>]*:[^\s<>@]+@)/;
const REAL_PROVIDER = /(amazonaws\.com|\.upstash\.io|\.r2\.cloudflarestorage\.com|googleapis\.com|\.blob\.core\.windows\.net|supabase\.co)/i;
const NEXT_PUBLIC_SECRET = /NEXT_PUBLIC_.*(SECRET|TOKEN|PASSWORD|KEY)/i;
const SECRET_ASSIGNMENT = /^\s*([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|ACCESS_KEY)[A-Z0-9_]*)\s*[:=]\s*["']?([^"'\n#]+)["']?/gim;

interface Finding {
  file: string;
  message: string;
}

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function checkFile(rel: string, findings: Finding[]): void {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) {
    findings.push({ file: rel, message: "missing expected blueprint file" });
    return;
  }
  const text = read(rel);
  if (text.includes("\t")) findings.push({ file: rel, message: "tabs are not allowed" });
  if (SECRET_VALUE.test(text)) findings.push({ file: rel, message: "credential-shaped literal found" });
  if (REAL_PROVIDER.test(text)) findings.push({ file: rel, message: "real provider endpoint literal found" });
  if (NEXT_PUBLIC_SECRET.test(text)) findings.push({ file: rel, message: "NEXT_PUBLIC secret-like variable found" });
  let m: RegExpExecArray | null;
  SECRET_ASSIGNMENT.lastIndex = 0;
  while ((m = SECRET_ASSIGNMENT.exec(text))) {
    const value = (m[2] ?? "").trim();
    if (value === "" || value.startsWith("${") || PLACEHOLDER.test(value)) continue;
    findings.push({ file: rel, message: `secret-like assignment ${m[1]} is not placeholder/interpolation` });
  }
}

function requireText(rel: string, pattern: RegExp, message: string, findings: Finding[]): void {
  const text = read(rel);
  if (!pattern.test(text)) findings.push({ file: rel, message });
}

function main(): number {
  const findings: Finding[] = [];
  for (const rel of FILES) checkFile(rel, findings);

  requireText(`${DIR}/kubernetes/ops-check-cronjob.yaml`, /kind:\s*CronJob/, "missing Kubernetes CronJob", findings);
  requireText(`${DIR}/kubernetes/ops-check-cronjob.yaml`, /worker:ops-check["\s,]/, "CronJob must run worker:ops-check", findings);
  requireText(`${DIR}/kubernetes/worker-deployment.yaml`, /worker:daemon["\s,]/, "worker deployment must run worker:daemon", findings);
  requireText(`${DIR}/systemd/pdfxyz-worker-daemon.service`, /ExecStart=.*worker:daemon/, "systemd worker service must run daemon", findings);
  requireText(`${DIR}/scheduler/pdfxyz-ops-check.timer`, /Persistent=true/, "ops-check timer should catch up missed runs", findings);
  requireText(`${DIR}/github-actions/ops-check-fixture.yml`, /worker:ops-check --file=.*healthy\.json/, "GitHub Actions fixture check missing", findings);

  // Phase 43 — the cleanup pipeline templates must run the actual project/verify/sweep commands.
  requireText(`${DIR}/kubernetes/cleanup-check-cronjob.yaml`, /kind:\s*CronJob/, "missing cleanup Kubernetes CronJob", findings);
  requireText(`${DIR}/kubernetes/cleanup-check-cronjob.yaml`, /worker:cleanup-project --target=/, "cleanup CronJob must project the export", findings);
  requireText(`${DIR}/kubernetes/cleanup-check-cronjob.yaml`, /worker:cleanup-check["\s]/, "cleanup CronJob must run worker:cleanup-check", findings);
  requireText(`${DIR}/cleanup/cleanup-evidence-notify.sh`, /worker:cleanup-project/, "cleanup notifier must project the export", findings);
  requireText(`${DIR}/cleanup/cleanup-evidence-notify.sh`, /worker:artifact-cleanup/, "cleanup notifier must run the dry-run sweeper", findings);
  requireText(`${DIR}/scheduler/pdfxyz-cleanup-check.service`, /ExecStart=.*cleanup-evidence-notify\.sh/, "cleanup systemd service must run the notifier", findings);
  requireText(`${DIR}/scheduler/pdfxyz-cleanup-check.timer`, /Persistent=true/, "cleanup timer should catch up missed runs", findings);
  requireText(`${DIR}/github-actions/cleanup-evidence-fixture.yml`, /worker:cleanup-project --target=.*raw-.*\.json/, "cleanup GitHub Actions fixture check missing", findings);

  if (findings.length) {
    for (const f of findings) console.error(`${f.file}: ${f.message}`);
    return 1;
  }
  console.log(`deployment examples: ${FILES.length} files validated`);
  return 0;
}

process.exit(main());

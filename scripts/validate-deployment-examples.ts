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
  // Phase 44 — the one-command cleanup evidence pipeline (project + verify + sweep, rolled up).
  `${DIR}/cleanup/cleanup-pipeline-notify.sh`,
  `${DIR}/github-actions/cleanup-pipeline-fixture.yml`,
  // Phase 45 — the operations evidence bundle (compose ops-check + cleanup-pipeline into one artifact).
  `${DIR}/scheduler/ops-bundle-notify.sh`,
  `${DIR}/scheduler/ops-bundle.cron`,
  `${DIR}/scheduler/pdfxyz-ops-bundle.service`,
  `${DIR}/scheduler/pdfxyz-ops-bundle.timer`,
  `${DIR}/kubernetes/ops-bundle-cronjob.yaml`,
  `${DIR}/github-actions/ops-bundle-fixture.yml`,
  // Phase 46 — the release readiness gate (run the safe checks, fold exit codes into PASS/WARN/FAIL).
  `${DIR}/github-actions/release-gate-fixture.yml`,
  // Phase 47 — the release evidence artifact (archive the gate result + provenance + integrity digest).
  `${DIR}/github-actions/release-artifact-fixture.yml`,
  // Phase 48 — the release evidence index / retention manifest (index + re-verify artifacts over time).
  `${DIR}/github-actions/release-index-fixture.yml`,
  // Phase 49 — the release evidence policy gate (assert bounded operator thresholds; fail closed).
  `${DIR}/github-actions/release-policy-fixture.yml`,
  // Phase 50 — the release evidence CI bundle (compose the whole chain + cross-stage consistency).
  `${DIR}/github-actions/release-ci-bundle-fixture.yml`,
  // Phase 51 — the release evidence audit / diff (compare a baseline vs current bundle; fail on regression).
  `${DIR}/github-actions/release-audit-fixture.yml`,
  // Phase 52 — the release evidence operator report (compose bundle + audit into one operator recommendation).
  `${DIR}/github-actions/release-report-fixture.yml`,
  // Phase 53 — the release evidence trend summary (summarize a bounded history of operator reports).
  `${DIR}/github-actions/release-trend-fixture.yml`,
  // Phase 54 — the release evidence governance bundle (compose trend + latest report / audit for a review).
  `${DIR}/github-actions/release-governance-fixture.yml`,
  // Phase 55 — the release evidence archive pack (index governance + related records for review archival).
  `${DIR}/github-actions/release-archive-fixture.yml`,
  // Phase 56 — the release evidence restore drill (restore an archived pack + records, re-validate + cross-check).
  `${DIR}/github-actions/release-restore-drill-fixture.yml`,
  // Phase 57 — the release evidence publish / handoff pack (compose governance + records into a share-safe manifest).
  `${DIR}/github-actions/release-publish-pack-fixture.yml`,
  // Phase 58 — the release evidence handoff acknowledgement (record a bounded acknowledgement of a publish pack).
  `${DIR}/github-actions/release-handoff-ack-fixture.yml`,
  // Phase 59 — the release decision record ledger (compose a publish pack + acknowledgement into one decision).
  `${DIR}/github-actions/release-decision-record-fixture.yml`,
  // Phase 60 — the release decision ledger index (index a bounded batch of decision records into one review summary).
  `${DIR}/github-actions/release-decision-index-fixture.yml`,
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

  // Phase 44 — the one-command pipeline templates must run the actual composite command and pin
  // its documented exit codes.
  requireText(`${DIR}/cleanup/cleanup-pipeline-notify.sh`, /worker:cleanup-pipeline/, "pipeline notifier must run worker:cleanup-pipeline", findings);
  requireText(`${DIR}/cleanup/cleanup-pipeline-notify.sh`, /exit "\$code"/, "pipeline notifier must re-raise the composite exit code (fail closed)", findings);
  requireText(`${DIR}/github-actions/cleanup-pipeline-fixture.yml`, /worker:cleanup-pipeline --file=.*raw-unsafe-tombstoned\.json/, "pipeline GitHub Actions fixture must run the composite over a fixture", findings);
  requireText(`${DIR}/github-actions/cleanup-pipeline-fixture.yml`, /test "\$code" -eq 4/, "pipeline GitHub Actions fixture must assert the breach exit code", findings);

  // Phase 45 — the ops-bundle templates must run the actual aggregator and pin its exit codes.
  requireText(`${DIR}/kubernetes/ops-bundle-cronjob.yaml`, /kind:\s*CronJob/, "missing ops-bundle Kubernetes CronJob", findings);
  requireText(`${DIR}/kubernetes/ops-bundle-cronjob.yaml`, /worker:ops-bundle["\s]/, "ops-bundle CronJob must run worker:ops-bundle", findings);
  requireText(`${DIR}/scheduler/ops-bundle-notify.sh`, /worker:ops-bundle/, "ops-bundle notifier must run worker:ops-bundle", findings);
  requireText(`${DIR}/scheduler/ops-bundle-notify.sh`, /exit "\$code"/, "ops-bundle notifier must re-raise the composite exit code (fail closed)", findings);
  requireText(`${DIR}/scheduler/pdfxyz-ops-bundle.service`, /ExecStart=.*ops-bundle-notify\.sh/, "ops-bundle systemd service must run the notifier", findings);
  requireText(`${DIR}/scheduler/pdfxyz-ops-bundle.timer`, /Persistent=true/, "ops-bundle timer should catch up missed runs", findings);
  requireText(`${DIR}/github-actions/ops-bundle-fixture.yml`, /worker:ops-bundle --ops-check=.*healthy\.json/, "ops-bundle GitHub Actions fixture must run the aggregator over a fixture", findings);
  requireText(`${DIR}/github-actions/ops-bundle-fixture.yml`, /test "\$code" -eq 4/, "ops-bundle GitHub Actions fixture must assert the breach exit code", findings);

  // Phase 46 — the release-gate template must run the actual gate and pin its documented exits.
  requireText(`${DIR}/github-actions/release-gate-fixture.yml`, /worker:release-gate/, "release-gate GitHub Actions fixture must run worker:release-gate", findings);
  requireText(`${DIR}/github-actions/release-gate-fixture.yml`, /test "\$code" -eq 1/, "release-gate GitHub Actions fixture must assert the usage exit code (fail closed)", findings);

  // Phase 47 — the release-artifact template must run the gate, archive + verify the artifact, and
  // pin the tamper-detection + usage exit codes (fail closed).
  requireText(`${DIR}/github-actions/release-artifact-fixture.yml`, /worker:release-gate/, "release-artifact GitHub Actions fixture must run the gate first", findings);
  requireText(`${DIR}/github-actions/release-artifact-fixture.yml`, /worker:release-artifact --release-gate=.*--output=/, "release-artifact GitHub Actions fixture must archive the gate result to a file", findings);
  requireText(`${DIR}/github-actions/release-artifact-fixture.yml`, /worker:release-artifact --verify=/, "release-artifact GitHub Actions fixture must verify the artifact integrity", findings);
  requireText(`${DIR}/github-actions/release-artifact-fixture.yml`, /test "\$code" -eq 4/, "release-artifact GitHub Actions fixture must assert the tamper (digest mismatch) exit code", findings);
  requireText(`${DIR}/github-actions/release-artifact-fixture.yml`, /test "\$code" -eq 1/, "release-artifact GitHub Actions fixture must assert the usage exit code (fail closed)", findings);

  // Phase 48 — the release-index template must generate an artifact, index + validate it as a CI
  // artifact, and pin the tamper-detection + usage exit codes (fail closed).
  requireText(`${DIR}/github-actions/release-index-fixture.yml`, /worker:release-artifact --release-gate=.*--output=/, "release-index GitHub Actions fixture must archive an artifact first", findings);
  requireText(`${DIR}/github-actions/release-index-fixture.yml`, /worker:release-index --artifact=.*--output=/, "release-index GitHub Actions fixture must build the index as a CI artifact", findings);
  requireText(`${DIR}/github-actions/release-index-fixture.yml`, /test "\$code" -eq 4/, "release-index GitHub Actions fixture must assert the tamper (invalid) exit code", findings);
  requireText(`${DIR}/github-actions/release-index-fixture.yml`, /test "\$code" -eq 1/, "release-index GitHub Actions fixture must assert the usage exit code (fail closed)", findings);

  // Phase 49 — the release-policy template must archive an artifact, index it, evaluate the policy over
  // the index, and pin the blocking-violation + usage exit codes (fail closed).
  requireText(`${DIR}/github-actions/release-policy-fixture.yml`, /worker:release-artifact --release-gate=.*--output=/, "release-policy GitHub Actions fixture must archive an artifact first", findings);
  requireText(`${DIR}/github-actions/release-policy-fixture.yml`, /worker:release-index --artifact=.*--output=/, "release-policy GitHub Actions fixture must build the index first", findings);
  requireText(`${DIR}/github-actions/release-policy-fixture.yml`, /worker:release-policy --index=/, "release-policy GitHub Actions fixture must evaluate the policy over the index", findings);
  requireText(`${DIR}/github-actions/release-policy-fixture.yml`, /test "\$code" -eq 4/, "release-policy GitHub Actions fixture must assert the blocking-violation exit code", findings);
  requireText(`${DIR}/github-actions/release-policy-fixture.yml`, /test "\$code" -eq 1/, "release-policy GitHub Actions fixture must assert the usage exit code (fail closed)", findings);

  // Phase 50 — the release-ci-bundle template must run the whole chain, compose the bundle over all four
  // stage outputs, and pin the cross-stage-inconsistency + usage exit codes (fail closed).
  requireText(`${DIR}/github-actions/release-ci-bundle-fixture.yml`, /worker:release-gate/, "release-ci-bundle GitHub Actions fixture must run the gate first", findings);
  requireText(`${DIR}/github-actions/release-ci-bundle-fixture.yml`, /worker:release-artifact --release-gate=.*--output=/, "release-ci-bundle GitHub Actions fixture must archive an artifact", findings);
  requireText(`${DIR}/github-actions/release-ci-bundle-fixture.yml`, /worker:release-index --artifact=.*--output=/, "release-ci-bundle GitHub Actions fixture must build the index", findings);
  requireText(`${DIR}/github-actions/release-ci-bundle-fixture.yml`, /worker:release-policy --index=.*--output=/, "release-ci-bundle GitHub Actions fixture must evaluate the policy", findings);
  requireText(`${DIR}/github-actions/release-ci-bundle-fixture.yml`, /worker:release-ci-bundle/, "release-ci-bundle GitHub Actions fixture must compose the bundle", findings);
  requireText(`${DIR}/github-actions/release-ci-bundle-fixture.yml`, /--release-gate=gate\.json --release-artifact=artifact\.json/, "release-ci-bundle GitHub Actions fixture must bundle the gate + artifact stage outputs", findings);
  requireText(`${DIR}/github-actions/release-ci-bundle-fixture.yml`, /--release-index=index\.json --release-policy=policy\.json/, "release-ci-bundle GitHub Actions fixture must bundle the index + policy stage outputs", findings);
  requireText(`${DIR}/github-actions/release-ci-bundle-fixture.yml`, /test "\$code" -eq 4/, "release-ci-bundle GitHub Actions fixture must assert the cross-stage-inconsistency exit code", findings);
  requireText(`${DIR}/github-actions/release-ci-bundle-fixture.yml`, /test "\$code" -eq 1/, "release-ci-bundle GitHub Actions fixture must assert the usage exit code (fail closed)", findings);

  // Phase 51 — the release-audit template must build a current bundle, diff it against a baseline bundle,
  // and pin the blocking-regression + usage exit codes (fail closed).
  requireText(`${DIR}/github-actions/release-audit-fixture.yml`, /worker:release-ci-bundle/, "release-audit GitHub Actions fixture must build a current release CI bundle first", findings);
  requireText(`${DIR}/github-actions/release-audit-fixture.yml`, /worker:release-audit/, "release-audit GitHub Actions fixture must run worker:release-audit", findings);
  requireText(`${DIR}/github-actions/release-audit-fixture.yml`, /--baseline=/, "release-audit GitHub Actions fixture must supply a baseline bundle", findings);
  requireText(`${DIR}/github-actions/release-audit-fixture.yml`, /--current=/, "release-audit GitHub Actions fixture must supply a current bundle", findings);
  requireText(`${DIR}/github-actions/release-audit-fixture.yml`, /test "\$code" -eq 4/, "release-audit GitHub Actions fixture must assert the blocking-regression exit code", findings);
  requireText(`${DIR}/github-actions/release-audit-fixture.yml`, /test "\$code" -eq 1/, "release-audit GitHub Actions fixture must assert the usage exit code (fail closed)", findings);

  // Phase 52 — the release-report template must build a current bundle, compose the operator report over the
  // bundle (+ optional audit), and pin the blocking / audit-only-needs-evidence / usage exit codes (fail closed).
  requireText(`${DIR}/github-actions/release-report-fixture.yml`, /worker:release-ci-bundle/, "release-report GitHub Actions fixture must build a current release CI bundle first", findings);
  requireText(`${DIR}/github-actions/release-report-fixture.yml`, /worker:release-report/, "release-report GitHub Actions fixture must run worker:release-report", findings);
  requireText(`${DIR}/github-actions/release-report-fixture.yml`, /--bundle=/, "release-report GitHub Actions fixture must supply a release CI bundle", findings);
  requireText(`${DIR}/github-actions/release-report-fixture.yml`, /test "\$code" -eq 4/, "release-report GitHub Actions fixture must assert the blocking hold-fail exit code", findings);
  requireText(`${DIR}/github-actions/release-report-fixture.yml`, /test "\$code" -eq 2/, "release-report GitHub Actions fixture must assert the audit-only needs-evidence exit code", findings);
  requireText(`${DIR}/github-actions/release-report-fixture.yml`, /test "\$code" -eq 1/, "release-report GitHub Actions fixture must assert the usage exit code (fail closed)", findings);

  // Phase 53 — the release-trend template must build a current report, summarize a bounded report history, and
  // pin the tampered-report / needs-evidence-tip / usage exit codes (fail closed).
  requireText(`${DIR}/github-actions/release-trend-fixture.yml`, /worker:release-report/, "release-trend GitHub Actions fixture must build a current release report first", findings);
  requireText(`${DIR}/github-actions/release-trend-fixture.yml`, /worker:release-trend/, "release-trend GitHub Actions fixture must run worker:release-trend", findings);
  requireText(`${DIR}/github-actions/release-trend-fixture.yml`, /--report=/, "release-trend GitHub Actions fixture must supply a report history", findings);
  requireText(`${DIR}/github-actions/release-trend-fixture.yml`, /test "\$code" -eq 4/, "release-trend GitHub Actions fixture must assert the failing-trend (tamper / hold-fail tip) exit code", findings);
  requireText(`${DIR}/github-actions/release-trend-fixture.yml`, /test "\$code" -eq 2/, "release-trend GitHub Actions fixture must assert the needs-evidence-tip insufficient exit code", findings);
  requireText(`${DIR}/github-actions/release-trend-fixture.yml`, /test "\$code" -eq 1/, "release-trend GitHub Actions fixture must assert the usage exit code (fail closed)", findings);

  // Phase 54 — the release-governance template must build a trend, compose the governance bundle over the trend
  // (+ latest report / audit), and pin the blocked / incomplete / usage exit codes (fail closed).
  requireText(`${DIR}/github-actions/release-governance-fixture.yml`, /worker:release-trend/, "release-governance GitHub Actions fixture must build a release trend first", findings);
  requireText(`${DIR}/github-actions/release-governance-fixture.yml`, /worker:release-governance/, "release-governance GitHub Actions fixture must run worker:release-governance", findings);
  requireText(`${DIR}/github-actions/release-governance-fixture.yml`, /--trend=/, "release-governance GitHub Actions fixture must supply the primary release trend", findings);
  requireText(`${DIR}/github-actions/release-governance-fixture.yml`, /test "\$code" -eq 4/, "release-governance GitHub Actions fixture must assert the blocked (failing trend / tamper / hold-fail) exit code", findings);
  requireText(`${DIR}/github-actions/release-governance-fixture.yml`, /test "\$code" -eq 2/, "release-governance GitHub Actions fixture must assert the incomplete (missing trend) exit code", findings);
  requireText(`${DIR}/github-actions/release-governance-fixture.yml`, /test "\$code" -eq 1/, "release-governance GitHub Actions fixture must assert the usage exit code (fail closed)", findings);

  // Phase 55 — the release-archive template must build/ingest governance + related records, compose the
  // archive manifest, and pin the blocked / incomplete / usage exit codes (fail closed).
  requireText(`${DIR}/github-actions/release-archive-fixture.yml`, /worker:release-governance/, "release-archive GitHub Actions fixture must build or ingest a release governance bundle first", findings);
  requireText(`${DIR}/github-actions/release-archive-fixture.yml`, /worker:release-archive/, "release-archive GitHub Actions fixture must run worker:release-archive", findings);
  requireText(`${DIR}/github-actions/release-archive-fixture.yml`, /--governance=/, "release-archive GitHub Actions fixture must supply the primary release governance bundle", findings);
  requireText(`${DIR}/github-actions/release-archive-fixture.yml`, /test "\$code" -eq 4/, "release-archive GitHub Actions fixture must assert the blocked/tamper exit code", findings);
  requireText(`${DIR}/github-actions/release-archive-fixture.yml`, /test "\$code" -eq 2/, "release-archive GitHub Actions fixture must assert the incomplete evidence exit code", findings);
  requireText(`${DIR}/github-actions/release-archive-fixture.yml`, /test "\$code" -eq 1/, "release-archive GitHub Actions fixture must assert the usage exit code (fail closed)", findings);

  // Phase 56 — the release-restore-drill template must restore an archive pack + records, run the drill over
  // them, and pin the tamper / incomplete / usage exit codes (fail closed).
  requireText(`${DIR}/github-actions/release-restore-drill-fixture.yml`, /worker:release-archive/, "release-restore-drill GitHub Actions fixture must restore (rebuild) the archive pack first", findings);
  requireText(`${DIR}/github-actions/release-restore-drill-fixture.yml`, /worker:release-restore-drill/, "release-restore-drill GitHub Actions fixture must run worker:release-restore-drill", findings);
  requireText(`${DIR}/github-actions/release-restore-drill-fixture.yml`, /--archive=/, "release-restore-drill GitHub Actions fixture must supply the archive pack anchor", findings);
  requireText(`${DIR}/github-actions/release-restore-drill-fixture.yml`, /test "\$code" -eq 4/, "release-restore-drill GitHub Actions fixture must assert the tampered/mismatch exit code", findings);
  requireText(`${DIR}/github-actions/release-restore-drill-fixture.yml`, /test "\$code" -eq 2/, "release-restore-drill GitHub Actions fixture must assert the incomplete (nothing restored) exit code", findings);
  requireText(`${DIR}/github-actions/release-restore-drill-fixture.yml`, /test "\$code" -eq 1/, "release-restore-drill GitHub Actions fixture must assert the usage exit code (fail closed)", findings);

  // Phase 57 — the release-publish-pack template must build/ingest a governance bundle, compose the handoff pack
  // over it (+ related records), and pin the blocked / incomplete / usage exit codes (fail closed).
  requireText(`${DIR}/github-actions/release-publish-pack-fixture.yml`, /worker:release-governance/, "release-publish-pack GitHub Actions fixture must build or ingest a release governance bundle first", findings);
  requireText(`${DIR}/github-actions/release-publish-pack-fixture.yml`, /worker:release-publish-pack/, "release-publish-pack GitHub Actions fixture must run worker:release-publish-pack", findings);
  requireText(`${DIR}/github-actions/release-publish-pack-fixture.yml`, /--governance=/, "release-publish-pack GitHub Actions fixture must supply the primary release governance bundle", findings);
  requireText(`${DIR}/github-actions/release-publish-pack-fixture.yml`, /test "\$code" -eq 4/, "release-publish-pack GitHub Actions fixture must assert the blocked/tamper exit code", findings);
  requireText(`${DIR}/github-actions/release-publish-pack-fixture.yml`, /test "\$code" -eq 2/, "release-publish-pack GitHub Actions fixture must assert the incomplete (missing governance) exit code", findings);
  requireText(`${DIR}/github-actions/release-publish-pack-fixture.yml`, /test "\$code" -eq 1/, "release-publish-pack GitHub Actions fixture must assert the usage exit code (fail closed)", findings);

  // Phase 58 — the release-handoff-ack template must compose a publish pack, record a bounded acknowledgement of it,
  // and pin the rejected/invalid / deferred / usage exit codes (fail closed).
  requireText(`${DIR}/github-actions/release-handoff-ack-fixture.yml`, /worker:release-publish-pack/, "release-handoff-ack GitHub Actions fixture must compose a publish pack first", findings);
  requireText(`${DIR}/github-actions/release-handoff-ack-fixture.yml`, /worker:release-ack/, "release-handoff-ack GitHub Actions fixture must run worker:release-ack", findings);
  requireText(`${DIR}/github-actions/release-handoff-ack-fixture.yml`, /--publish-pack=/, "release-handoff-ack GitHub Actions fixture must supply the publish pack to acknowledge", findings);
  requireText(`${DIR}/github-actions/release-handoff-ack-fixture.yml`, /--decision=/, "release-handoff-ack GitHub Actions fixture must supply the acknowledgement decision", findings);
  requireText(`${DIR}/github-actions/release-handoff-ack-fixture.yml`, /test "\$code" -eq 4/, "release-handoff-ack GitHub Actions fixture must assert the rejected/invalid (blocked / tampered pack) exit code", findings);
  requireText(`${DIR}/github-actions/release-handoff-ack-fixture.yml`, /test "\$code" -eq 2/, "release-handoff-ack GitHub Actions fixture must assert the deferred (incomplete pack) exit code", findings);
  requireText(`${DIR}/github-actions/release-handoff-ack-fixture.yml`, /test "\$code" -eq 1/, "release-handoff-ack GitHub Actions fixture must assert the usage exit code (fail closed)", findings);

  // Phase 59 — the release-decision template must compose a publish pack + an acknowledgement of it, record the
  // decision, and pin the reject/invalid / insufficient / usage exit codes (fail closed).
  requireText(`${DIR}/github-actions/release-decision-record-fixture.yml`, /worker:release-publish-pack/, "release-decision GitHub Actions fixture must compose a publish pack first", findings);
  requireText(`${DIR}/github-actions/release-decision-record-fixture.yml`, /worker:release-ack/, "release-decision GitHub Actions fixture must record an acknowledgement of the pack", findings);
  requireText(`${DIR}/github-actions/release-decision-record-fixture.yml`, /worker:release-decision/, "release-decision GitHub Actions fixture must run worker:release-decision", findings);
  requireText(`${DIR}/github-actions/release-decision-record-fixture.yml`, /--publish-pack=/, "release-decision GitHub Actions fixture must supply the publish pack", findings);
  requireText(`${DIR}/github-actions/release-decision-record-fixture.yml`, /--ack=/, "release-decision GitHub Actions fixture must supply the acknowledgement", findings);
  requireText(`${DIR}/github-actions/release-decision-record-fixture.yml`, /test "\$code" -eq 4/, "release-decision GitHub Actions fixture must assert the reject/invalid (rejected / tampered ack) exit code", findings);
  requireText(`${DIR}/github-actions/release-decision-record-fixture.yml`, /test "\$code" -eq 2/, "release-decision GitHub Actions fixture must assert the insufficient (deferred / incomplete) exit code", findings);
  requireText(`${DIR}/github-actions/release-decision-record-fixture.yml`, /test "\$code" -eq 1/, "release-decision GitHub Actions fixture must assert the usage exit code (fail closed)", findings);

  // Phase 60 — the release-decision-index template must file decision records, index a bounded batch, and pin the
  // blocked/invalid / insufficient / usage exit codes (fail closed).
  requireText(`${DIR}/github-actions/release-decision-index-fixture.yml`, /worker:release-decision["\s\\]/, "release-decision-index GitHub Actions fixture must file a decision record first", findings);
  requireText(`${DIR}/github-actions/release-decision-index-fixture.yml`, /worker:release-decision-index/, "release-decision-index GitHub Actions fixture must run worker:release-decision-index", findings);
  requireText(`${DIR}/github-actions/release-decision-index-fixture.yml`, /--file=/, "release-decision-index GitHub Actions fixture must supply the decision-record batch", findings);
  requireText(`${DIR}/github-actions/release-decision-index-fixture.yml`, /test "\$code" -eq 4/, "release-decision-index GitHub Actions fixture must assert the blocked/invalid (reject / tampered record) exit code", findings);
  requireText(`${DIR}/github-actions/release-decision-index-fixture.yml`, /test "\$code" -eq 2/, "release-decision-index GitHub Actions fixture must assert the insufficient (inconclusive) exit code", findings);
  requireText(`${DIR}/github-actions/release-decision-index-fixture.yml`, /test "\$code" -eq 1/, "release-decision-index GitHub Actions fixture must assert the usage exit code (fail closed)", findings);

  if (findings.length) {
    for (const f of findings) console.error(`${f.file}: ${f.message}`);
    return 1;
  }
  console.log(`deployment examples: ${FILES.length} files validated`);
  return 0;
}

process.exit(main());

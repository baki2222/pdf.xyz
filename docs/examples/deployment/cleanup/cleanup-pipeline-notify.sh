#!/bin/sh
# pdf.xyz — INERT reference notifier for the ONE-COMMAND cleanup evidence pipeline (Phase 44).
#
# This is the Phase 44 simplification of cleanup-evidence-notify.sh: instead of wiring the
# project -> verify and project -> sweep stages by hand and rolling up their exit codes, it runs
# the single `worker:cleanup-pipeline` command, which projects a raw export ONCE and evaluates
# BOTH arms (absence verifier + dry-run sweeper) internally, then rolls them into ONE documented
# exit code. The wrapper just maps that code to a severity and re-raises the actionable ones.
#
# Given a raw provider export an operator produced OUT-OF-BAND (their own
# `aws s3api list-objects-v2` / `head-object` capture, written to $RAW_EXPORT with their own
# credentials — this wrapper NEVER calls the cloud), the pipeline:
#   1. PROJECTS it offline into the two content-free Phase 42 shapes, dropping every object
#      key / bucket / URL / filename;
#   2. VERIFIES absence and SWEEPS the inventory (dry-run), both read-only;
# and exits with the worst arm's code. It DELETES NOTHING and PROVES NOTHING about the bucket:
# it reshapes + evaluates what you already exported. Actual object deletion stays operator-owned
# and out-of-band. See docs/RUNBOOK.md and docs/examples/deployment/cleanup/README.md.
#
# Composite exit ladder (kept in lockstep with the code — pinned by the module tests):
#   cleanup-pipeline: 0 ok · 1 usage · 2 unknown · 3 drift · 4 breach(tombstoned-present/unsafe)
#
# `set -u` only: we must NOT `set -e`, or the non-zero pipeline result would abort before we
# can read it.
set -u

# --- Config (all inert; override via env out-of-band, never commit real values) -----------
# The raw provider export you captured out-of-band. A missing/unreadable file is a usage error.
RAW_EXPORT="${PDFXYZ_CLEANUP_RAW_EXPORT:-/evidence/raw-export.json}"
# The raw export dialect: aws-s3 (an `aws s3api` capture) or generic (already normalized).
SOURCE_DIALECT="${PDFXYZ_CLEANUP_SOURCE:-aws-s3}"
# Post-expiry reap grace the verify arm tolerates before lingering bytes are called drift.
GRACE_HOURS="${PDFXYZ_CLEANUP_GRACE_HOURS:-48}"
# Inert, secret-free by default: empty ⇒ nothing is posted. A real deployment sets this
# out-of-band, e.g. PDFXYZ_CLEANUP_WEBHOOK_URL=https://REPLACE-ME.example-webhook.invalid/hook
WEBHOOK_URL="${PDFXYZ_CLEANUP_WEBHOOK_URL:-}"

# Run the whole pipeline in one command. Its stdout is a content-free JSON document (bounded
# severities + small codes + a receipt) you can log but never need to parse to decide severity —
# the EXIT CODE is the contract. Discard stdout here; keep only the code.
pnpm -s worker:cleanup-pipeline --file="$RAW_EXPORT" --source="$SOURCE_DIALECT" \
  --grace-hours="$GRACE_HOURS" --json >/dev/null 2>&1
code="$?"

# Map the single composite code to a severity. Usage(1) is a misconfigured check (bad flag or an
# unreadable export), never a cleanup incident, so it is surfaced but never paged.
case "$code" in
  0) severity="ok" ;;
  1) severity="usage" ;;       # the CHECK is misconfigured — fix the wiring, do not page
  2) severity="unknown" ;;     # not enough evidence to prove cleanup (thin export / not wired)
  3) severity="drift" ;;       # an artifact lingers past retention + grace — page
  4) severity="breach" ;;      # a tombstoned-but-present object / unsafe export — page urgently
  *) severity="unknown" ;;
esac

# Where a real notifier forwards the verdict. The pipeline output is content-free by construction
# (bounded severities + counts; no object key, bucket, URL, filename, or byte), so forwarding a
# rolled-up severity leaks nothing.
if [ -n "$WEBHOOK_URL" ]; then
  # Inert unless YOU both set WEBHOOK_URL and uncomment the POST:
  # curl -fsS -X POST -H 'Content-Type: application/json' \
  #   --data "{\"severity\":\"$severity\",\"exit\":$code}" "$WEBHOOK_URL" || true
  :
fi

# A one-line, content-free operator breadcrumb (stderr; safe for any cron/journal log).
printf 'pdfxyz cleanup-pipeline: severity=%s exit=%s\n' "$severity" "$code" >&2

# Re-raise the pipeline's own exit code so the scheduler records the incident (non-zero = fail
# closed; a cron MAILTO / systemd / k8s Job Failed captures it).
exit "$code"

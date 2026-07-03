#!/bin/sh
# pdf.xyz — INERT reference notifier for the storage-artifact cleanup pipeline (Phase 43/42).
#
# Given a raw provider export an operator produced OUT-OF-BAND (their own
# `aws s3api list-objects-v2` / `head-object` capture, written to $RAW_EXPORT with their
# own credentials — this wrapper NEVER calls the cloud), it:
#   1. PROJECTS it offline into the two content-free Phase 42 shapes (`worker:cleanup-project`),
#      dropping every object key / bucket / URL / filename;
#   2. VERIFIES absence   (project --target=evidence  | `worker:cleanup-check`);
#   3. SWEEPS  inventory  (project --target=inventory | `worker:artifact-cleanup`, dry-run);
# then maps the DOCUMENTED exit codes to a severity and re-raises the actionable ones so a
# cron MAILTO / systemd / k8s Job records the incident. It posts nowhere unless YOU wire a
# webhook out-of-band. This is a TEMPLATE — copy it next to your deploy and adapt.
#
# It DELETES NOTHING and PROVES NOTHING about the bucket: it reshapes + evaluates what you
# already exported. Actual object deletion stays operator-owned and out-of-band. See
# docs/RUNBOOK.md and docs/examples/deployment/cleanup/README.md.
#
# Exit ladders (kept in lockstep with the code — pinned by the module tests):
#   cleanup-project : 0 projected · 1 usage · 2 insufficient · 4 unsafe(tombstoned-present/corrupt)
#   cleanup-check   : 0 verified  · 1 usage · 2 unknown/not-configured · 3 drift
#   artifact-cleanup: 0 ok        · 1 usage · 2 unknown · 3 drift · 4 breach(tombstoned/invalid)
#
# `set -u` only: we must NOT `set -e`, or a non-zero stage would abort before we can read it.
set -u

# --- Config (all inert; override via env out-of-band, never commit real values) -----------
# The raw provider export you captured out-of-band. A missing/unreadable file is a usage error.
RAW_EXPORT="${PDFXYZ_CLEANUP_RAW_EXPORT:-/evidence/raw-export.json}"
# Post-expiry reap grace the verifier tolerates before calling lingering bytes drift.
GRACE_HOURS="${PDFXYZ_CLEANUP_GRACE_HOURS:-48}"
# Inert, secret-free by default: empty ⇒ nothing is posted. A real deployment sets this
# out-of-band, e.g. PDFXYZ_CLEANUP_WEBHOOK_URL=https://REPLACE-ME.example-webhook.invalid/hook
WEBHOOK_URL="${PDFXYZ_CLEANUP_WEBHOOK_URL:-}"

worst=0
note=""

# Track the worst ACTIONABLE code seen. Usage(1) is a misconfigured check, never a cleanup
# incident, so it is recorded but never pages (mapped to a soft signal, like ops-check).
record() { # <stage-label> <exit-code>
  label="$1"; code="$2"
  case "$code" in
    0) : ;;                                   # clean — nothing to do
    1) note="${note} ${label}=usage" ;;       # the CHECK is misconfigured — do not page
    2) note="${note} ${label}=unknown" ; [ "$worst" -lt 2 ] && worst=2 ;;
    3) note="${note} ${label}=drift"   ; [ "$worst" -lt 3 ] && worst=3 ;;
    4) note="${note} ${label}=breach"  ; [ "$worst" -lt 4 ] && worst=4 ;;
    *) note="${note} ${label}=unexpected" ; [ "$worst" -lt 2 ] && worst=2 ;;
  esac
}

# 1+2. Project → verify ABSENCE. The projected document keys its array as the verifier reads it.
pnpm -s worker:cleanup-project --target=evidence --file="$RAW_EXPORT" 2>/dev/null \
  | pnpm -s worker:cleanup-check --stdin --grace-hours="$GRACE_HOURS" --json >/dev/null 2>&1
record verify "$?"

# 1+3. Project → dry-run SWEEP inventory. Never deletes; reports expired/tombstoned-but-present.
pnpm -s worker:cleanup-project --target=inventory --file="$RAW_EXPORT" 2>/dev/null \
  | pnpm -s worker:artifact-cleanup --stdin --json >/dev/null 2>&1
record sweep "$?"

# Also surface a projection-only unsafe signal (present-but-tombstoned / corrupt export),
# even if the downstream tool is not-configured here.
pnpm -s worker:cleanup-project --target=inventory --file="$RAW_EXPORT" --json >/dev/null 2>&1
record project "$?"

case "$worst" in
  0) severity="ok" ;;
  2) severity="unknown" ;;
  3) severity="warn" ;;
  4) severity="critical" ;;
  *) severity="unknown" ;;
esac

# Where a real notifier forwards the verdict. Every stage's output is content-free by
# construction (bounded enums + counts; no object key, bucket, URL, filename, or byte), so
# forwarding a rolled-up severity leaks nothing.
if [ -n "$WEBHOOK_URL" ]; then
  # Inert unless YOU both set WEBHOOK_URL and uncomment the POST:
  # curl -fsS -X POST -H 'Content-Type: application/json' \
  #   --data "{\"severity\":\"$severity\",\"worst\":$worst}" "$WEBHOOK_URL" || true
  :
fi

# A one-line, content-free operator breadcrumb (stderr; safe for any cron/journal log).
printf 'pdfxyz cleanup-evidence: severity=%s worst=%s%s\n' "$severity" "$worst" "$note" >&2

# Re-raise the actionable codes (2/3/4) so the scheduler records the incident.
exit "$worst"

#!/bin/sh
# pdf.xyz — INERT reference notifier for `pnpm worker:ops-check`.
#
# It runs the operator healthcheck, maps its DOCUMENTED exit code to an action, and
# shows where a real pager/webhook would consume the content-free JSON verdict. It
# implements NO real pager and posts nowhere unless YOU wire an out-of-band webhook.
# This is a TEMPLATE — copy it next to your deploy and adapt; do not treat it as a
# production pager. See docs/RUNBOOK.md (Phase 32 scheduler wiring).
#
# Exit ladder of `worker:ops-check` (kept in lockstep with the code — the tests pin it
# against src/lib/workers/observability/alerts.ts::OPS_CHECK_EXIT):
#   0  OK        — everything observable is healthy; no action
#   1  usage     — the CHECK ITSELF was misconfigured (bad flag / unreadable input),
#                  NOT a worker problem — never page on this
#   2  UNKNOWN   — worker health could not be determined (no data)
#   3  WARNING   — a recommended fix is outstanding (degraded; a worker can still run)
#   4  CRITICAL  — a worker cannot run correctly here, or an SLO breached — page
#
# `set -u` only: we must NOT `set -e`, or a non-zero ops-check would abort before we
# can read and act on its code.
set -u

# --- Config (all inert; override via env out-of-band, never commit real values) -----
# Snapshot source: --runtime on the worker host, --web on a separate monitor host.
SOURCE="${PDFXYZ_OPSCHECK_SOURCE:---web}"
# Inert, secret-free by default: empty ⇒ nothing is posted. A real deployment sets this
# out-of-band, e.g. PDFXYZ_OPSCHECK_WEBHOOK_URL=https://REPLACE-ME.example-webhook.invalid/hook
WEBHOOK_URL="${PDFXYZ_OPSCHECK_WEBHOOK_URL:-}"

# Run the check. Its stdout is the content-free JSON verdict; its exit code is the signal.
out="$(pnpm -s worker:ops-check "$SOURCE" --json 2>/dev/null)"
code=$?

case "$code" in
  0) exit 0 ;;                 # healthy — nothing to do
  1) severity="usage" ;;       # the CHECK is misconfigured — do not page as a worker incident
  2) severity="unknown" ;;
  3) severity="warn" ;;
  4) severity="critical" ;;
  *) severity="unknown" ;;     # any unexpected code is treated as indeterminate
esac

# Where a real notifier forwards the verdict. `worker:ops-check --json` is content-free
# by construction (bounded enums + policy-authored prose; an ingested snapshot's strings
# are re-authored, never echoed), so forwarding it leaks no document, path, key, or secret.
if [ -n "$WEBHOOK_URL" ]; then
  # Inert unless YOU both set WEBHOOK_URL and uncomment the POST:
  # curl -fsS -X POST -H 'Content-Type: application/json' --data "$out" "$WEBHOOK_URL" || true
  :
fi

# A one-line, content-free operator breadcrumb (stderr; safe for any cron/journal log).
printf 'pdfxyz ops-check: severity=%s exit=%s\n' "$severity" "$code" >&2

# Re-raise the operational codes (2/3/4) so a cron MAILTO / systemd / supervisor records
# the incident; swallow usage(1) so a MISCONFIGURED CHECK never pages as a worker outage.
[ "$code" -eq 1 ] && exit 0
exit "$code"

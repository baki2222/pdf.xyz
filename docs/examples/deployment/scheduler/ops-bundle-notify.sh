#!/bin/sh
# pdf.xyz — INERT reference notifier for `pnpm worker:ops-bundle` (incident handoff).
#
# It assembles the operations evidence bundle (ops-check + an optional cleanup-pipeline
# summary), persists the content-free JSON artifact for an incident ticket / on-call handoff,
# maps the bundle's DOCUMENTED composite exit code to an action, and shows where a real
# pager/webhook would consume the verdict. It implements NO real pager and posts nowhere unless
# YOU wire an out-of-band webhook. This is a TEMPLATE — copy it next to your deploy and adapt;
# do not treat it as a production pager. See docs/RUNBOOK.md (Phase 45).
#
# The bundle is an AGGREGATOR of existing content-free evidence — not deletion proof, not malware
# scanning, not auth, not cloud validation. Its output is content-free by construction (bounded
# enums + authored prose; a poisoned input string is re-authored, never echoed), so persisting or
# forwarding it leaks no document, path, key, bucket, or secret.
#
# Composite exit ladder of `worker:ops-bundle` (kept in lockstep with the code — the tests pin it
# against src/lib/workers/observability/alerts.ts::OPS_CHECK_EXIT):
#   0  OK        — every composed signal is healthy; no action
#   1  usage     — the AGGREGATION was misconfigured (bad flag / unreadable required input),
#                  NOT a worker problem — never page on this
#   2  UNKNOWN   — a composed signal is indeterminate (no data)
#   3  WARNING   — a composed signal is degraded (a recommended fix is outstanding, or a drift)
#   4  CRITICAL  — a worker cannot run correctly here, or a cleanup breach — page
#
# `set -u` only: we must NOT `set -e`, or a non-zero bundle would abort before we can act on it.
set -u

# --- Config (all inert; override via env out-of-band, never commit real values) -----
# Snapshot source: --runtime on the worker host, --web on a separate monitor host.
SOURCE="${PDFXYZ_OPSBUNDLE_SOURCE:---web}"
# Optional content-free cleanup-pipeline summary to compose in (from worker:cleanup-pipeline
# --json). Empty ⇒ the bundle's pipeline section is honestly "not-configured". NOT a raw export.
PIPELINE_REPORT="${PDFXYZ_OPSBUNDLE_PIPELINE_REPORT:-}"
# Where to persist the rendered bundle artifact for the ticket/handoff. A local path only.
OUTPUT="${PDFXYZ_OPSBUNDLE_OUTPUT:-/tmp/pdfxyz-ops-bundle.json}"
# Inert, secret-free by default: empty ⇒ nothing is posted. A real deployment sets this
# out-of-band, e.g. PDFXYZ_OPSBUNDLE_WEBHOOK_URL=https://REPLACE-ME.example-webhook.invalid/hook
WEBHOOK_URL="${PDFXYZ_OPSBUNDLE_WEBHOOK_URL:-}"

# Assemble the bundle: pipe the content-free ops-check result straight into the aggregator, and
# attach the optional pipeline summary. The pipeline of a POSIX shell exits with the last
# command's status, so `code` is the bundle's composite exit.
if [ -n "$PIPELINE_REPORT" ]; then
  pnpm -s worker:ops-check "$SOURCE" --json 2>/dev/null \
    | pnpm -s worker:ops-bundle --pipeline="$PIPELINE_REPORT" --output="$OUTPUT" --json 2>/dev/null
else
  pnpm -s worker:ops-check "$SOURCE" --json 2>/dev/null \
    | pnpm -s worker:ops-bundle --output="$OUTPUT" --json 2>/dev/null
fi
code=$?

case "$code" in
  0) exit 0 ;;                 # healthy — nothing to do (the artifact is still written)
  1) severity="usage" ;;       # the AGGREGATION is misconfigured — do not page as a worker incident
  2) severity="unknown" ;;
  3) severity="warn" ;;
  4) severity="critical" ;;
  *) severity="unknown" ;;     # any unexpected code is treated as indeterminate
esac

# Where a real notifier forwards the persisted, content-free bundle for an incident handoff.
if [ -n "$WEBHOOK_URL" ]; then
  # Inert unless YOU both set WEBHOOK_URL and uncomment the POST:
  # curl -fsS -X POST -H 'Content-Type: application/json' --data-binary "@$OUTPUT" "$WEBHOOK_URL" || true
  :
fi

# A one-line, content-free operator breadcrumb (stderr; safe for any cron/journal log).
printf 'pdfxyz ops-bundle: severity=%s exit=%s\n' "$severity" "$code" >&2

# Re-raise the operational codes (2/3/4) so a cron MAILTO / systemd / supervisor records the
# incident; swallow usage(1) so a MISCONFIGURED aggregation never pages as a worker outage.
[ "$code" -eq 1 ] && exit 0
exit "$code"

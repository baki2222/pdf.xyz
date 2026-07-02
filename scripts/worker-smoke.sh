#!/usr/bin/env sh
# pdf.xyz secure-worker — no-config honesty smoke.
#
# Runs the REAL worker daemon CLI in a deliberately unconfigured environment and
# asserts it stays honest: it reports readiness / refuses to process (exit 2) and
# rejects bad flags (exit 1) — it never fabricates work. Deterministic and
# offline: needs no Redis, S3, secrets, or network. Wired as `pnpm worker:smoke`
# and safe to run in CI.
#
# It does NOT prove processing works (that needs real providers + a native
# engine) — it proves the daemon's FAILURE modes are truthful.
set -u

# Force a known no-config environment so the assertions are deterministic
# regardless of the operator's ambient variables (empty selectors read as unset).
export PDFXYZ_STORAGE_PROVIDER=""
export PDFXYZ_QUEUE_PROVIDER=""
export PDFXYZ_WORKER_MODE=""

fail=0

# check <expected-exit> <label> [daemon flags...]
check() {
  want=$1
  label=$2
  shift 2
  if pnpm -s worker:daemon "$@" >/dev/null 2>&1; then
    code=0
  else
    code=$?
  fi
  if [ "$code" -eq "$want" ]; then
    printf '  ok    exit %s   %s\n' "$code" "$label"
  else
    printf '  FAIL  exit %s (want %s)   %s\n' "$code" "$want" "$label"
    fail=1
  fi
}

echo "worker no-config smoke (honest-refusal contract):"
# NOTE: never invoke the bare default (loop) mode here — it runs forever. Every
# mode below exits immediately in a no-config environment.
check 0 "--help prints usage"                      --help
check 2 "--dry-run-status reports not-configured"  --dry-run-status
check 2 "--once refuses to fabricate a job"        --once
check 2 "--drain refuses to fabricate work"        --drain
check 1 "unknown flag is a usage error"            --not-a-flag
check 1 "conflicting modes are rejected"           --once --drain

if [ "$fail" -ne 0 ]; then
  echo "worker smoke: FAILED"
  exit 1
fi
echo "worker smoke: all checks passed"

#!/usr/bin/env sh
# pdf.xyz secure-worker — no-config honesty smoke.
#
# Runs the REAL worker daemon CLI in a deliberately unconfigured environment and
# asserts it stays honest across its whole exit-code contract:
#   * reports readiness / refuses to process (exit 2) with nothing configured,
#   * rejects bad or conflicting flags (exit 1),
#   * reports clean guardrails and generates an offline lifecycle policy (exit 0),
#   * and FAILS FAST on a dangerous/invalid config (exit 4) rather than silently
#     falling back to "not configured".
# It never fabricates work. Deterministic and offline: needs no Redis, S3,
# secrets, or network. Wired as `pnpm worker:smoke` and safe to run in CI (and,
# via the container workflow, inside the built worker image).
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

# check_env <expected-exit> <label> <VAR=value> [daemon flags...]
# Like check(), but sets ONE extra environment variable for just this invocation.
# Used to prove a dangerous/invalid config is rejected (exit 4), not silently
# ignored — a real value is never needed, an obviously-bogus one is enough.
check_env() {
  want=$1
  label=$2
  assignment=$3
  shift 3
  if env "$assignment" pnpm -s worker:daemon "$@" >/dev/null 2>&1; then
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
check 0 "--check reports clean guardrails"         --check
check 0 "--lifecycle-policy generates offline"     --lifecycle-policy
# A selected-but-unsupported provider is a DANGEROUS config: the daemon must fail
# fast (exit 4, guardrail) instead of silently reporting "not configured".
check_env 4 "--check rejects a dangerous config"   PDFXYZ_STORAGE_PROVIDER=not-a-real-provider --check

if [ "$fail" -ne 0 ]; then
  echo "worker smoke: FAILED"
  exit 1
fi
echo "worker smoke: all checks passed"

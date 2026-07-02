#!/usr/bin/env sh
# pdf.xyz secure-worker — IMAGE-LEVEL native-engine + OCR smoke.
#
# Proves the built `worker` image actually contains the native engine stack it
# advertises, WITHOUT any cloud service, secret, or user document:
#   * the deep-compression binaries are on PATH (Ghostscript / qpdf / mutool),
#   * the OCR engines are on PATH (Tesseract baseline + OCRmyPDF),
#   * the minimal English OCR language data is installed,
#   * the daemon stays HONEST with nothing wired — native engines present must NOT
#     fake drainability (`--dry-run-status` still exits 2), and
#   * OCR readiness can be observed PRESENCE-ONLY: opting in (`PDFXYZ_OCR=on`) flips
#     the daemon's `ocr_health` to ready because a real engine is installed here —
#     with the readout staying content-free (no path, binary, language, or value).
#
# This is the image counterpart of `worker-smoke.sh` (the daemon's exit-code
# honesty contract). It is meant to run INSIDE the built worker image (wired as
# `pnpm worker:image-smoke`, invoked by the container workflow); it deliberately
# FAILS where the engines are absent — that is the proof, not a bug — so it is NOT
# part of the Docker-free PR gate. It needs no Redis/S3/ClamAV/secret/network and
# processes no document; it only probes binaries and reads presence-only status.
set -u

# Force a known no-config environment so the drainability assertions are
# deterministic regardless of the operator's ambient variables (empty selectors
# read as unset). OCR starts unset (disabled); Section E opts in per-invocation.
export PDFXYZ_STORAGE_PROVIDER=""
export PDFXYZ_QUEUE_PROVIDER=""
export PDFXYZ_WORKER_MODE=""
export PDFXYZ_OCR=""

fail=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; fail=1; }

# Presence only: resolve on PATH but NEVER echo the resolved path — the readout
# stays path-free by construction (a system binary path is not a secret, but this
# keeps the whole script honest about the "no paths" contract).
have() { command -v "$1" >/dev/null 2>&1; }

require_bin() { # require_bin <label> <binary>
  if have "$2"; then ok "$1 is installed"; else bad "$1 is installed"; fi
}

# Extract the single JSON log line for a daemon event from captured output.
event_line() { # event_line <output> <event>
  printf '%s\n' "$1" | grep "\"event\":\"$2\"" | head -n1
}

echo "worker image smoke — native compression engines:"
require_bin "Ghostscript (gs)" gs
require_bin "qpdf"             qpdf
require_bin "mutool (mupdf)"   mutool

echo "worker image smoke — OCR engines:"
require_bin "Tesseract (baseline)" tesseract
require_bin "OCRmyPDF"             ocrmypdf

echo "worker image smoke — OCR language data:"
# `--list-langs` prints each installed language on its own line (to stderr). Grep
# for the `eng` line only; never echo the raw output — it names the tessdata dir.
if have tesseract && tesseract --list-langs 2>&1 | grep -qE '^eng[[:space:]]*$'; then
  ok "English OCR language data (eng) is installed"
else
  bad "English OCR language data (eng) is installed"
fi

echo "worker image smoke — daemon honesty (native engines must not fake drainability):"
# With nothing wired the readiness probe must STILL report not-configured (exit 2)
# even though this image is full of native engines — an engine is not a queue/store.
out=$(pnpm -s worker:daemon --dry-run-status 2>/dev/null)
code=$?
if [ "$code" -eq 2 ]; then
  ok "--dry-run-status reports not-configured (exit 2) with no queue/storage"
else
  bad "--dry-run-status should exit 2 with nothing wired (got $code)"
fi
ocr_off=$(event_line "$out" ocr_health)
case "$ocr_off" in
  *'"enabled":false'*) ok "ocr_health honestly reports disabled when not opted in" ;;
  *) bad "ocr_health should report enabled:false when PDFXYZ_OCR is unset" ;;
esac

echo "worker image smoke — presence-only OCR readiness (opted in, engine installed here):"
# Opt into OCR for THIS invocation only. Still no queue/storage, so the probe still
# exits 2 — but `ocr_health` must now report an installed engine as ready, which is
# the image-level proof that the OCR packaging actually works. Nothing is processed.
onout=$(env PDFXYZ_OCR=on pnpm -s worker:daemon --dry-run-status 2>/dev/null)
oncode=$?
if [ "$oncode" -eq 2 ]; then
  ok "opting into OCR does not fake drainability (still exit 2)"
else
  bad "OCR opt-in must not change drainability; expected exit 2 (got $oncode)"
fi
ocr_on=$(event_line "$onout" ocr_health)
case "$ocr_on" in
  *'"enabled":true'*'"ready":true'*) ok "ocr_health reports ready — a real engine is installed in the image" ;;
  *) bad "ocr_health should report enabled:true + ready:true when an engine is installed" ;;
esac
comp_on=$(event_line "$onout" compression_health)
case "$comp_on" in
  *'"deep":true'*) ok "compression_health reports deep:true — a native compressor is installed" ;;
  *) bad "compression_health should report deep:true when a native engine is installed" ;;
esac
# Presence-only: the OCR + compression health readout carries NO path (the emitted
# JSON — timestamp, event, booleans, engine family, prose — contains no `/`), so an
# operator reads readiness without any path, binary, language, or secret leaking.
health=$(printf '%s\n' "$onout" | grep -E '"event":"(ocr_health|compression_health)"')
if printf '%s\n' "$health" | grep -q '/'; then
  bad "engine health readout must be content-free (found a path-like '/')"
else
  ok "engine health readout is content-free (presence-only, no paths)"
fi

if [ "$fail" -ne 0 ]; then
  echo "worker image smoke: FAILED"
  exit 1
fi
echo "worker image smoke: all checks passed"

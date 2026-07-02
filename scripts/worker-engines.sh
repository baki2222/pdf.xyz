#!/usr/bin/env sh
# pdf.xyz secure-worker — native ENGINE PREFLIGHT (node-free, content-free).
#
# A tiny POSIX-sh probe that answers ONE question an operator asks before (or while)
# building/booting a worker image: "are the optional native engines this deployment
# opts into actually installed on PATH here?" It is the dependency-light companion of
# the two node-based smokes:
#
#   * scripts/worker-smoke.sh        — the daemon's honest exit-code contract (needs tsx).
#   * scripts/worker-image-smoke.sh  — the full image proof run INSIDE the built worker
#                                      image (needs the daemon; asserts engines present).
#   * scripts/worker-engines.sh      — THIS script: needs only `command -v`. Runs in a
#                                      Dockerfile RUN step, a k8s initContainer, a bare
#                                      builder, or CI — anywhere, with or without Node.
#
# The authoritative gate remains the daemon's `--check` / `--dry-run-status` (it reads
# the full config AND probes the host). This preflight predicts the engine-family half
# of that verdict at the binary level, cheaply and without Node, so an image build can
# fail fast the moment a required engine is missing instead of at first job.
#
# Presence-only & content-free by construction:
#   * It resolves binaries on PATH but NEVER echoes a resolved path (a system binary
#     path is not a secret, but keeping the readout path-free matches the daemon's
#     health lines and the image smoke).
#   * It reads only the capability/opt-in SELECTORS below — never a provider secret,
#     endpoint, bucket, or token — and never prints an environment-variable VALUE.
#   * Engine *family* names (ghostscript/qpdf/mutool/ocrmypdf/tesseract) and their
#     command names are public tool names, printed for a human; nothing else leaks.
#
# Selectors it honors (names only; values are never printed):
#   PDFXYZ_NATIVE_COMPRESSION       deep compression opt-in (on/true/1/yes/enabled ⇒ wanted)
#   PDFXYZ_COMPRESSION_ENGINE       pin deep compression to ghostscript|qpdf|mutool
#   PDFXYZ_WORKER_REQUIRE_DEEP_ENGINE  HARD-require a deep-compression engine (else exit 3)
#   PDFXYZ_OCR                      OCR opt-in (on/true/1/yes/auto/enabled ⇒ enabled)
#   PDFXYZ_OCR_ENGINE              pin OCR to ocrmypdf|tesseract
#   PDFXYZ_WORKER_REQUIRE_OCR      HARD-require a ready OCR engine (else exit 3)
#
# Exit codes:
#   0  every REQUIRED engine family is satisfied (or nothing is required — the honest
#      default in a bare environment, so this script is green wherever no engine is
#      demanded, exactly like the daemon's guardrails).
#   1  usage error (an unknown flag).
#   3  a REQUIRED engine family is unmet: an opt-in require flag is armed but the engine
#      is not installed (or OCR is required without being opted in). This mirrors the
#      daemon's `require_deep_engine` / `require_ocr` guardrail (which fails with exit 4)
#      — a distinct code so the two tools are never confused.
#
# It processes NO document and contacts NO cloud service, queue, store, or scanner.
set -u

want_versions=0
for arg in "$@"; do
  case "$arg" in
    --versions) want_versions=1 ;;
    -h|--help)
      sed -n '2,44p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'worker engines: unknown argument: %s\n' "$arg" >&2
      printf 'usage: worker:engines [--versions] [--help]\n' >&2
      exit 1
      ;;
  esac
done

fail=0
note() { printf '  %s\n' "$1"; }
present() { printf '  present  %s\n' "$1"; }
missing() { printf '  missing  %s\n' "$1"; }
unmet()   { printf '  UNMET    %s\n' "$1"; fail=3; }

# Presence only: resolve on PATH but never echo the resolved path.
have() { command -v "$1" >/dev/null 2>&1; }

# Lowercase a value for case-insensitive token matching (no value is ever printed).
lower() { printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]'; }

# A require flag is armed on a recognized truthy token (matches the daemon guardrail).
is_truthy() {
  case "$(lower "${1:-}")" in true | 1 | yes | on) return 0 ;; *) return 1 ;; esac
}

# OCR is opted in on the same tokens the OCR config parser accepts (auto ⇒ on); any
# other/unset value reads as off. Never prints the value.
ocr_is_on() {
  case "$(lower "${1:-}")" in
    on | true | 1 | yes | auto | enabled) return 0 ;;
    *) return 1 ;;
  esac
}

# Deep compression is *explicitly wanted* on the same tokens the guardrail treats as a
# request (NOT `auto`, which is the graceful default that never demands an engine).
deep_wanted() {
  case "$(lower "${1:-}")" in on | true | 1 | yes | enabled) return 0 ;; *) return 1 ;; esac
}

# Print a safe version line for a present binary: first line only, with any path-like
# token scrubbed, capped in length — so `--versions` can never leak a filesystem path.
version_of() {
  bin=$1
  case "$bin" in
    mutool) raw=$("$bin" -v 2>&1) ;; # mutool uses -v (and may exit non-zero) — tolerate it
    *) raw=$("$bin" --version 2>&1) ;;
  esac
  printf '%s\n' "$raw" | awk '
    NR == 1 {
      for (i = 1; i <= NF; i++) if ($i ~ /\//) $i = "[path]"
      print substr($0, 1, 80)
    }'
}

report() { # report <label> <binary>
  if have "$2"; then
    present "$1"
    [ "$want_versions" -eq 1 ] && note "         version: $(version_of "$2")"
    return 0
  fi
  missing "$1"
  return 1
}

echo "worker engine preflight — deep-compression engines (auto-detected; lossless repack always works):"
have_gs=0; have_qpdf=0; have_mutool=0
report "Ghostscript (gs)" gs && have_gs=1
report "qpdf"             qpdf && have_qpdf=1
report "mutool (mupdf)"   mutool && have_mutool=1

echo "worker engine preflight — OCR engines (optional; off unless opted in):"
have_ocrmypdf=0; have_tesseract=0
report "OCRmyPDF (ocrmypdf)" ocrmypdf && have_ocrmypdf=1
report "Tesseract (tesseract)" tesseract && have_tesseract=1

# --------------------------------------------------------------------------- #
# Requirement verdicts — gate the exit code on the opt-in require flags only.
# --------------------------------------------------------------------------- #
echo "worker engine preflight — requirements:"

# ---- Deep compression --------------------------------------------------------
comp_pin=$(lower "${PDFXYZ_COMPRESSION_ENGINE:-}")
case "$comp_pin" in
  ghostscript) deep_present=$have_gs; deep_which="ghostscript (gs)" ;;
  qpdf)        deep_present=$have_qpdf; deep_which="qpdf" ;;
  mutool)      deep_present=$have_mutool; deep_which="mutool" ;;
  "")          deep_present=$(( have_gs || have_qpdf || have_mutool )); deep_which="a deep-compression engine (ghostscript, qpdf, or mutool)" ;;
  *)           note "compression engine pin not recognized; probing all engines"
               deep_present=$(( have_gs || have_qpdf || have_mutool )); deep_which="a deep-compression engine (ghostscript, qpdf, or mutool)" ;;
esac

if is_truthy "${PDFXYZ_WORKER_REQUIRE_DEEP_ENGINE:-}"; then
  if [ "$deep_present" -ne 0 ]; then
    note "deep compression required and satisfied ($deep_which present)."
  else
    unmet "deep compression is REQUIRED but $deep_which is not installed — deep jobs cannot run."
  fi
elif deep_wanted "${PDFXYZ_NATIVE_COMPRESSION:-}" && [ "$deep_present" -eq 0 ]; then
  # Wanted-but-not-required is a warning (matches the daemon's warn severity): lossless
  # repack still runs, so it does not fail the preflight.
  note "note: deep compression is enabled but $deep_which is not installed (lossless repack still works)."
else
  note "deep compression not required."
fi

# ---- OCR ---------------------------------------------------------------------
ocr_pin=$(lower "${PDFXYZ_OCR_ENGINE:-}")
case "$ocr_pin" in
  ocrmypdf)  ocr_present=$have_ocrmypdf; ocr_which="OCRmyPDF (ocrmypdf)" ;;
  tesseract) ocr_present=$have_tesseract; ocr_which="Tesseract (tesseract)" ;;
  "")        ocr_present=$(( have_ocrmypdf || have_tesseract )); ocr_which="an OCR engine (OCRmyPDF or Tesseract)" ;;
  *)         note "OCR engine pin not recognized; probing all engines"
             ocr_present=$(( have_ocrmypdf || have_tesseract )); ocr_which="an OCR engine (OCRmyPDF or Tesseract)" ;;
esac

if is_truthy "${PDFXYZ_WORKER_REQUIRE_OCR:-}"; then
  if ! ocr_is_on "${PDFXYZ_OCR:-}"; then
    unmet "OCR is REQUIRED but not opted in — set PDFXYZ_OCR=on (and install $ocr_which)."
  elif [ "$ocr_present" -ne 0 ]; then
    note "OCR required and satisfied (opted in; $ocr_which present)."
  else
    unmet "OCR is REQUIRED and opted in but $ocr_which is not installed — OCR jobs would fail as not_implemented."
  fi
elif ocr_is_on "${PDFXYZ_OCR:-}" && [ "$ocr_present" -eq 0 ]; then
  note "note: OCR is opted in but $ocr_which is not installed (OCR stays unavailable until an engine is present)."
else
  note "OCR not required."
fi

if [ "$fail" -ne 0 ]; then
  echo "worker engine preflight: a required engine is missing"
  exit "$fail"
fi
echo "worker engine preflight: OK (all required engines present)"

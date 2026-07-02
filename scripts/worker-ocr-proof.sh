#!/usr/bin/env sh
# pdf.xyz secure-worker — DETERMINISTIC native OCR PROOF (synthetic fixture only).
#
# Proves the packaged native OCR baseline can actually RECOGNIZE text end-to-end,
# using a tiny generated fixture and NO user document, cloud service, secret, queue,
# store, or scanner. It is the recognition counterpart of the presence-only smokes:
#
#   * scripts/worker-engines.sh      — are the engines on PATH? (node-free preflight)
#   * scripts/worker-image-smoke.sh  — are the engines + English data installed, and
#                                      does opting into OCR flip readiness? (presence)
#   * scripts/worker-ocr-proof.sh    — THIS script: does the baseline engine turn a
#                                      raster of known text into a searchable PDF +
#                                      text sidecar, and does recognition actually
#                                      produce the expected sentinel? (behavior)
#
# What it does, deterministically:
#   1. Renders a fixed, in-script sentinel word to a raster PNG with Ghostscript
#      (a pure image — NO text layer), in an isolated temp dir.
#   2. Runs the Tesseract baseline over the PNG by ARGV (no shell, no interpolation of
#      any external value) to produce a searchable PDF + a text sidecar.
#   3. STRUCTURAL checks: the PDF exists and begins with the %PDF- marker; the sidecar
#      exists and is non-empty.
#   4. RECOGNITION check: the sidecar, normalized (letters/digits only, upper-cased),
#      CONTAINS the expected sentinel — proving real recognition, not a structural
#      fluke. The recognized text itself is NEVER printed, logged, or retained.
#
# Honesty & privacy by construction:
#   * The fixture is a fixed literal in THIS script — never a user document.
#   * Output is presence-only and content-free: it prints ok/FAIL labels only, never a
#     temp path, a filename, a command path, an env value, or any recognized text.
#   * The temp dir is ALWAYS removed — on success, failure, or signal (an EXIT trap).
#   * It proves the Tesseract baseline recognition path only. It does NOT prove
#     production OCR quality, non-English language packs, OCRmyPDF's PDF→PDF path, or
#     anything about real user documents/traffic. See docs/OCR_BACKEND.md.
#
# Meant to run INSIDE the built worker image (wired as `pnpm worker:ocr-proof`, invoked
# by the container workflow after the engine presence smoke). It deliberately reports a
# missing engine as a prerequisite failure (exit 2) rather than faking a result, so it
# is NOT part of the Docker-free PR gate.
#
# Exit codes:
#   0  the OCR proof passed (structural + recognition checks all held).
#   1  usage error (an unknown flag).
#   2  a prerequisite engine (Ghostscript or Tesseract) is not installed here, so the
#      proof cannot run — honest "cannot prove", never a faked pass.
#   3  the proof RAN but a check failed (no PDF/sidecar produced, or the sentinel was
#      not recognized). A genuine failure of the packaged engine.
set -u

for arg in "$@"; do
  case "$arg" in
    -h | --help)
      sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'worker ocr proof: unknown argument: %s\n' "$arg" >&2
      printf 'usage: worker:ocr-proof [--help]\n' >&2
      exit 1
      ;;
  esac
done

# The expected recognition sentinel. A fixed, in-script literal (all upper-case, no
# ambiguous glyphs) — never derived from any external input. It is rendered into the
# fixture AND checked for after recognition, so the two can never drift apart.
SENTINEL='OCRPROOF'

fail=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; fail=1; }

# Presence only: resolve on PATH but never echo the resolved path.
have() { command -v "$1" >/dev/null 2>&1; }

echo "worker ocr proof — prerequisites (engines must be installed to prove recognition):"
missing=0
if have gs; then ok "Ghostscript (gs) is installed"; else bad "Ghostscript (gs) is installed"; missing=1; fi
if have tesseract; then ok "Tesseract is installed"; else bad "Tesseract is installed"; missing=1; fi
if [ "$missing" -ne 0 ]; then
  echo "worker ocr proof: prerequisite engine missing — cannot prove recognition here"
  exit 2
fi

# Isolated, worker-owned temp dir for the whole proof. ALWAYS removed on exit (success,
# failure, or signal) so no fixture, raster, or artifact outlives the run. The path is
# held only in a variable and never printed.
workdir=$(mktemp -d "${TMPDIR:-/tmp}/pdfxyz-ocr-proof.XXXXXX") || {
  echo "worker ocr proof: could not create a temp directory"
  exit 3
}
trap 'rm -rf "$workdir"' EXIT INT TERM HUP

ps="$workdir/fixture.ps"
png="$workdir/fixture.png"
base="$workdir/out"

echo "worker ocr proof — synthetic fixture (a raster of known text, no text layer):"
# Write a fixed PostScript fixture that draws the sentinel twice (redundancy improves
# recognition reliability) in a bold base-14 font. No shell interpolation of any
# external value — only the in-script SENTINEL constant is substituted.
if printf '%s\n' \
  '%!PS-Adobe-3.0' \
  '<< /PageSize [720 320] >> setpagedevice' \
  '/Helvetica-Bold findfont 72 scalefont setfont' \
  "40 200 moveto ($SENTINEL) show" \
  "40 90 moveto ($SENTINEL) show" \
  'showpage' > "$ps"; then
  ok "sentinel fixture written"
else
  bad "sentinel fixture written"
fi

# Rasterize the PostScript to a PNG with Ghostscript. The result is a pure image with
# NO text layer, so recognizing the sentinel from it is genuine OCR. `-dSAFER`
# restricts file access; output is discarded so no tessdata/path is ever echoed.
if gs -q -dNOPAUSE -dBATCH -dSAFER -sDEVICE=png16m -r300 -sOutputFile="$png" "$ps" >/dev/null 2>&1 \
  && [ -s "$png" ]; then
  ok "fixture rasterized to a text-free image"
else
  bad "fixture rasterized to a text-free image"
fi

echo "worker ocr proof — Tesseract baseline recognition (image → searchable PDF + text):"
# Invoke the baseline engine by ARGV (no shell string, no eval): input image, output
# base, English, then the `pdf` + `txt` config tokens. Output is discarded (tesseract
# writes progress + the tessdata dir to stderr).
tesseract "$png" "$base" -l eng pdf txt >/dev/null 2>&1 || bad "tesseract completed without error"

# STRUCTURAL: the searchable PDF exists, is non-empty, and begins with the PDF marker.
# The header is captured into a variable and compared — never printed.
if [ -s "$base.pdf" ]; then
  header=$(head -c 5 "$base.pdf" 2>/dev/null)
  case "$header" in
    "%PDF-"*) ok "a searchable PDF was produced (structurally plausible)" ;;
    *) bad "the produced PDF begins with the %PDF- marker" ;;
  esac
else
  bad "a searchable PDF was produced (structurally plausible)"
fi

# STRUCTURAL: the text sidecar exists and is non-empty.
if [ -s "$base.txt" ]; then
  ok "a non-empty text sidecar was produced"
else
  bad "a non-empty text sidecar was produced"
fi

echo "worker ocr proof — recognition sentinel (bounded check; recognized text is never printed):"
# RECOGNITION: normalize the sidecar to letters/digits only, upper-case it, and check
# it CONTAINS the sentinel. `grep -qF` is quiet + fixed-string, so nothing is printed
# and the sentinel is matched literally. This proves real recognition, not structure.
if [ -f "$base.txt" ] \
  && tr -cd 'A-Za-z0-9' < "$base.txt" | tr 'a-z' 'A-Z' | grep -qF "$SENTINEL"; then
  ok "the expected sentinel was recognized in the sidecar"
else
  bad "the expected sentinel was recognized in the sidecar"
fi

# The temp dir (fixture, raster, PDF, sidecar) is removed by the EXIT trap regardless
# of the outcome below.
if [ "$fail" -ne 0 ]; then
  echo "worker ocr proof: FAILED"
  exit 3
fi
echo "worker ocr proof: all checks passed (synthetic Tesseract recognition proven)"

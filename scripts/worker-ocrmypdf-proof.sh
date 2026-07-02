#!/usr/bin/env sh
# pdf.xyz secure-worker — DETERMINISTIC OCRmyPDF searchable-PDF PROOF (synthetic only).
#
# Proves the packaged OCRmyPDF path can turn an IMAGE-ONLY PDF into a structurally
# valid SEARCHABLE PDF end-to-end, using a tiny generated fixture and NO user
# document, cloud service, secret, queue, store, or scanner. It is the PDF→PDF
# counterpart of the image→PDF Tesseract recognition proof:
#
#   * scripts/worker-engines.sh      — are the engines on PATH? (node-free preflight)
#   * scripts/worker-image-smoke.sh  — engines + English data installed; does opting
#                                      into OCR flip readiness? (presence)
#   * scripts/worker-ocr-proof.sh    — does the Tesseract baseline turn a RASTER of
#                                      known text into a searchable PDF + sidecar, and
#                                      is the sentinel recognized? (image→PDF behavior)
#   * scripts/worker-ocrmypdf-proof.sh — THIS script: does OCRmyPDF turn an IMAGE-ONLY
#                                      PDF into a genuinely SEARCHABLE PDF, proven by
#                                      extracting the sentinel from the OUTPUT (and NOT
#                                      the input) with pdftotext? (PDF→PDF behavior)
#
# What it does, deterministically:
#   1. Renders a fixed, in-script sentinel word to an IMAGE-ONLY PDF with Ghostscript's
#      pdfimage device (each page is a raster — NO text layer), in an isolated temp dir.
#   2. IMAGE-ONLY check: pdftotext extracts NO sentinel from the source PDF — confirming
#      there is no selectable text layer to begin with, so any later hit is real OCR.
#   3. Runs OCRmyPDF over the image-only PDF by ARGV (no shell, no interpolation of any
#      external value), with the same option shape the native runner uses, to produce a
#      searchable PDF + a text sidecar.
#   4. STRUCTURAL checks: the output PDF exists and begins with the %PDF- marker; the
#      sidecar exists and is non-empty.
#   5. SEARCHABILITY check: pdftotext extracts the sentinel from the OUTPUT PDF —
#      proving OCRmyPDF added a real, selectable text layer (image-only → searchable).
#   6. SIDECAR check: the sidecar, normalized (letters/digits only, upper-cased),
#      CONTAINS the sentinel — corroborating recognition. Text is NEVER printed.
#
# Honesty & privacy by construction:
#   * The fixture is a fixed literal in THIS script — never a user document.
#   * Output is presence-only and content-free: it prints ok/FAIL labels only, never a
#     temp path, a filename, a command path, an env value, or any recognized text.
#   * The temp dir is ALWAYS removed — on success, failure, or signal (an EXIT trap).
#   * It proves the OCRmyPDF searchable-PDF path only. It does NOT prove production OCR
#     quality, non-English language packs, or anything about real user documents/traffic.
#     See docs/OCR_BACKEND.md.
#
# Meant to run INSIDE the built worker image (wired as `pnpm worker:ocrmypdf-proof`,
# invoked by the container workflow after the Tesseract recognition proof). It
# deliberately reports a missing engine as a prerequisite failure (exit 2) rather than
# faking a result, so it is NOT part of the Docker-free PR gate.
#
# Exit codes:
#   0  the proof passed (image-only source + structural + searchability checks all held).
#   1  usage error (an unknown flag).
#   2  a prerequisite tool (Ghostscript, OCRmyPDF, or pdftotext) is not installed here,
#      so the proof cannot run — honest "cannot prove", never a faked pass.
#   3  the proof RAN but a check failed (source not image-only, no/invalid output PDF,
#      the output was not searchable, or the sidecar lacked the sentinel). A genuine
#      failure of the packaged path.
set -u

for arg in "$@"; do
  case "$arg" in
    -h | --help)
      sed -n '2,56p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'worker ocrmypdf proof: unknown argument: %s\n' "$arg" >&2
      printf 'usage: worker:ocrmypdf-proof [--help]\n' >&2
      exit 1
      ;;
  esac
done

# The expected sentinel. A fixed, in-script literal (all upper-case, no ambiguous
# glyphs) — never derived from any external input. It is rendered into the fixture AND
# checked for after OCR, so the two can never drift apart.
SENTINEL='OCRPROOF'

fail=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; fail=1; }

# Presence only: resolve on PATH but never echo the resolved path.
have() { command -v "$1" >/dev/null 2>&1; }

# Does a PDF file contain the sentinel as SELECTABLE text? Extract with pdftotext,
# normalize to letters/digits only + upper-case, and fixed-string match. Quiet by
# construction: the extracted text is piped straight to grep and NEVER printed.
pdf_has_sentinel() { # pdf_has_sentinel <pdf-path>
  pdftotext "$1" - 2>/dev/null | tr -cd 'A-Za-z0-9' | tr 'a-z' 'A-Z' | grep -qF "$SENTINEL"
}

echo "worker ocrmypdf proof — prerequisites (tools must be installed to prove searchability):"
missing=0
if have gs; then ok "Ghostscript (gs) is installed"; else bad "Ghostscript (gs) is installed"; missing=1; fi
if have ocrmypdf; then ok "OCRmyPDF (ocrmypdf) is installed"; else bad "OCRmyPDF (ocrmypdf) is installed"; missing=1; fi
if have pdftotext; then ok "pdftotext (poppler-utils) is installed"; else bad "pdftotext (poppler-utils) is installed"; missing=1; fi
if [ "$missing" -ne 0 ]; then
  echo "worker ocrmypdf proof: prerequisite tool missing — cannot prove searchability here"
  exit 2
fi

# Isolated, worker-owned temp dir for the whole proof. ALWAYS removed on exit (success,
# failure, or signal) so no fixture, PDF, or sidecar outlives the run. The path is held
# only in a variable and never printed.
workdir=$(mktemp -d "${TMPDIR:-/tmp}/pdfxyz-ocrmypdf-proof.XXXXXX") || {
  echo "worker ocrmypdf proof: could not create a temp directory"
  exit 3
}
trap 'rm -rf "$workdir"' EXIT INT TERM HUP

ps="$workdir/fixture.ps"
pdf_in="$workdir/source.pdf"
pdf_out="$workdir/searchable.pdf"
sidecar="$workdir/sidecar.txt"

echo "worker ocrmypdf proof — synthetic fixture (an image-only PDF of known text, no text layer):"
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

# Rasterize the PostScript into an IMAGE-ONLY PDF with Ghostscript's pdfimage device:
# every page becomes a single raster image at a fixed resolution, so the PDF carries NO
# text layer — recognizing the sentinel from it later is genuine OCR. `-dSAFER`
# restricts file access; output is discarded so no path is ever echoed.
if gs -q -dNOPAUSE -dBATCH -dSAFER -sDEVICE=pdfimage24 -r300 -sOutputFile="$pdf_in" "$ps" >/dev/null 2>&1 \
  && [ -s "$pdf_in" ]; then
  ok "fixture rasterized into an image-only PDF"
else
  bad "fixture rasterized into an image-only PDF"
fi

echo "worker ocrmypdf proof — the source PDF has no selectable text (must be image-only):"
# If pdftotext can already extract the sentinel, the source is NOT image-only and the
# later searchability hit would be meaningless. Assert the source is text-free — and
# treat a MISSING source as a failure (never a spurious pass), so this line only ever
# reads "ok" when a real, existing PDF was confirmed to carry no selectable text.
if [ ! -s "$pdf_in" ]; then
  bad "a source PDF exists to verify it is image-only"
elif pdf_has_sentinel "$pdf_in"; then
  bad "the source PDF has no selectable sentinel text (is image-only)"
else
  ok "the source PDF has no selectable sentinel text (is image-only)"
fi

echo "worker ocrmypdf proof — OCRmyPDF searchable-PDF conversion (image-only PDF → searchable PDF + text):"
# Invoke OCRmyPDF by ARGV (no shell string, no eval), mirroring the native runner's
# option shape: language, a plain-PDF output type, a text sidecar, quiet, then the
# input and output PDFs as SEPARATE argv elements (never concatenated). Output is
# discarded (OCRmyPDF writes progress to stderr).
ocrmypdf --language eng --output-type pdf --sidecar "$sidecar" --quiet "$pdf_in" "$pdf_out" >/dev/null 2>&1 \
  || bad "ocrmypdf completed without error"

# STRUCTURAL: the searchable PDF exists, is non-empty, and begins with the PDF marker.
# The header is captured into a variable and compared — never printed.
if [ -s "$pdf_out" ]; then
  header=$(head -c 5 "$pdf_out" 2>/dev/null)
  case "$header" in
    "%PDF-"*) ok "a searchable PDF was produced (structurally plausible)" ;;
    *) bad "the produced PDF begins with the %PDF- marker" ;;
  esac
else
  bad "a searchable PDF was produced (structurally plausible)"
fi

# STRUCTURAL: the text sidecar exists and is non-empty.
if [ -s "$sidecar" ]; then
  ok "a non-empty text sidecar was produced"
else
  bad "a non-empty text sidecar was produced"
fi

echo "worker ocrmypdf proof — searchability (the sentinel is extractable from the OUTPUT PDF, never printed):"
# SEARCHABILITY: pdftotext extracts the sentinel from the OUTPUT PDF's text layer.
# Because the SAME tool extracted nothing from the (image-only) input above, a hit here
# proves OCRmyPDF added a real, selectable text layer — image-only became searchable.
if [ -f "$pdf_out" ] && pdf_has_sentinel "$pdf_out"; then
  ok "the output PDF is searchable (the sentinel is extractable)"
else
  bad "the output PDF is searchable (the sentinel is extractable)"
fi

echo "worker ocrmypdf proof — sidecar recognition (bounded check; recognized text is never printed):"
# CORROBORATION: the OCRmyPDF sidecar, normalized to letters/digits and upper-cased,
# CONTAINS the sentinel. `grep -qF` is quiet + fixed-string, so nothing is printed.
if [ -f "$sidecar" ] \
  && tr -cd 'A-Za-z0-9' < "$sidecar" | tr 'a-z' 'A-Z' | grep -qF "$SENTINEL"; then
  ok "the sidecar corroborates recognition of the sentinel"
else
  bad "the sidecar corroborates recognition of the sentinel"
fi

# The temp dir (fixture, PDFs, sidecar) is removed by the EXIT trap regardless of the
# outcome below.
if [ "$fail" -ne 0 ]; then
  echo "worker ocrmypdf proof: FAILED"
  exit 3
fi
echo "worker ocrmypdf proof: all checks passed (synthetic OCRmyPDF searchable-PDF proven)"

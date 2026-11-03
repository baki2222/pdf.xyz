#!/usr/bin/env bash
# Install the dispatch token on the worker host, then start one run and show
# the answer. Installed as /usr/local/sbin/pdfxyz-set-dispatch-token; the
# owner runs it over SSH:
#
#   ssh -t root@13.140.139.65 pdfxyz-set-dispatch-token
#
# The token is read with echo off, so it never reaches a screen, a shell
# history, or a process list, and is written root-only. Only its length is
# printed back.
set -euo pipefail

TOKEN_FILE="${PDFXYZ_DISPATCH_TOKEN_FILE:-/etc/pdfxyz/posture-dispatch.token}"

read -r -s -p "Paste the GitHub token, then press Enter: " token
echo
token="$(printf '%s' "$token" | tr -d '[:space:]')"
if [[ ! "$token" =~ ^[A-Za-z0-9_]{20,}$ ]]; then
  echo "That does not look like a GitHub token (${#token} characters) — nothing saved."
  exit 1
fi

install -d -m 700 "$(dirname "$TOKEN_FILE")"
(
  umask 077
  printf '%s\n' "$token" >"$TOKEN_FILE.new"
)
mv -f "$TOKEN_FILE.new" "$TOKEN_FILE"
echo "Saved the token (${#token} characters)."

systemctl enable --now pdfxyz-posture-dispatch.timer
# One run now, so the answer is on this screen rather than in 20 minutes.
systemctl start pdfxyz-posture-dispatch.service || true
journalctl -u pdfxyz-posture-dispatch.service -n 1 --no-pager -o cat

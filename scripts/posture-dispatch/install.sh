#!/usr/bin/env bash
# Install (or update) the posture-watch dispatcher on the worker host. Run as
# root from a copy of this directory:
#
#   scp -r scripts/posture-dispatch root@13.140.139.65:/tmp/
#   ssh root@13.140.139.65 bash /tmp/posture-dispatch/install.sh
#
# Idempotent. The timer is enabled only once a token is installed
# (pdfxyz-set-dispatch-token does both), so a fresh install starts nothing.
set -euo pipefail
cd "$(dirname "$0")"

install -D -m 755 dispatch.sh /usr/local/lib/pdfxyz/posture-dispatch.sh
install -D -m 755 set-token.sh /usr/local/sbin/pdfxyz-set-dispatch-token
install -m 644 pdfxyz-posture-dispatch.service pdfxyz-posture-dispatch.timer /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/pdfxyz-posture-dispatch.service /etc/systemd/system/pdfxyz-posture-dispatch.timer
systemctl daemon-reload

if [[ -s /etc/pdfxyz/posture-dispatch.token ]]; then
  systemctl enable --now pdfxyz-posture-dispatch.timer
  echo "installed; token present, timer enabled"
else
  echo "installed; no token yet — run pdfxyz-set-dispatch-token"
fi
systemctl list-timers pdfxyz-posture-dispatch.timer --all --no-pager

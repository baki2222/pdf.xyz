#!/usr/bin/env bash
# Start one posture-watch run on GitHub from OUTSIDE GitHub's scheduler.
# Installed on the worker host as /usr/local/lib/pdfxyz/posture-dispatch.sh
# and run by pdfxyz-posture-dispatch.timer (see README.md beside this file).
#
# ── WHY ─────────────────────────────────────────────────────────────────────
#
# GitHub's `schedule` trigger is best-effort, and for this repository it
# stopped being close to reliable: 24 of 24 hourly runs on 2026-10-30 and
# 2026-10-31, then 8 of 37 from 2026-11-01 00:00 to 2026-11-02 13:00 UTC.
# Going to three cron slots an hour then bought nothing — 3 runs in the 26
# hours to 2026-11-03 16:30 UTC — so the runs are not dropped one slot at a
# time and more slots are not the fix. A `workflow_dispatch` through the API
# has started every run asked of it, so this host asks, on a systemd timer.
#
# ── THE TOKEN ───────────────────────────────────────────────────────────────
#
# A fine-grained GitHub token for this one repository with Actions read and
# write: enough to start a workflow, nothing else. systemd hands it over as a
# credential ($CREDENTIALS_DIRECTORY/token); it reaches curl on STDIN, never
# on a command line, so it is not in a process list, and nothing prints it.
# Only the HTTP status is printed.
#
# Exit: 0 when the run was started (HTTP 204) or no token is installed yet
# (it says so); 1 otherwise, so the journal and `systemctl status` show it. A
# run that never starts is also seen from outside: the dead-man's switch at
# the end of the workflow stops being pinged.
set -euo pipefail

REPO="baki2222/pdf.xyz"
WORKFLOW="posture-watch.yml"
API="${PDFXYZ_GITHUB_API:-https://api.github.com}"
TOKEN_FILE="${CREDENTIALS_DIRECTORY:+$CREDENTIALS_DIRECTORY/token}"
TOKEN_FILE="${TOKEN_FILE:-${PDFXYZ_DISPATCH_TOKEN_FILE:-/etc/pdfxyz/posture-dispatch.token}}"

if [[ ! -s "$TOKEN_FILE" ]]; then
  echo "posture-dispatch: no token installed — nothing dispatched"
  exit 0
fi

token="$(tr -d '[:space:]' <"$TOKEN_FILE")"
# GitHub tokens are [A-Za-z0-9_]. Anything else would also break out of the
# quoted curl config line below, so refuse it rather than send it.
if [[ ! "$token" =~ ^[A-Za-z0-9_]{20,}$ ]]; then
  echo "posture-dispatch: the token file does not hold a GitHub token (${#token} characters) — nothing dispatched"
  exit 1
fi

status="$(
  printf 'header = "Authorization: Bearer %s"\n' "$token" |
    curl --silent --show-error --config - \
      --max-time 20 --retry 3 --retry-delay 5 --retry-connrefused \
      --output /dev/null --write-out '%{http_code}' \
      --request POST \
      --header 'Accept: application/vnd.github+json' \
      --header 'X-GitHub-Api-Version: 2022-11-28' \
      --header 'Content-Type: application/json' \
      --data '{"ref":"main"}' \
      "$API/repos/$REPO/actions/workflows/$WORKFLOW/dispatches"
)" || true
status="${status:-000}"

if [[ "$status" == "204" ]]; then
  echo "posture-dispatch: started $WORKFLOW on main → HTTP 204"
  exit 0
fi

case "$status" in
  401) why="the token expired or was revoked — README.md says how to replace it" ;;
  403 | 404) why="the token cannot start workflows in $REPO (needs Actions: read and write)" ;;
  000) why="GitHub could not be reached" ;;
  *) why="unexpected answer" ;;
esac
echo "posture-dispatch: not started → HTTP $status ($why)"
exit 1

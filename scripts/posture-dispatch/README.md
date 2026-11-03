# posture-dispatch — start the posture watch from outside GitHub

`.github/workflows/posture-watch.yml` checks the fleet, the public site and the
backup, then pings a dead-man's switch (healthchecks.io). It needs something to
**start** it, and GitHub's `schedule` trigger can't be trusted with that job. It
ran 24 of 24 hourly runs on 2026-10-30 and 2026-10-31, then 8 of 37 from
2026-11-01 00:00 to 2026-11-02 13:00 UTC. Three cron slots an hour then gave 3
runs in 26 hours, so adding slots doesn't fix it.

This directory holds the primary trigger. It is a systemd timer on the worker
host (13.140.139.65) that starts the workflow through `workflow_dispatch` at
:02, :22 and :42 UTC. The workflow's own cron stays as a fallback. When neither
trigger starts a run, the dead-man's switch stops being pinged and healthchecks.io
emails the owner.

The timer lives on the worker host, not the web host, for one reason. If the
**site** goes down, the watch still runs and names the failure ("public surface")
instead of going quiet. If the worker host itself dies, the runs stop and the
dead-man's switch reports that instead.

## Files

| file                              | installed as                                    |
| --------------------------------- | ----------------------------------------------- |
| `dispatch.sh`                     | `/usr/local/lib/pdfxyz/posture-dispatch.sh`     |
| `set-token.sh`                    | `/usr/local/sbin/pdfxyz-set-dispatch-token`     |
| `pdfxyz-posture-dispatch.service` | `/etc/systemd/system/` (oneshot, `DynamicUser`) |
| `pdfxyz-posture-dispatch.timer`   | `/etc/systemd/system/` (every 20 minutes)       |
| `install.sh`                      | run once from a copy of this directory          |

The token itself is stored at `/etc/pdfxyz/posture-dispatch.token` (root-only).
The service reads it as a systemd credential and passes it to curl on stdin, so
it never shows up in a process list or a log line.

## The token (owner)

The token is a **fine-grained** personal access token. Create one at
<https://github.com/settings/personal-access-tokens/new> with these settings:

- **Repository access:** only `baki2222/pdf.xyz`.
- **Repository permissions:** **Actions → Read and write**. Nothing else is needed.
  Metadata is added automatically.
- **Expiration:** up to a year.

When it expires, every dispatch gets HTTP 401 and the runs fall back to GitHub's
cron. Within hours the dead-man's switch emails you. Make a new token and install
it the same way.

To install it, run this and paste the token when asked:

```bash
ssh -t root@13.140.139.65 pdfxyz-set-dispatch-token
```

The command shows nothing as you paste. It saves the token, turns on the timer,
starts one run, and prints the result, for example
`started posture-watch.yml on main → HTTP 204`.

## Operating it

- `systemctl list-timers pdfxyz-posture-dispatch.timer` shows the next and the
  last start.
- `journalctl -u pdfxyz-posture-dispatch.service -n 20 -o cat` prints one line
  per start, with an HTTP status and nothing else.
- Started runs appear under the workflow's runs as `workflow_dispatch` events.

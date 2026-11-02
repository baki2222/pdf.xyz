/**
 * Tell an outside dead-man's switch that the posture watch RAN, and how it
 * ended — the last step of `.github/workflows/posture-watch.yml`.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * The watch's only alarm was GitHub emailing the owner when a scheduled run
 * fails. That alarm lives INSIDE the scheduler it depends on, so it cannot
 * report the scheduler stopping — the same reason `check-backup-freshness.mjs`
 * reads the bucket instead of trusting Coolify's notifier. And it happened:
 * the hourly schedule ran 24 of 24 on 2026-10-30 and 2026-10-31, then 8 of 37
 * from 2026-11-01 00:00 to 2026-11-02 13:00 UTC, every one that ran green,
 * with no CI load to explain it. A red fleet in one of the 29 silent hours
 * would have reached nobody.
 *
 * healthchecks.io (owner's choice, 2026-11-02) emails when a ping does not
 * arrive in time, or when one arrives on `/fail`. So both halves are covered
 * from outside: the checks failing, and the checks not running at all.
 *
 * ── WHAT IT SENDS ───────────────────────────────────────────────────────────
 *
 * A GET to the check's ping URL (`HEALTHCHECK_PING_URL`, a repository secret)
 * on success, or to `<url>/fail` when any earlier step failed (`JOB_STATUS`,
 * the workflow's `job.status`). Nothing about the site or its users travels in
 * it. The URL is never printed: anyone holding it can mark the check up.
 *
 * With no secret configured it says so and exits 0 — the switch is optional
 * wiring, and the watch's own result is what decides the job.
 */

import { pathToFileURL } from "node:url";

/**
 * The URL to ping for this run, or null when no switch is configured.
 * `status` is `job.status`: anything but "success" is a failure to report.
 */
export function pingTarget(base, status) {
  const url = (base ?? "").trim();
  if (!url) return null;
  return status === "success" ? url : `${url.replace(/\/+$/, "")}/fail`;
}

async function main() {
  const status = process.env.JOB_STATUS ?? "";
  const target = pingTarget(process.env.HEALTHCHECK_PING_URL, status);
  if (!target) {
    console.log(
      "dead-man's switch: HEALTHCHECK_PING_URL is not set — nothing pinged",
    );
    return;
  }
  const kind = target.endsWith("/fail") ? "fail" : "success";
  // A few attempts: a lost ping reads to the switch as a run that never
  // happened, which is exactly the alarm this exists to raise falsely.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(target, {
        signal: AbortSignal.timeout(10_000),
      });
      console.log(
        `dead-man's switch: pinged ${kind} (job ${status || "unknown"}) → HTTP ${response.status}`,
      );
      if (response.ok) return;
    } catch (error) {
      console.log(
        `dead-man's switch: attempt ${attempt} failed (${error?.name ?? "error"})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
  }
  // Not fatal: the job's own steps decide whether this run is red. A switch
  // that missed this ping will say so itself when the period runs out.
  console.log("::warning::dead-man's switch could not be pinged");
}

// Run only when executed (`node scripts/ping-dead-mans-switch.mjs`), not when
// a test imports `pingTarget`.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}

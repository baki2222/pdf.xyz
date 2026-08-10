#!/usr/bin/env node
/**
 * Watch the deployed operations posture and FAIL LOUDLY when it is not ok.
 *
 * Runs on a schedule from .github/workflows/posture-watch.yml. A failed
 * scheduled workflow emails the repository owner, which is the destination —
 * no new service, no secret, no mail configuration, and a channel a human
 * already reads.
 *
 * ── IT REPORTS, IT DOES NOT DECIDE ───────────────────────────────────────────
 * The trigger reads `health` and `alerts.severity`, which the payload has
 * ALREADY COMPUTED. It never re-derives a verdict from the subsystem rows. Two
 * reasons, and the second is the one that is easy to miss:
 *
 *  1. A verdict rule written here would be a second source of truth, and it
 *     would drift from `evaluateOperationsAlerts` the first time the alert
 *     vocabulary changed. Then there are two answers and no way to choose.
 *  2. It would CRY WOLF FROM DAY ONE. On the calibration payload below, five of
 *     the six not-ok subsystems are permanently `unknown` — "not observable
 *     from this vantage", a legitimate steady state. A rule of "fail if any row
 *     is not ok" fires forever and is switched off within a week.
 *
 * The rows are used for the MESSAGE only, filtered to `warn` or worse, quoted
 * verbatim. It says what is wrong; it does not form an opinion about it.
 *
 * ── FAILING CLOSED ───────────────────────────────────────────────────────────
 * Unreachable, non-200, or unparseable is `unknown`, and `unknown` FAILS. A
 * curl timeout reporting success is the fail-open shape this programme has
 * removed twice. An unrecognised payload `version` also fails: a schema change
 * that renamed `health` would otherwise make every run pass silently, which is
 * the watcher's own version of the silent zero.
 *
 * ── FRESHNESS ────────────────────────────────────────────────────────────────
 * /status renders per request; this runs hourly. If a subsystem degrades at
 * 12:05 a visitor sees it at 12:06 and this email arrives at 13:00. A green
 * dashboard beside a red email an hour apart is EXPECTED, not a broken watcher.
 * Hourly is deliberate: the states this catches persist until someone acts, so
 * a tighter schedule buys nothing and burns Actions minutes.
 *
 * ── CALIBRATED AGAINST (2026-08-10) ──────────────────────────────────────────
 * Production, immediately after the headline-fold fix went live:
 *
 *   health                : warn
 *   alerts.severity       : warn
 *   recommendedAction     : enable-per-client-identity
 *   rateLimit.code        : remote-configured-shared  (enforced/distributed true)
 *   subsystems not ok     : 6 — five permanently `unknown`, exactly ONE `warn`
 *                           (rate-limit)
 *
 * On that payload this script must FAIL, and its message must name the
 * rate-limit row ALONE. That is the calibration test, and it exercises the
 * filter rather than only the happy path.
 *
 * If you are changing the trigger: re-validate against a payload that is
 * telling the truth. A watcher calibrated against a broken production learns
 * the wrong normal and then stays green through the thing it exists to catch —
 * which is exactly what would have happened had this shipped a day earlier,
 * when `health` stayed `ok` while carrying a warn row.
 *
 * Do NOT gate this on client-asset fingerprints. A server-only change does not
 * move the chunk hashes, so a fingerprint discriminator reports "not deployed"
 * for a deploy that already succeeded.
 */

const URL_ARG =
  process.argv[2] ??
  process.env.POSTURE_URL ??
  "https://pdf.xyz/api/worker/operations";

/** Payload schema versions this script knows how to read. */
const KNOWN_VERSIONS = [2];

const TIMEOUT_MS = 20_000;

/**
 * Print and exit non-zero.
 *
 * Sets `exitCode` and throws rather than calling `process.exit()`: exiting
 * synchronously from inside a rejected fetch's handler tears down handles that
 * are still closing, which on Windows aborts with a libuv assertion and exit
 * 127. A crash and a detection both "fail", so CI would still go red — but 127
 * means "command not found" to anyone reading it, and an aborted process is not
 * guaranteed to have flushed the message that says WHY. The whole point of this
 * check is the message.
 */
function fail(lines) {
  for (const line of lines) console.error(line);
  process.exitCode = 1;
  throw new PostureFailure();
}

class PostureFailure extends Error {
  name = "PostureFailure";
}

// The message above is the deliverable; a stack trace under it is noise that
// makes a clear report look like a crash. Exit with the code `fail()` set.
process.on("uncaughtException", (err) => {
  if (!(err instanceof PostureFailure)) throw err;
  // Swallow it and let the process END NATURALLY with the exit code `fail()`
  // set. Calling process.exit() here tears down the fetch socket while it is
  // still closing, which aborts with a libuv assertion and exit 127 — a crash
  // wearing a detection's clothes.
});

const res = await fetch(URL_ARG, {
  headers: { accept: "application/json" },
  signal: AbortSignal.timeout(TIMEOUT_MS),
}).catch((err) => {
  if (err instanceof PostureFailure) throw err;
  fail([
    `UNKNOWN — could not reach ${URL_ARG}`,
    `  ${err instanceof Error ? err.message : String(err)}`,
    "  Unreachable is not healthy. Check the deployment and the worker.",
  ]);
});

if (!res.ok) {
  fail([
    `UNKNOWN — ${URL_ARG} answered HTTP ${res.status}`,
    "  A non-200 tells us nothing about the posture, so it is not a pass.",
  ]);
}

let body;
try {
  body = await res.json();
} catch (err) {
  fail([
    `UNKNOWN — ${URL_ARG} did not return parseable JSON`,
    `  ${err instanceof Error ? err.message : String(err)}`,
  ]);
}

// The route wraps its payload; tolerate both shapes without guessing further.
const snap =
  body && typeof body === "object" && "data" in body ? body.data : body;

if (!snap || typeof snap !== "object") {
  fail(["UNKNOWN — the response carried no snapshot object"]);
}

if (!KNOWN_VERSIONS.includes(snap.version)) {
  fail([
    `UNKNOWN — snapshot version ${JSON.stringify(snap.version)} is not one this ` +
      `check knows (${KNOWN_VERSIONS.join(", ")})`,
    "  The schema moved. Re-read the payload and re-validate the trigger before",
    "  trusting this check again — an unrecognised shape must never pass quietly.",
  ]);
}

const health = snap.health;
const severity = snap.alerts?.severity;

/** Rows worth telling a human about. `unknown` is a steady state, not a fault. */
const degraded = (Array.isArray(snap.subsystems) ? snap.subsystems : []).filter(
  (row) => row?.health === "warn" || row?.health === "blocked",
);

const healthBad = health !== "ok";
const severityBad = severity === "warn" || severity === "critical";

if (!healthBad && !severityBad) {
  console.log(`ok — health=${health} severity=${severity ?? "none"}`);
  process.exit(0);
}

fail([
  `pdf.xyz operations posture is NOT ok`,
  ``,
  `  health            : ${health}`,
  `  alerts.severity   : ${severity ?? "none"}`,
  `  recommendedAction : ${snap.recommendedAction ?? "none"}`,
  `  ${snap.recommendedActionDetail ?? ""}`,
  ``,
  degraded.length
    ? `  Degraded subsystems (${degraded.length}):`
    : `  No subsystem row is warn or worse — the overall verdict is degraded for` +
      ` another reason; open the payload.`,
  ...degraded.map(
    (row) => `    - ${row.id} = ${row.health}: ${row.detail ?? ""}`,
  ),
  ``,
  `  Source: ${URL_ARG}`,
]);

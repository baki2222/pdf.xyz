/**
 * Is there a FRESH backup in the bucket? — the third scheduled check.
 *
 * ── WHY THIS AND NOT COOLIFY'S OWN NOTIFICATION ─────────────────────────────
 *
 * Coolify can email or Telegram on a failed backup, and that would be the
 * obvious answer. It is also the weaker one, for the reason this codebase keeps
 * relearning: a notifier INSIDE the thing being watched cannot report the
 * failure mode where the thing stops running. If Coolify's scheduler dies, the
 * container is recreated without its cron, the S3 credential is revoked, or the
 * dump writes zero bytes — each is a night with no backup and no notification,
 * because nothing failed; nothing ran.
 *
 * So this asks THE QUESTION A RESTORE WOULD ASK, from outside, at the point of
 * consumption: is there an object in the bucket, dated recently, big enough to
 * be a real dump? That is the property. "The backup job reported success" is
 * the mechanism, and CLAUDE.md rule 2 is about exactly that distinction.
 *
 * Delivery matches its two siblings: GitHub emails the owner when a scheduled
 * workflow fails. No new service, no new inbox, no new subprocessor.
 *
 * ── THE CREDENTIAL ──────────────────────────────────────────────────────────
 *
 * `R2_BACKUP_KEY_ID` / `R2_BACKUP_SECRET` are an R2 token scoped to OBJECT READ
 * ONLY on this one bucket: it cannot write, cannot delete, cannot list other
 * buckets, and cannot reach `pdfxyz-prod`. A watcher able to damage what it
 * watches is a worse trade than no watcher.
 *
 * SigV4 is hand-rolled over `node:crypto` so the workflow keeps its no-install
 * contract — an npm failure must never be able to masquerade as a missing
 * backup.
 */

import { createHash, createHmac } from "node:crypto";

const ENDPOINT = process.env.R2_BACKUP_ENDPOINT ?? "";
const BUCKET = process.env.R2_BACKUP_BUCKET ?? "";
const KEY_ID = process.env.R2_BACKUP_KEY_ID ?? "";
const SECRET = process.env.R2_BACKUP_SECRET ?? "";

/**
 * The backup runs daily at 00:00. 36 hours makes one missed night loud while a
 * late run plus clock skew stays quiet — the alarm fires on a real gap, not on
 * a schedule that drifted twenty minutes.
 */
const MAX_AGE_HOURS = 36;

/**
 * A pg_dump of this instance is ~1.8 MB. 100 KB sits far below that and far
 * above an empty or truncated file, so "the job wrote something" cannot pass as
 * "the job wrote a backup" — the shape of every silent-failure bug here.
 */
const MIN_BYTES = 100_000;

/** The prefix Coolify writes instance dumps under. */
const PREFIX = "data/coolify/backups/";

class BackupFailure extends Error {
  name = "BackupFailure";
}

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exitCode = 1;
  throw new BackupFailure();
}

// Same rationale as its siblings: end naturally so the message flushes rather
// than tearing down a closing socket with process.exit().
process.on("uncaughtException", (err) => {
  if (!(err instanceof BackupFailure)) throw err;
});

if (!ENDPOINT || !BUCKET || !KEY_ID || !SECRET) {
  // Names only — never a value, and never a length, which is a fingerprint.
  const missing = [
    ["R2_BACKUP_ENDPOINT", ENDPOINT],
    ["R2_BACKUP_BUCKET", BUCKET],
    ["R2_BACKUP_KEY_ID", KEY_ID],
    ["R2_BACKUP_SECRET", SECRET],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  fail([
    `CONFIG — the backup watcher cannot run: ${missing.join(", ")} unset.`,
    "  An unrunnable watcher is not a passing watcher. It is silence, which is",
    "  the state it exists to end.",
  ]);
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();

/** Minimal SigV4 for one GET. Service `s3`, region `auto` (R2's). */
function signedHeaders(url, now) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const region = "auto";
  const service = "s3";
  const payloadHash = sha256("");

  const canonicalHeaders =
    `host:${url.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaderList = "host;x-amz-content-sha256;x-amz-date";

  // Canonical query: sorted by key, RFC3986-encoded. `URLSearchParams` encodes
  // to form rules, which differ on a handful of characters; the prefix here
  // contains none of them, but the difference is a signature mismatch rather
  // than a wrong answer, so it is handled instead of assumed away.
  const rfc3986 = (value) =>
    encodeURIComponent(value).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  const query = [...url.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
    .join("&");

  const canonicalRequest = [
    "GET",
    url.pathname,
    query,
    canonicalHeaders,
    signedHeaderList,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${SECRET}`, dateStamp), region), service),
    "aws4_request",
  );
  const signature = hmac(signingKey, stringToSign).toString("hex");

  return {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${KEY_ID}/${scope}, ` +
      `SignedHeaders=${signedHeaderList}, Signature=${signature}`,
  };
}

const now = new Date();
const url = new URL(`${ENDPOINT.replace(/\/+$/, "")}/${BUCKET}`);
url.searchParams.set("list-type", "2");
url.searchParams.set("prefix", PREFIX);
url.searchParams.set("max-keys", "1000");

const res = await fetch(url, {
  headers: signedHeaders(url, now),
  signal: AbortSignal.timeout(20_000),
}).catch((err) => {
  if (err instanceof BackupFailure) throw err;
  fail([
    `UNREACHABLE — could not list ${BUCKET}`,
    `  ${err instanceof Error ? err.message : String(err)}`,
  ]);
});

const body = await res.text();
if (!res.ok) {
  fail([
    `LIST FAILED — the bucket answered HTTP ${res.status}`,
    // R2's XML error carries a code and message and no credential; without it
    // "it failed" is unactionable at 3am.
    `  ${body.slice(0, 300).replace(/\s+/g, " ")}`,
  ]);
}

const objects = [...body.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(
  (match) => {
    const chunk = match[1];
    const pick = (tag) =>
      (chunk.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) ?? [])[1] ?? "";
    return {
      key: pick("Key"),
      size: Number(pick("Size")),
      modified: new Date(pick("LastModified")),
    };
  },
);

if (objects.length === 0) {
  fail([
    `NO BACKUP — nothing under ${PREFIX} in ${BUCKET}`,
    "  Either the scheduled backup has never run, or it stopped writing here.",
    "  Check Coolify → Settings → Backup and the S3 destination it points at.",
  ]);
}

const newest = objects.reduce((a, b) => (a.modified > b.modified ? a : b));
const ageHours = (now.getTime() - newest.modified.getTime()) / 3_600_000;
const stale = ageHours > MAX_AGE_HOURS;
const tiny = newest.size < MIN_BYTES;

if (stale || tiny) {
  fail([
    "Coolify's instance backup is NOT current",
    "",
    `  newest object   : ${newest.key}`,
    `  its size        : ${newest.size.toLocaleString()} bytes` +
      (tiny ? `  ← under the ${MIN_BYTES.toLocaleString()} floor` : ""),
    `  last written    : ${newest.modified.toISOString()}` +
      (stale ? `  ← ${ageHours.toFixed(1)}h ago, limit ${MAX_AGE_HOURS}h` : ""),
    `  objects present : ${objects.length}`,
    "",
    "  Losing that disk without a current dump means rebuilding every deploy",
    "  definition and every environment variable by hand.",
  ]);
}

console.log(
  `ok — newest backup ${newest.size.toLocaleString()} bytes, ` +
    `${ageHours.toFixed(1)}h old (${objects.length} kept)`,
);

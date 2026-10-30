/**
 * How long our job queue keeps what it holds — the job record, what a tool's
 * user typed, a password — and the copy a deletion does not reach: the
 * queue's on-disk journal.
 *
 * WHY THE JOURNAL IS IN EVERY SENTENCE (review, 2026-10-10). The queue is a
 * self-hosted Redis 7 with append-only persistence on the web server
 * (`docs/RATE_LIMITING.md`: `--appendonly yes`). A key the queue DELETEs at
 * FINALIZE, or lets expire at its TTL, leaves the store at once and stays in
 * the append-only file until that file is next rewritten (compacted). Redis
 * rewrites on growth, not on a clock, and how production is configured is
 * not recorded in this repository (the Art. 30 record: "AOF rewrite policy …
 * owner to confirm") — so a quiet store can keep a deleted password, signer
 * address or question on disk for an unbounded time. The 2026-10-10 copy said
 * the queue keeps them "only until the job ends"; true of the store, false of
 * the disk. Until a rewrite interval is ENFORCED and recorded here as a
 * figure, every sentence that says how long the queue keeps something says
 * the journal can keep a copy until it is compacted, with no number.
 * `privacy-truth.test.tsx` requires it of every such block on /privacy, and
 * `legal-pages.test.ts` bans "only until the job ends".
 *
 * NOT SAID: that the password is stored sealed. It is in production (sealing
 * live since 2026-10-09, observed at the wire), but only because the web tier
 * is given a public key — with none, the code writes it in plaintext, and no
 * guard makes a deployment without the key refuse. A sentence true only of a
 * configuration is not said by a page that cannot read it.
 *
 * A leaf: its one import has only type imports beneath it, so the
 * Protect/Unlock panel renders its sentence without the policy registries.
 *
 * Copy: walked by `copyFiles()` (`src/lib/privacy`).
 */
import { DEFAULT_JOB_TTL_SECONDS } from "@/lib/workers/queue/redis-config";

/** `n` and its unit, singular when `n` is 1 — "1 day", "24 hours". */
function quantity(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** A seconds TTL in the largest whole unit that states it exactly. */
function secondsWindow(seconds: number): string {
  if (seconds % 3600 === 0) return quantity(seconds / 3600, "hour");
  if (seconds % 60 === 0) return quantity(seconds / 60, "minute");
  return quantity(seconds, "second");
}

/**
 * How long a job record lives — and anything a job carries that no worker
 * ever finalises. `RETENTION_WINDOWS.jobRecord` is this.
 */
export const JOB_RECORD_WINDOW = secondsWindow(DEFAULT_JOB_TTL_SECONDS);

/** The journal, as the sentences below name it. */
const JOURNAL = "the queue's on-disk journal, on our web server,";

/** After the job record's window: what the journal does with the record. */
export const JOB_RECORD_JOURNAL_NOTE = `Like everything our job queue holds, it can also remain in ${JOURNAL} until that journal is next compacted.`;

/** What becomes of what a tool's user types, said once for every tool. */
export const TYPED_INPUT_QUEUE_LIFETIME = `Our job queue removes what you type when the job ends — or, if no server ever runs the job, when the queue's retention lapses after ${JOB_RECORD_WINDOW} — and ${JOURNAL} can keep a copy until it is next compacted.`;

/**
 * How long a typed password waits on our side — said by the Protect/Unlock
 * panel AND by /privacy §2, from this one constant (re-exported by
 * `@/lib/jobs/pdf-security`, where both import it).
 */
export const PASSWORD_QUEUE_LIFETIME = `Our job queue removes it when the job finishes or is cancelled — or, if no server picks it up, when the queue's retention lapses after ${JOB_RECORD_WINDOW} — and ${JOURNAL} can keep a copy until it is next compacted.`;

/** For §10: what a request about a processed document may still find. */
export const JOB_RECORD_EXPIRY_NOTE = `though ${JOURNAL} can keep a copy until it is next compacted`;

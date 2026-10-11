/**
 * The retention windows the policy pages state, derived once from the code
 * that enforces each one.
 *
 * A file that reaches the worker has FOUR clocks, owned by three different
 * pieces of code, and the policy pages used to collapse them into one:
 *
 *  - the download link — `DEFAULT_RETENTION.outputTtlMinutes`, enforced at read
 *    time by the retrieval layer (a 410 once the signed window passes);
 *  - the stored bytes of an upload and of a result — erased by the bucket's
 *    lifecycle rules, whose day counts `buildLifecyclePolicy` derives from the
 *    same settings (`minutesToBackstopDays` rounds a 60-minute TTL UP to a
 *    1-day rule, because S3-compatible lifecycle is day-granular);
 *  - the job record, which holds the filename — the queue's key TTL,
 *    `DEFAULT_JOB_TTL_SECONDS`, refreshed on every write.
 *
 * The upload's active deletion (`wipeInputs` in the executor) is not a clock:
 * it runs when a CLAIMED job reaches an end. An upload that never becomes a
 * job — the tab closed, the job refused after the file arrived, or cancelled
 * before a worker claimed it — has only the lifecycle rule. That is why no
 * page may state the input TTL as an upper bound on how long an upload lives:
 * on 2026-09-27 both pages did ("in any case within 60 minutes", "up to 60
 * minutes") while an orphaned upload lived a day or more.
 *
 * DEFAULTS, not live values. Each of these can be changed by an environment
 * override on the deployment (`PDFXYZ_RETENTION_*`, `PDFXYZ_QUEUE_JOB_TTL_SECONDS`),
 * bounded only by a 7-day ceiling, and a static page cannot read the worker's
 * environment. The pages describe the defaults; a deployment that overrides one
 * is stating something the policy does not, and must change the policy with it.
 *
 * Number and unit are ONE string. Split across a JSX boundary —
 * `{minutes} minutes` — the leading space is eaten when the expression and the
 * word fall either side of a line break, and the page renders "60minutes".
 */
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { buildLifecyclePolicy } from "@/lib/workers/lifecycle/policy";
import { DEFAULT_RETENTION_SETTINGS } from "@/lib/workers/lifecycle/retention";
import { DEFAULT_JOB_TTL_SECONDS } from "@/lib/workers/queue/redis-config";
import { JOB_RECORD_WINDOW } from "@/lib/privacy/job-queue";

/** `n` and its unit, singular when `n` is 1 — "1 day", "24 hours". */
function quantity(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/**
 * The lifecycle policy the generator emits for the default settings — the SAME
 * derivation the ops CLI runs, so the page cannot describe a rule the bucket
 * was never given.
 */
const policy = buildLifecyclePolicy(DEFAULT_RETENTION_SETTINGS);

export const RETENTION_WINDOWS = {
  /** How long the result stays downloadable. */
  outputLink: quantity(DEFAULT_RETENTION.outputTtlMinutes, "minute"),
  /**
   * The age at which the daily lifecycle rule erases an upload still in
   * storage. The rule runs on a daily cycle, so this is when erasure BECOMES
   * due, not when it has happened — state it as "after", never "within".
   */
  inputStorageRule: quantity(policy.derivedFrom.inputBackstopDays, "day"),
  /** The same, for a produced result's stored bytes. */
  outputStorageRule: quantity(policy.derivedFrom.artifactBackstopDays, "day"),
  /**
   * How long the job record — including the filename — lives. Derived in
   * `@/lib/privacy/job-queue`, beside the queue-lifetime sentences that
   * state it (and the on-disk journal it does not bound), so the Protect/
   * Unlock panel can say it without loading the lifecycle policy.
   */
  jobRecord: JOB_RECORD_WINDOW,
} as const;

/**
 * The same windows in minutes, for guards that compare a stated bound with an
 * enforced one. Kept beside the strings so the two cannot be derived twice.
 */
export const RETENTION_WINDOW_MINUTES = {
  outputLink: DEFAULT_RETENTION.outputTtlMinutes,
  inputStorageRule: policy.derivedFrom.inputBackstopDays * 24 * 60,
  outputStorageRule: policy.derivedFrom.artifactBackstopDays * 24 * 60,
  jobRecord: DEFAULT_JOB_TTL_SECONDS / 60,
} as const;

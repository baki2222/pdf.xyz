import { DEFAULT_RETENTION, RATE_LIMITS } from "@/lib/jobs/types";
import { PER_CLIENT_KEYING_DISCLOSED } from "@/lib/privacy/keying";
import {
  WORKER_BATCH_TOOLS,
  batchLimitsSentence,
  type WorkerBatchSlug,
} from "./tools";

/**
 * What a worker batch says about our server (batch plan P3, UX "One
 * setting"), every number read from the constant that is the number:
 *
 *   - when a file is uploaded and how long anything stays: each file goes
 *     up only when its turn comes; its input is wiped after processing, as
 *     the panel's own spec row says ("Input wiped after processing"), and
 *     the copy of its result on our server expires after
 *     `DEFAULT_RETENTION.outputTtlMinutes`;
 *   - what it costs: one job per file, against
 *     `RATE_LIMITS.jobsPerHourPerClient`, which every visitor on one network
 *     address shares while `PER_CLIENT_KEYING_DISCLOSED` holds (every visitor
 *     together when it does not — the /privacy sentence's two states).
 *
 * The plan's draft said each file "is deleted within 60 minutes". That is
 * not true of every file: an input whose job was canceled before it ran is
 * removed by the bucket's daily lifecycle rule, not by the app (P3 report),
 * so these words claim only what the panel already claims.
 *
 * Read by the batch's own chunk and by the tool pages' content on the
 * server; never by a first-load module.
 */

/** Who shares the hourly count, in the limiter's current keying. */
const SHARED_BY = PER_CLIENT_KEYING_DISCLOSED
  ? "everyone on your network address shares"
  : "every visitor shares";

/** Said before Run: when each file goes up, and how long anything stays. */
export function workerBatchUploadSentence(): string {
  return `Each file is uploaded to our secure server only when its turn comes, as a job of its own; its input is wiped after processing, and the copy of its result on our server expires after ${DEFAULT_RETENTION.outputTtlMinutes} minutes.`;
}

/** Said before Run: what the batch costs, in the jobs an hour allow. */
export function workerBatchJobsSentence(files: number): string {
  return `This batch uses up to ${files} of the ${RATE_LIMITS.jobsPerHourPerClient} server jobs an hour that ${SHARED_BY}.`;
}

/** The pause banner's first sentence, after a rate limit. */
export const WORKER_BATCH_PAUSED = PER_CLIENT_KEYING_DISCLOSED
  ? "Paused: the hourly limit for your network address was reached."
  : "Paused: the hourly limit was reached.";

/** A worker tool page's account of its batch, from the registration. */
export function workerBatchPageSentence(slug: WorkerBatchSlug): string {
  const { zipName, verb, noun } = WORKER_BATCH_TOOLS[slug];
  return `Add two or more ${noun[1]} and they open as a batch list; any option you set applies to all of them. Press ${verb} with the number of files and each one runs in turn on our secure server, one job at a time; download a file from its row, or press “Download all” for ${zipName}. ${batchLimitsSentence(slug)} ${workerBatchUploadSentence()} Each file counts as one of the ${RATE_LIMITS.jobsPerHourPerClient} server jobs an hour that ${SHARED_BY}; if that limit is reached the batch pauses and carries on by itself when it lifts, as long as the page stays open.`;
}

/**
 * The honest default job-queue providers: one for when no queue is wired
 * (`disabled`) and one for when the queue variable is present but this build
 * ships no queue client (`remote-unimplemented`).
 *
 * Neither can accept, report, or cancel a job — every operation returns the same
 * typed failure, so the adapter above can never enqueue work or fabricate a
 * "completed" job by accident. This is the module that keeps the "no fake job
 * ids" promise on the production path.
 */

import type { QueueProvider, QueueProviderId, QueueResult } from "./types";
import { queueFail } from "./types";

const NOT_CONFIGURED_DETAIL =
  "No job-queue provider is configured in this environment. Jobs cannot be enqueued, polled, or canceled; nothing is processed.";

const NOT_IMPLEMENTED_DETAIL =
  "A job queue is configured, but this build ships no queue client. Wire a provider to the queue contract to enable enqueue, status, and cancel.";

const MESSAGE_NOT_CONFIGURED =
  "The secure worker's job queue is not configured in this environment. No job is enqueued, no status is fabricated, and nothing is processed. See docs/WORKER_ARCHITECTURE.md.";

const MESSAGE_NOT_IMPLEMENTED =
  "A job queue is configured, but this build ships no queue client, so no job can be enqueued or reported. See docs/WORKER_ARCHITECTURE.md.";

/**
 * A queue provider with no backend. `disabled` fails every op with
 * `not_configured`; `remote-unimplemented` fails with `not_implemented`. Both
 * report `ready: false` and no capabilities.
 */
export function createNotConfiguredQueue(
  id: Extract<QueueProviderId, "disabled" | "remote-unimplemented">,
): QueueProvider {
  const configured = id === "remote-unimplemented";
  const reason = configured ? "not_implemented" : "not_configured";
  const message = configured ? MESSAGE_NOT_IMPLEMENTED : MESSAGE_NOT_CONFIGURED;
  const detail = configured ? NOT_IMPLEMENTED_DETAIL : NOT_CONFIGURED_DETAIL;

  const fail = <T>(): QueueResult<T> => queueFail<T>(reason, message);

  return {
    id,
    probe() {
      return fail<void>();
    },
    async enqueue() {
      return fail();
    },
    async lookupIdempotent() {
      return fail();
    },
    async status() {
      return fail();
    },
    async cancel() {
      return fail();
    },
    async expire() {
      return fail();
    },
    capability() {
      return {
        provider: id,
        ready: false,
        configured,
        enqueue: false,
        status: false,
        cancel: false,
        // No provider is wired, so there is nothing to make atomic.
        atomicTransitions: false,
        detail,
      };
    },
  };
}

/**
 * The single place that turns a framework-agnostic {@link QueueFailure} into the
 * app's HTTP error envelope. Kept in a node-free leaf (no import of the
 * in-process store) so the eager adapter can map queue failures without pulling
 * Node built-ins into its bundle.
 *
 * The providers decide the *reason*; this decides the *status code*.
 */

import {
  apiError,
  notImplemented,
  workerNotConfigured,
  type ApiError,
  type ApiResult,
} from "@/lib/jobs";
import type { QueueFailure } from "./types";

/** Map a typed queue failure to a ready-to-send API error envelope. */
export function mapQueueFailure(failure: QueueFailure): ApiResult<ApiError> {
  switch (failure.reason) {
    case "not_configured":
      return workerNotConfigured();
    case "not_implemented":
      return notImplemented();
    case "not_found":
      return apiError("not_found", failure.message, failure.details);
    case "conflict":
      // A racing/illegal transition (e.g. cancel an already-completed job). The
      // delete-now orchestration resolves these to idempotent no-ops, so a route
      // reaches this only via a direct queue op; the mapping stays correct (409).
      return apiError("conflict", failure.message, failure.details);
    case "unavailable":
      // The broker was reached but errored, or could not be reached — an
      // unexpected, typically transient condition (never a not-configured stub).
      // 500 so a caller can retry rather than treat the job as gone. Mirrors the
      // storage provider's `unavailable` mapping exactly.
      return apiError("internal_error", failure.message, failure.details);
    default: {
      // Exhaustiveness guard: a new reason must add a branch above.
      const _never: never = failure.reason;
      return apiError("internal_error", String(_never));
    }
  }
}

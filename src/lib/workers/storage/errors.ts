/**
 * The single place that turns a framework-agnostic {@link StorageFailure} into
 * the app's HTTP error envelope. Kept in a node-free leaf (no import of the
 * in-process store) so the eager adapter can map storage failures without
 * pulling Node built-ins into its bundle.
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
import type { StorageFailure } from "./types";

/** Map a typed storage failure to a ready-to-send API error envelope. */
export function mapStorageFailure(failure: StorageFailure): ApiResult<ApiError> {
  switch (failure.reason) {
    case "not_configured":
      return workerNotConfigured();
    case "not_implemented":
      return notImplemented();
    case "not_found":
      return apiError("not_found", failure.message, failure.details);
    case "payload_too_large":
      return apiError("payload_too_large", failure.message, failure.details);
    case "unavailable":
      // The storage backend was reached but errored, or could not be reached —
      // an unexpected, typically transient condition (never a not-configured
      // stub). 500 so a caller can retry rather than treat it as "gone".
      return apiError("internal_error", failure.message, failure.details);
    default: {
      // Exhaustiveness guard: a new reason must add a branch above.
      const _never: never = failure.reason;
      return apiError("internal_error", String(_never));
    }
  }
}

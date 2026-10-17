/**
 * The typed product-event schema for pdf.xyz.
 *
 * These events answer product questions ("which tools get used?", "do people
 * reach the secure-worker path?") while upholding the same no-file-content
 * promise as the rest of the app. The schema is privacy-safe *by construction*:
 *
 *  - No event field is a filename, raw file byte count, page text, raw URL, or
 *    any user/device identifier. Numeric dimensions are converted to coarse
 *    {@link CountBucket}/{@link SizeBucket}/{@link DurationBucket} labels *at the
 *    point of construction* (see the builder helpers), so a raw measurement
 *    never even becomes an event field.
 *  - Every remaining field is a route slug (public), a fixed enum, or a boolean.
 *  - {@link redactValue} still scrubs the payload in the reporter as defense in
 *    depth, so a careless future field can't leak.
 *
 * `track` (in `./reporter`) accepts exactly a {@link ProductEvent}, so adding an
 * event or field is a type-checked, reviewable change — not a free-form string.
 */

import type { ToolCapability } from "@/lib/jobs/types";
import type { ApiErrorCode } from "@/lib/jobs/responses";
import type { WorkerMode } from "@/lib/workers/mode";
import type { HandoffMode } from "@/lib/handoff/capability";
import type {
  HealthClass,
  RecommendedAction,
} from "@/lib/workers/observability";
import {
  countBucket,
  sizeBucket,
  durationBucket,
  type CountBucket,
  type SizeBucket,
  type DurationBucket,
} from "./buckets";

/**
 * Coarse, non-identifying reason a tool run couldn't proceed. This is a fixed
 * category — never the raw error message, which could echo a filename or path.
 */
export const TOOL_ERROR_REASONS = [
  "handoff-expired",
  "handoff-incompatible",
  "unsupported-tool",
  "unsupported-batch",
  "worker-unavailable",
  "invalid-input",
  // The engine refused the file itself, and said why: the two refusals a
  // result's error offers a fix for (`@/lib/pdf/remedies`).
  "encrypted-input",
  "unreadable-input",
  "processing-error",
] as const;

export type ToolErrorReason = (typeof TOOL_ERROR_REASONS)[number];

const TOOL_ERROR_REASON_SET: ReadonlySet<string> = new Set(TOOL_ERROR_REASONS);

/** True when `reason` is one of the fixed {@link TOOL_ERROR_REASONS}. */
export function isToolErrorReason(reason: unknown): reason is ToolErrorReason {
  return typeof reason === "string" && TOOL_ERROR_REASON_SET.has(reason);
}

/**
 * Codes a run can fail with that no server sent: the connection dropped
 * (`network`), the job was still running when the client stopped polling
 * (`timeout`), or the in-browser engine refused the file and said why — it
 * is encrypted, or not a readable PDF (`failureCode` in the runner kit maps
 * `PdfEngineError.kind`; an engine error with no kind stays
 * `unprocessable_entity`).
 */
export type ClientFailureCode =
  "network" | "timeout" | "encrypted_input" | "unreadable_input";

/**
 * Every failure code -> the coarse category an analyst can act on. A `Record`
 * over the whole `ApiErrorCode` union, so a code added to the contract is a
 * compile error here until someone decides what it means — never a silent
 * `processing-error`.
 */
const REASON_BY_CODE: Record<
  ApiErrorCode | ClientFailureCode,
  ToolErrorReason
> = {
  // Ours, not the user's: the service could not take the job.
  rate_limited: "worker-unavailable",
  service_unavailable: "worker-unavailable",
  worker_not_configured: "worker-unavailable",
  not_implemented: "worker-unavailable",
  network: "worker-unavailable",
  timeout: "worker-unavailable",
  // The input was refused as it stands.
  invalid_request: "invalid-input",
  invalid_upload_request: "invalid-input",
  unsupported_media_type: "invalid-input",
  unsupported_file_type: "invalid-input",
  unprocessable_entity: "invalid-input",
  payload_too_large: "invalid-input",
  too_many_files: "invalid-input",
  file_too_large: "invalid-input",
  request_too_large: "invalid-input",
  malformed_pdf: "invalid-input",
  encrypted_input: "encrypted-input",
  unreadable_input: "unreadable-input",
  unsupported_tool: "unsupported-tool",
  // Anything else went wrong while processing.
  conflict: "processing-error",
  not_found: "processing-error",
  method_not_allowed: "processing-error",
  internal_error: "processing-error",
  forbidden: "processing-error",
  gone: "processing-error",
};

/**
 * The one mapping from a failure code (a contract `ApiErrorCode`, a job's
 * error code, or a {@link ClientFailureCode}) to a {@link ToolErrorReason}.
 * Unknown or absent codes are `processing-error` — the honest "something
 * failed and nobody classified it", never a guess at a better category.
 */
export function toolErrorReason(code: string | undefined): ToolErrorReason {
  return code !== undefined &&
    Object.prototype.hasOwnProperty.call(REASON_BY_CODE, code)
    ? REASON_BY_CODE[code as ApiErrorCode | ClientFailureCode]
    : "processing-error";
}

/**
 * Where a suggestion was offered when someone opened it: the home desk, the
 * ticket dialog, the command palette, the workspace, a result's Continue
 * with, an error's remedy, a guide's desk, or an in-tool hint. A fixed enum,
 * so a surface name can never carry anything a visitor typed.
 */
export const SUGGESTION_SOURCES = [
  "desk",
  "dialog",
  "palette",
  "workspace",
  "continue",
  "remedy",
  "guide",
  "hint",
] as const;
export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number];

/** A suggestion's position, coarsened: the top three, then the rest. */
export type SuggestionRank = "1" | "2" | "3" | "4+";

/**
 * The product-event union. Discriminated by `name`; each variant carries only
 * privacy-safe, low-cardinality fields. Extend by adding a variant here and its
 * name to {@link EVENT_NAMES} — both are required for `track` to accept it.
 */
export type ProductEvent =
  | {
      /** A tool page was opened. `toolSlug` is a public route id, not user data. */
      name: "tool_viewed";
      toolSlug: string;
      capability: ToolCapability;
    }
  | {
      /** A tool produced output on-device. Sizes/timings are bucketed. */
      name: "tool_completed";
      toolSlug: string;
      capability: ToolCapability;
      /**
       * How many inputs the run consumed (bucketed), when the sender knows.
       * Optional because the shared run hook does not see its runner's file
       * list, and a guessed count would be a number nobody measured.
       */
      inputCount?: CountBucket;
      /** Coarse size of the produced output, when there is one. */
      outputSize?: SizeBucket;
      /** Coarse wall-clock time the run took, when measured. */
      duration?: DurationBucket;
    }
  | {
      /** A tool run couldn't proceed; `reason` is a coarse category. */
      name: "tool_failed";
      toolSlug: string;
      capability: ToolCapability;
      reason: ToolErrorReason;
    }
  | {
      /** Files were handed off from the workspace to a tool, browser-locally. */
      name: "workspace_handoff_created";
      toolSlug: string;
      mode: HandoffMode;
      /** How many files the handoff carried (bucketed). */
      fileCount: CountBucket;
    }
  | {
      /**
       * Someone opened a suggested tool. `carried` says whether their files
       * went with it (a tool that cannot receive files opens empty and says
       * so). The rank is coarse; the files themselves are never described.
       */
      name: "suggestion_opened";
      toolSlug: string;
      source: SuggestionSource;
      rank: SuggestionRank;
      carried: boolean;
    }
  | {
      /** The UI asked the honest worker-status endpoint what's available. */
      name: "worker_status_checked";
      mode: WorkerMode;
      enabled: boolean;
    }
  | {
      /**
       * The operations dashboard read the honest worker-operations snapshot.
       * Every field is a bounded enum or boolean — the overall SLO health class,
       * the single recommended action, and the two honesty booleans — never a
       * secret, endpoint, path, object key, or count that could identify work.
       */
      name: "worker_operations_checked";
      mode: WorkerMode;
      health: HealthClass;
      recommendedAction: RecommendedAction;
      drainable: boolean;
      daemonObserved: boolean;
    }
  | {
      /**
       * Someone asked to be told when a tool that is not enabled here ships.
       *
       * A `tool_viewed` on a gated tool says a page was opened; this says the
       * visitor wanted the thing and it was not there. That is the difference
       * between traffic and demand, and it is the only signal that can rank
       * which gated tool to unblock first. `toolSlug` is a public route id.
       */
      name: "gated_tool_interest";
      toolSlug: string;
      capability: ToolCapability;
    };

/** Every valid event name. The runtime allowlist behind {@link isKnownEventName}. */
export const EVENT_NAMES = [
  "tool_viewed",
  "tool_completed",
  "tool_failed",
  "workspace_handoff_created",
  "suggestion_opened",
  "worker_status_checked",
  "worker_operations_checked",
  "gated_tool_interest",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

const EVENT_NAME_SET: ReadonlySet<string> = new Set(EVENT_NAMES);

/** True when `name` is a recognized product-event name. */
export function isKnownEventName(name: unknown): name is EventName {
  return typeof name === "string" && EVENT_NAME_SET.has(name);
}

/* ------------------------------------------------------------------ *
 *  Builders — convert raw measurements to bucketed events at the edge
 * ------------------------------------------------------------------ */

/**
 * Build a `tool_completed` event, bucketing the raw input count / output byte
 * size / elapsed milliseconds so no raw measurement is ever stored on the event.
 */
export function toolCompletedEvent(input: {
  toolSlug: string;
  capability: ToolCapability;
  inputCount?: number;
  outputBytes?: number;
  elapsedMs?: number;
}): Extract<ProductEvent, { name: "tool_completed" }> {
  const event: Extract<ProductEvent, { name: "tool_completed" }> = {
    name: "tool_completed",
    toolSlug: input.toolSlug,
    capability: input.capability,
  };
  if (input.inputCount !== undefined) {
    event.inputCount = countBucket(input.inputCount);
  }
  if (input.outputBytes !== undefined) {
    event.outputSize = sizeBucket(input.outputBytes);
  }
  if (input.elapsedMs !== undefined) {
    event.duration = durationBucket(input.elapsedMs);
  }
  return event;
}

/**
 * Build a `workspace_handoff_created` event, bucketing the raw file count so the
 * exact number of files a user staged is never recorded.
 */
export function handoffCreatedEvent(input: {
  toolSlug: string;
  mode: HandoffMode;
  fileCount: number;
}): Extract<ProductEvent, { name: "workspace_handoff_created" }> {
  return {
    name: "workspace_handoff_created",
    toolSlug: input.toolSlug,
    mode: input.mode,
    fileCount: countBucket(input.fileCount),
  };
}

/**
 * Build a `suggestion_opened` event, coarsening the 1-based position so the
 * exact length of someone's suggestion list is never recorded.
 */
export function suggestionOpenedEvent(input: {
  toolSlug: string;
  source: SuggestionSource;
  rank: number;
  carried: boolean;
}): Extract<ProductEvent, { name: "suggestion_opened" }> {
  const rank: SuggestionRank =
    input.rank === 1
      ? "1"
      : input.rank === 2
        ? "2"
        : input.rank === 3
          ? "3"
          : "4+";
  return {
    name: "suggestion_opened",
    toolSlug: input.toolSlug,
    source: input.source,
    rank,
    carried: input.carried,
  };
}

/**
 * Build a `tool_failed` event from a failure CODE, never a message: the reason
 * is {@link toolErrorReason}'s fixed category, so an error string that echoes a
 * filename can never become an event field.
 */
export function toolFailedEvent(input: {
  toolSlug: string;
  capability: ToolCapability;
  code?: string;
}): Extract<ProductEvent, { name: "tool_failed" }> {
  return {
    name: "tool_failed",
    toolSlug: input.toolSlug,
    capability: input.capability,
    reason: toolErrorReason(input.code),
  };
}

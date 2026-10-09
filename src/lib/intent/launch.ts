/**
 * Open a tool with the visitor's files already in it — or say that they did
 * not travel. The one launch every surface uses: the workspace's suggestions
 * and batch, the home page's drop zone, and the ticket, palette and Continue
 * with that follow.
 *
 * The order is the contract (`launch.test.ts` holds each step):
 *
 *  1. the unsaved-work check, when the caller has one — a declined leave
 *     stashes nothing and goes nowhere;
 *  2. the gate (`handoffPayload`): which of the files this tool opens, and
 *     just the first for a one-file tool;
 *  3. the stash, which records where the files came from;
 *  4. the navigation;
 *  5. the measurement — so nothing is counted that did not happen.
 *
 * It replaced `handoffHref`, which turned a failed stash into the plain tool
 * URL: a visitor who asked for "Merge PDF with 2 files" landed on an empty
 * Merge PDF with no word about why. Now that is `"failed"`, nothing
 * navigates, and the caller says so with a plain link beside it.
 */
import {
  handoffCapabilityFor,
  handoffPayload,
  HANDOFF_PARAM,
  HANDOFF_TARGET_WORKSPACE,
  stashHandoff,
  type HandoffOrigin,
  type PendingStep,
} from "@/lib/handoff";
import {
  handoffCreatedEvent,
  suggestionOpenedEvent,
  track,
} from "@/lib/telemetry/track";
import type { SuggestionSource } from "@/lib/telemetry/events";

/**
 * - `carried`: the tool opened with the files in it.
 * - `plain`: nothing could travel (the tool cannot receive files, or none
 *   of them is its kind), so it opened empty — honestly.
 * - `cancelled`: the unsaved-work check said stay.
 * - `failed`: files should have travelled and could not be stored; nothing
 *   navigated, and the caller must say so.
 */
export type LaunchResult = "carried" | "plain" | "cancelled" | "failed";

/** The navigation this needs — the App Router's `push`, or a test's. */
export interface LaunchRouter {
  push(href: string): void;
}

export interface LaunchInput {
  readonly toolSlug: string;
  readonly files: readonly File[];
  /** Where the files came from — required, so the page can say it. */
  readonly origin: HandoffOrigin;
  readonly trail?: readonly string[];
  readonly pending?: PendingStep;
  /** Set when the launch is a suggestion someone chose; measured if so. */
  readonly suggestion?: {
    readonly source: SuggestionSource;
    /** 1-based position in the list it was offered from. */
    readonly rank: number;
  };
  readonly router: LaunchRouter;
  /** The unsaved-work check; returning false cancels the launch. */
  readonly confirmLeave?: () => boolean;
}

export async function launchWithFiles(
  input: LaunchInput,
): Promise<LaunchResult> {
  const { toolSlug, files, origin, router, suggestion } = input;
  if (input.confirmLeave && !input.confirmLeave()) return "cancelled";

  const target = `/tools/${encodeURIComponent(toolSlug)}`;
  const payload = handoffPayload(toolSlug, files);
  if (payload.length === 0) {
    router.push(target);
    if (suggestion) {
      track(suggestionOpenedEvent({ toolSlug, ...suggestion, carried: false }));
    }
    return "plain";
  }

  let id: string | null;
  try {
    id = await stashHandoff(toolSlug, payload, {
      origin,
      ...(input.trail ? { trail: input.trail } : {}),
      ...(input.pending ? { pending: input.pending } : {}),
    });
  } catch {
    id = null;
  }
  if (!id) return "failed";

  router.push(`${target}?${HANDOFF_PARAM}=${encodeURIComponent(id)}`);
  track(
    handoffCreatedEvent({
      toolSlug,
      mode: handoffCapabilityFor(toolSlug).mode,
      fileCount: payload.length,
    }),
  );
  if (suggestion) {
    track(suggestionOpenedEvent({ toolSlug, ...suggestion, carried: true }));
  }
  return "carried";
}

/**
 * Carry files into the workspace — every one of them: the workspace stages
 * anything it can read and says what each tool would do with it. Addressed
 * to the workspace's reserved target, which only `/workspace` claims.
 * `"failed"` does not navigate, as above.
 */
export async function openWorkspaceWithFiles(input: {
  readonly files: readonly File[];
  readonly origin: HandoffOrigin;
  readonly router: LaunchRouter;
  readonly confirmLeave?: () => boolean;
}): Promise<Exclude<LaunchResult, "plain">> {
  if (input.confirmLeave && !input.confirmLeave()) return "cancelled";
  let id: string | null;
  try {
    id = await stashHandoff(HANDOFF_TARGET_WORKSPACE, input.files, {
      origin: input.origin,
    });
  } catch {
    id = null;
  }
  if (!id) return "failed";
  input.router.push(`/workspace?${HANDOFF_PARAM}=${encodeURIComponent(id)}`);
  return "carried";
}

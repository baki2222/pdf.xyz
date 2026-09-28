/**
 * Every AI tool's option parser, keyed by tool — ONE table read by both the
 * route that charges the allowance and the processor that runs the job.
 *
 * ── THE DEFECT (2026-09-28) ─────────────────────────────────────────────────
 *
 * An AI job's options were validated only on the worker. `POST /api/jobs`
 * reserved the caller's allowance, the adapter queued the job, and only the
 * processor ran `parseExtractOptions` — so a schema with "Total" and "total"
 * (which the panel allowed) uploaded the file, reserved a third of the day,
 * failed on the worker, and showed the user "`schema[1].name` duplicates an
 * earlier field name." A worker-side failure never gives the reservation back.
 * The contract knew the request was bad before a byte was charged; it was
 * simply asked too late.
 *
 * ── WHY A TABLE, AND WHY THE PROCESSORS READ IT TOO ─────────────────────────
 *
 * A pre-check the route runs and a check the worker runs are two opinions
 * about the same request; written separately they drift, and the drift is
 * silent in the direction that matters — the route admits and charges what the
 * worker then refuses. Reading one table on both sides makes the two the same
 * function by construction. `ai-tool-options.test.ts` pins the table against
 * the catalog's AI tools in both directions, and each processor's verdict
 * against the route's over a corpus of good and bad bags.
 */
import type { ParseResult } from "./responses";
import { parseExtractOptions } from "./ai-extract";
import { parseChatOptions } from "./chat-with-pdf";
import { parseSummarizeOptions } from "./summarize-pdf";
import { parseTranslateOptions } from "./translate-pdf";

export const AI_TOOL_OPTION_PARSERS = {
  "ai-extract": parseExtractOptions,
  "chat-with-pdf": parseChatOptions,
  "summarize-pdf": parseSummarizeOptions,
  "translate-pdf": parseTranslateOptions,
} as const;

export type AiOptionTool = keyof typeof AI_TOOL_OPTION_PARSERS;

/**
 * Validate `options` for `tool` when it is an AI tool, or `null` when the tool
 * has no entry. The bag is defaulted to `{}` exactly as the adapters default it
 * before the processor sees it, so the route and the worker parse the same value.
 */
export function parseAiToolOptions(
  tool: string,
  options: Record<string, unknown> | undefined,
): ParseResult<unknown> | null {
  if (!Object.prototype.hasOwnProperty.call(AI_TOOL_OPTION_PARSERS, tool)) {
    return null;
  }
  return AI_TOOL_OPTION_PARSERS[tool as AiOptionTool](options ?? {});
}

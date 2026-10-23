/**
 * The client-safe shape of a workspace tool summary, plus the tiny pure helper
 * the client uses to index them by slug.
 *
 * This module is deliberately import-light: it pulls in **types only**, so when
 * a client component imports {@link indexSummaries} it does NOT drag the tool
 * catalog, the jobs helpers, or the PDF registry into the browser bundle. The
 * server builds the summaries in `./presenter` (which owns those heavy imports)
 * and hands the finished array across the RSC boundary.
 *
 * A summary IS a tool-index entry (`buildToolIndex`), plus what the workspace
 * shows besides — so the ranking reads the very array the page was given, and
 * the page builds it once, at module scope, as plain serialisable data.
 */

import type { ToolIndexEntry } from "@/lib/intent/tool-index";
import type { ToolBadge } from "@/lib/tools/types";

export interface WorkspaceToolSummary extends ToolIndexEntry {
  badge?: ToolBadge;
  /** Human capability label, e.g. "In your browser", "Secure server". */
  capabilityLabel: string;
  /** True when files leave the device under this tool's capability. */
  uploadsFiles: boolean;
  /** True when the tool has a working in-browser runner (launchable now). */
  live: boolean;
}

/** Index summaries by slug for quick client-side lookup. */
export function indexSummaries(
  summaries: readonly WorkspaceToolSummary[],
): Map<string, WorkspaceToolSummary> {
  return new Map(summaries.map((summary) => [summary.slug, summary]));
}

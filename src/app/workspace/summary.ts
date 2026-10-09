/**
 * The client-safe shape of a workspace tool summary, plus the tiny pure helper
 * the client uses to index them by slug.
 *
 * This module is deliberately import-light: it pulls in **types only**, so when
 * a client component imports {@link indexSummaries} it does NOT drag the tool
 * catalog, the jobs helpers, or the PDF registry into the browser bundle. The
 * server builds the summaries in `./presenter` (which owns those heavy imports)
 * and hands the finished array across the RSC boundary.
 */

import type { IconName } from "@/lib/icons";
import type { HandoffMode } from "@/lib/handoff";
import type { ProcessingMode, ToolBadge } from "@/lib/tools/types";

export interface WorkspaceToolSummary {
  slug: string;
  name: string;
  tagline: string;
  icon: IconName;
  badge?: ToolBadge;
  processing: ProcessingMode;
  /** Human capability label, e.g. "In-browser", "Secure worker". */
  capabilityLabel: string;
  /** True when files leave the device under this tool's capability. */
  uploadsFiles: boolean;
  /** True when the tool has a working in-browser runner (launchable now). */
  live: boolean;
  /** How this tool receives handed-off files (collect/batch/single/none). */
  handoffMode: HandoffMode;
  accept: string[];
  outputs: string[];
}

/** Index summaries by slug for quick client-side lookup. */
export function indexSummaries(
  summaries: WorkspaceToolSummary[],
): Map<string, WorkspaceToolSummary> {
  return new Map(summaries.map((summary) => [summary.slug, summary]));
}

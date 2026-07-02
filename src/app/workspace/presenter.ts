/**
 * Client-safe presentation summaries for the workspace. The server page builds
 * one {@link WorkspaceToolSummary} per catalog tool and hands the array to the
 * client, so the workspace can render suggestions, the tool chooser, and the
 * batch panel — including each tool's honest capability — without importing
 * server-only helpers into the client bundle.
 */

import type { IconName } from "@/lib/icons";
import { capabilityForMode, describeCapability } from "@/lib/jobs";
import { isToolSupported } from "@/lib/pdf/registry";
import { getCategory } from "@/lib/tools/categories";
import { tools as allTools } from "@/lib/tools";
import type { ProcessingMode, Tool, ToolBadge } from "@/lib/tools/types";

export interface WorkspaceToolSummary {
  slug: string;
  name: string;
  tagline: string;
  icon: IconName;
  gradient?: string;
  badge?: ToolBadge;
  processing: ProcessingMode;
  /** Human capability label, e.g. "In-browser", "Secure worker". */
  capabilityLabel: string;
  /** True when files leave the device under this tool's capability. */
  uploadsFiles: boolean;
  /** True when the tool has a working in-browser runner (launchable now). */
  live: boolean;
  accept: string[];
  outputs: string[];
}

function toSummary(tool: Tool): WorkspaceToolSummary {
  const capability = describeCapability(capabilityForMode(tool.processing));
  return {
    slug: tool.slug,
    name: tool.name,
    tagline: tool.tagline,
    icon: tool.icon,
    gradient: getCategory(tool.category)?.gradient,
    badge: tool.badge,
    processing: tool.processing,
    capabilityLabel: capability.label,
    uploadsFiles: capability.uploadsFiles,
    live: isToolSupported(tool.slug),
    accept: tool.accept,
    outputs: tool.outputs,
  };
}

/** Build a client-safe summary for every catalog tool. */
export function buildToolSummaries(): WorkspaceToolSummary[] {
  return allTools.map(toSummary);
}

/** Index summaries by slug for quick client-side lookup. */
export function indexSummaries(
  summaries: WorkspaceToolSummary[],
): Map<string, WorkspaceToolSummary> {
  return new Map(summaries.map((summary) => [summary.slug, summary]));
}

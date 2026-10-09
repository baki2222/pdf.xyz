/**
 * Server-side builder for workspace tool summaries. This is where the heavy
 * catalog / jobs / registry imports live; the server page calls
 * {@link buildToolSummaries} once and hands the finished array to the client.
 * The client-safe shape and the `indexSummaries` helper live in `./summary` so
 * that importing them into a browser bundle pulls in no server-only code.
 */

import { handoffCapabilityFor } from "@/lib/handoff";
import { capabilityForMode, describeCapability } from "@/lib/jobs";
import { isToolSupported } from "@/lib/pdf/registry";
import { tools as allTools } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import type { WorkspaceToolSummary } from "./summary";

export type { WorkspaceToolSummary } from "./summary";

function toSummary(tool: Tool): WorkspaceToolSummary {
  const capability = describeCapability(capabilityForMode(tool.processing));
  return {
    slug: tool.slug,
    name: tool.name,
    tagline: tool.tagline,
    icon: tool.icon,
    badge: tool.badge,
    processing: tool.processing,
    capabilityLabel: capability.label,
    uploadsFiles: capability.uploadsFiles,
    live: isToolSupported(tool.slug),
    handoffMode: handoffCapabilityFor(tool.slug).mode,
    accept: tool.accept,
    outputs: tool.outputs,
  };
}

/** Build a client-safe summary for every catalog tool. */
export function buildToolSummaries(): WorkspaceToolSummary[] {
  return allTools.map(toSummary);
}

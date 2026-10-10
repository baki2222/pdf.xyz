/**
 * Server-side builder for workspace tool summaries. This is where the heavy
 * catalog / jobs / registry imports live; the server page calls
 * {@link buildToolSummaries} once and hands the finished array to the client.
 * The client-safe shape and the `indexSummaries` helper live in `./summary` so
 * that importing them into a browser bundle pulls in no server-only code.
 *
 * Each summary starts from the tool index (`buildToolIndex`) — the projection
 * the ranking reads, every field taken from the module that decides it — and
 * adds what the workspace shows besides.
 */

import { buildToolIndex } from "@/lib/intent/tool-index";
import { capabilityForMode, describeCapability } from "@/lib/jobs";
import { isToolSupported } from "@/lib/pdf/registry";
import { getToolBySlug } from "@/lib/tools";
import type { WorkspaceToolSummary } from "./summary";

export type { WorkspaceToolSummary } from "./summary";

/** Build a client-safe summary for every catalog tool. */
export function buildToolSummaries(): WorkspaceToolSummary[] {
  return buildToolIndex().map((entry) => {
    const capability = describeCapability(capabilityForMode(entry.processing));
    const badge = getToolBySlug(entry.slug)?.badge;
    return {
      ...entry,
      ...(badge ? { badge } : {}),
      capabilityLabel: capability.label,
      uploadsFiles: capability.uploadsFiles,
      live: isToolSupported(entry.slug),
    };
  });
}

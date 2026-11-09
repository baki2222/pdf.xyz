/**
 * A tool's capability and input kind, looked up BY SLUG in the tool
 * directory — for the API validators, the worker adapters, the catalogue's
 * own copy checks and the file ceilings, all of which name a tool by slug.
 *
 * Moved out of `./capabilities` on 2026-11-09 (perf/per-tool-first-load):
 * that module is in every worker tool page's first load (the panel shell's
 * pipeline stages), and these two lookups brought the whole directory into
 * it. A tool page's client never needs another tool's capability by slug.
 */
import { getToolEntry } from "@/lib/tools/directory";
import { capabilityForMode } from "./capabilities";
import { inputKindForAccept } from "./input-kind";
import type { ToolCapability, ToolInputKind } from "./types";

/** Resolve a tool slug to its capability, or `undefined` if the slug is unknown. */
export function getToolCapability(slug: string): ToolCapability | undefined {
  const tool = getToolEntry(slug);
  return tool ? capabilityForMode(tool.processing) : undefined;
}

/**
 * Whether a tool takes uploaded files or a single URL. Only URL-input tools
 * (e.g. webpage-to-pdf) accept a `url` option instead of uploads; everything
 * else takes files. Derived from the catalog's `accept` list.
 */
export function getToolInputKind(slug: string): ToolInputKind | undefined {
  const tool = getToolEntry(slug);
  if (!tool) return undefined;
  return inputKindForAccept(tool.accept);
}

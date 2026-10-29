import type { Tool } from "./types";
import { TOOL_DIRECTORY } from "./directory.generated";

/**
 * What a tool page's CLIENT needs to know about the OTHER tools: a name to
 * say where a file came from or went, the processing mode a remedy or hint
 * describes, the formats a hand-off may carry in, and what each tool makes
 * (to name the converter for a file of the wrong kind).
 *
 * WHY NOT `@/lib/tools`. The catalogue is every tool's copy — taglines,
 * descriptions, keywords, cards — and ~9 KB gz with the modules it pulls in
 * for its figures. Until 2026-10-29 five first-load modules on every tool
 * page (the ticket rail, the hand-off notice and hook, the hand-off
 * capability, the remedy builder) imported it for a few of these fields, so the
 * whole catalogue rode every tool page's first load. Server components keep
 * reading the catalogue; it costs the browser nothing there.
 *
 * `directory.generated.ts` is written by `pnpm tools:directory` from the
 * catalogue, and `directory.generated.test.ts` fails on any drift from a
 * fresh projection — a copy nothing compares goes stale.
 */
export type ToolEntry = Pick<
  Tool,
  "slug" | "name" | "processing" | "accept" | "outputs"
>;

/** The fields above, for every tool, in catalogue order. */
export function projectToolDirectory(tools: readonly Tool[]): ToolEntry[] {
  return tools.map(({ slug, name, processing, accept, outputs }) => ({
    slug,
    name,
    processing,
    accept: [...accept],
    outputs: [...outputs],
  }));
}

const bySlug = new Map<string, ToolEntry>(
  TOOL_DIRECTORY.map((entry) => [entry.slug, entry]),
);

/** The directory entry for a slug, or `undefined` for an unknown one. */
export function getToolEntry(slug: string): ToolEntry | undefined {
  return bySlug.get(slug);
}

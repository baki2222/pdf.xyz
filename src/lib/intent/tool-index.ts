/**
 * The catalogue as the ranking reads it: one entry per tool, every field
 * either copied from the catalogue or read from the module that decides it.
 *
 * Two fields are not the catalogue's to state. Whether a tool can receive
 * files from another page, and in what shape, is the hand-off capability's
 * (`handoffCapabilityFor`); how large a file it takes is the figure its own
 * page states (`toolFileCeilingBytes`). Both are read here, never restated,
 * so a suggestion cannot promise a hand-off the tool will not take or a size
 * it will refuse — `tool-index.test.ts` holds each against its source for
 * every tool.
 *
 * This imports the whole catalogue, so a page that must not carry it in its
 * first load (the home page, guides, category pages, the 404) may reach this
 * only through a dynamic `import()`; `bundle-budget.test.ts` ("ships the tool
 * catalogue only on pages that need it") fails such a page otherwise.
 */
import type { IconName } from "@/lib/icons";
import {
  handoffCapabilityFor,
  type HandoffMode,
} from "@/lib/handoff/capability";
import { tools } from "@/lib/tools";
import { toolFileCeilingBytes } from "@/lib/tools/file-ceilings";
import type { ProcessingMode, ToolCategoryId } from "@/lib/tools/types";

export interface ToolIndexEntry {
  readonly slug: string;
  readonly name: string;
  readonly tagline: string;
  readonly category: ToolCategoryId;
  readonly icon: IconName;
  readonly processing: ProcessingMode;
  readonly accept: readonly string[];
  readonly outputs: readonly string[];
  readonly related: readonly string[];
  /** How a hand-off reaches this tool; "none" when it cannot. */
  readonly handoffMode: HandoffMode;
  /** The largest file this tool takes, or null when it takes no file. */
  readonly ceilingBytes: number | null;
}

/** Every tool, in catalogue order. */
export function buildToolIndex(): ToolIndexEntry[] {
  return tools.map((tool) => ({
    slug: tool.slug,
    name: tool.name,
    tagline: tool.tagline,
    category: tool.category,
    icon: tool.icon,
    processing: tool.processing,
    accept: tool.accept,
    outputs: tool.outputs,
    related: tool.related ?? [],
    handoffMode: handoffCapabilityFor(tool.slug).mode,
    ceilingBytes: toolFileCeilingBytes(tool),
  }));
}

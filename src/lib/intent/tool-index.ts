/**
 * The catalogue as the ranking reads it: one entry per tool, every field
 * either copied from the catalogue or read from the module that decides it.
 *
 * Several fields are not the catalogue's to state. Whether a tool can receive
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
import { opensRestrictedPdfs } from "@/lib/pdf/registry";
import { RESTRICTED_OPENERS } from "@/lib/pdf/restricted-openers";

const RESTRICTED_OPENER_SLUGS: ReadonlySet<string> = new Set(
  RESTRICTED_OPENERS.map((t) => t.href.slice("/tools/".length)),
);
import { tools } from "@/lib/tools";
import { toolFileCeilingBytes } from "@/lib/tools/file-ceilings";
import {
  modeHasBrowserPath,
  modeUploadsFiles,
} from "@/lib/tools/processing-split";
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
  /**
   * Whether its in-browser runner opens a PDF whose author restricted editing
   * (it reads with pdf.js alone) — read from the runner registry.
   */
  readonly opensRestricted: boolean;
  /**
   * Opens an owner-restricted PDF to save what its author allows (a filled
   * form, comments) — the editor tools in RESTRICTED_OPENERS. Separate from
   * `opensRestricted` (the pdf.js readers): these still rewrite with pdf-lib,
   * so a damaged file still needs Repair first.
   */
  readonly restrictedOpener: boolean;
  /** The one rule's answers for its mode (`processing-split.ts`), not a copy. */
  readonly mayUpload: boolean;
  readonly hasBrowserPath: boolean;
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
    opensRestricted: opensRestrictedPdfs(tool.slug),
    restrictedOpener: RESTRICTED_OPENER_SLUGS.has(tool.slug),
    mayUpload: modeUploadsFiles(tool.processing),
    hasBrowserPath: modeHasBrowserPath(tool.processing),
  }));
}

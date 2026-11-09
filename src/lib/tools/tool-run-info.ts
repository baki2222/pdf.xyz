import { handoffCapabilityFor } from "@/lib/handoff/capability";
import type { HandoffCapability } from "@/lib/handoff/capability-core";
import { getRunnerKind } from "@/lib/pdf/registry";
import type { PickFacts } from "@/lib/uploads/pick-check";
import { pickFactsFor } from "@/lib/uploads/pick-facts";
import { runnerReadsWithPdfjs } from "./tool-facts";
import type { Tool } from "./types";

/**
 * What a tool page hands its client about the tool itself, computed HERE, on
 * the server, from the tables that answer for every tool — so the browser
 * receives this tool's row as data and never the tables.
 *
 * WHY (2026-11-09, perf/per-tool-first-load). The page's client code needs
 * three facts about its own tool for a hand-off, and a worker tool's panel
 * two more for its pick check (`pick`): the formats it opens (its
 * catalogue `accept` row), how many files a hand-off brings it and in what
 * mode (`handoffCapabilityFor`), and its name. It looked the first two up
 * by slug in `@/lib/tools/directory` (every tool's name, mode, formats and
 * outputs) and `@/lib/handoff/capability` (the runner registry, the runner
 * kind → mode table, the worker batch slugs): ~1.5 KB gz on every tool
 * page's first load, growing ~30 B with each new tool, to answer one row.
 *
 * NOT a client module, and nothing client-side may import it:
 * `lazy-chunks.test.ts` reads every tool page's first-load chunks for the
 * tables this reads. `tool-run-info.test.ts` holds what it returns to the
 * cross-tool functions' answer for every tool, so the page's row and the
 * ticket's lookup cannot disagree.
 */
export interface ToolRunFacts {
  readonly slug: string;
  readonly name: string;
  readonly category: Tool["category"];
  readonly readsWithPdfjs: boolean;
  readonly accept: readonly string[];
  readonly handoff: HandoffCapability;
  /**
   * A worker tool's pick check (its panel's `usePickFacts`): the ceiling
   * and the converters, which the browser used to compute from every runner
   * kind's ceiling, every worker engine's tool list and the directory.
   * Only on a worker tool's page; an in-browser runner gates its own files.
   */
  readonly pick?: PickFacts;
}

export function toolRunInfoFor(tool: Tool): ToolRunFacts {
  return {
    slug: tool.slug,
    name: tool.name,
    category: tool.category,
    readsWithPdfjs: runnerReadsWithPdfjs(tool.slug),
    accept: [...tool.accept],
    handoff: handoffCapabilityFor(tool.slug),
    ...(getRunnerKind(tool.slug) ? {} : { pick: pickFactsFor(tool) }),
  };
}

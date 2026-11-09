/**
 * The shape of a hand-off capability, and the rules that need only a tool's
 * OWN facts — no table of every tool.
 *
 * Split out of `./capability` on 2026-11-09 (perf/per-tool-first-load). That
 * module answers for ANY slug, so it holds the runner registry, the runner
 * kind → mode table, the worker batch slugs and, through `stagedMode`, the
 * tool directory: ~1.5 KB gz that rode every tool page's first load for the
 * one row the page already knew on the server. A tool page now computes its
 * own capability and `accept` row there (`toolRunInfoFor`,
 * `@/lib/tools/tool-run-info`) and hands them over as data; this module is
 * what its client code needs to use them. `./capability` builds on it, so
 * there is one definition of each rule for both, and `capability.test.ts`
 * holds the two readings to one answer for every tool.
 *
 * NO TABLES HERE, and no import that brings one: `lazy-chunks.test.ts` reads
 * every tool page's first load for the tables by their content.
 */

import { formatOf, toolAcceptsFormat } from "@/lib/intent/formats";

export type HandoffMode = "collect" | "batch" | "single" | "stage" | "none";

/** A mode that takes exactly one file: a single runner, or a staged panel. */
export function takesOneFile(mode: HandoffMode): boolean {
  return mode === "single" || mode === "stage";
}

export interface HandoffCapability {
  mode: HandoffMode;
  /** True when the tool can receive a handoff at all (`mode !== "none"`). */
  supported: boolean;
  /** Minimum files that make the handoff useful (informational). */
  minFiles: number;
  /** Max files the runner will consume from a handoff, when bounded. */
  maxFiles?: number;
}

/** The capability a mode stands for: what a hand-off in that mode carries. */
export function capabilityOfMode(mode: HandoffMode): HandoffCapability {
  if (takesOneFile(mode)) {
    return { mode, supported: true, minFiles: 1, maxFiles: 1 };
  }
  if (mode === "collect" || mode === "batch") {
    return { mode, supported: true, minFiles: mode === "collect" ? 2 : 1 };
  }
  return { mode: "none", supported: false, minFiles: 0, maxFiles: 0 };
}

/** The minimal file shape the eligibility filter needs. */
export interface FileMetaLike {
  name: string;
  type: string;
}

/**
 * The files a tool with this capability and `accept` row opens: none when it
 * takes no hand-off, else those whose format — read by `formatOf`, the one
 * recogniser — is in the row. `eligibleFilesFor` (`./capability`) is this,
 * with the row and the capability looked up by slug.
 */
export function filesTheToolOpens<T extends FileMetaLike>(
  accept: readonly string[],
  capability: HandoffCapability,
  files: T[],
): T[] {
  if (!capability.supported) return [];
  return files.filter((file) =>
    toolAcceptsFormat(accept, formatOf(file).format),
  );
}

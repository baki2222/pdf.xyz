/**
 * The workspace's tool suggestions: the ranking (`rankForFiles`) over the
 * files the workspace stages — their measured facts once the workspace has
 * read them, what their names say until then.
 *
 * WAS a model of its own: a hand-written score per file family and a reason
 * string per tool ("Combine your 3 PDFs into a single document."), with no
 * fact behind it beyond the extension, and a second copy of the eligibility
 * rule beside the hand-off gate's. It is now an adapter, so the workspace,
 * the home page's drop zone and the ticket to come rank one way, and every
 * suggestion carries the fact that justified it (`evidence.ts`).
 *
 * Imported directly, not through the `@/lib/workspace` barrel: the ranking
 * loads with the first staged file, never with the page.
 */
import { quickFacts, type FileFacts } from "@/lib/intent/facts";
import {
  rankForFiles,
  type RankContext,
  type Ranking,
} from "@/lib/intent/rank";
import type { ToolIndexEntry } from "@/lib/intent/tool-index";
import type { WorkspaceFile } from "./types";

/** The facts the ranking reads for a staged file. */
export function factsOf(file: WorkspaceFile): FileFacts {
  return (
    file.facts ??
    quickFacts({ name: file.name, size: file.size, type: file.mime }, file.id)
  );
}

/** Rank `index` for the staged files. Pure and deterministic. */
export function suggestTools<T extends ToolIndexEntry>(
  files: readonly WorkspaceFile[],
  index: readonly T[],
  ctx?: RankContext,
): Ranking<T> {
  return rankForFiles(files.map(factsOf), index, ctx);
}

/**
 * The in-browser tools that make a PDF, and which of them a result could
 * leave with nowhere to go.
 *
 * The homepage's third workflow step says "Every PDF made in your browser
 * offers the next tool, with the file already loaded." That sentence is a
 * claim about THIS set: a tool with an in-browser runner (the registry, the
 * same source the hand-off reads) whose outputs include a PDF. Worker tools
 * are not in it, and two of them end on purpose (Protect PDF, PDF to PDF/A;
 * `NO_CONTINUE` says why).
 *
 * `next-steps.test.ts` holds the property on the real catalogue, and
 * `feature-claims.test.ts` gates the sentence on the same predicate, so the
 * claim and its proof cannot drift onto two definitions.
 */
import { normalizeFormatLabel } from "@/lib/jobs/mime-by-format";
import { isToolSupported } from "@/lib/pdf/registry";
import type { Tool } from "@/lib/tools/types";
import { continueTargetsFor } from "./next-steps";

/** Tools with an in-browser runner whose outputs include a PDF. */
export function browserPdfTools(all: readonly Tool[]): Tool[] {
  return all.filter(
    (tool) =>
      isToolSupported(tool.slug) &&
      tool.outputs.some((label) => normalizeFormatLabel(label) === "PDF"),
  );
}

/** Slugs of the {@link browserPdfTools} whose result offers no next tool. */
export function browserPdfDeadEnds(all: readonly Tool[]): string[] {
  return browserPdfTools(all)
    .filter((tool) => continueTargetsFor(tool, all).targets.length === 0)
    .map((tool) => tool.slug);
}

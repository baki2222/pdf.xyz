import type { HandoffOrigin } from "@/lib/handoff/origin";
import { eligibleFilesFor } from "@/lib/handoff/capability";
import { launchWithFiles, type LaunchRouter } from "@/lib/intent/launch";
import { deliverToFallback, type DropVia } from "@/lib/intent/page-target";
import { confirmLeave } from "@/lib/intent/unsaved";

/** Where a guide desk's files came from, for the tool page to say. */
const ORIGIN: HandoffOrigin = { kind: "drop", surface: "guide" };

/**
 * What a guide's desk does with files that arrived on it — fetched with the
 * files, never with the guide (`./guide-desk` imports this when they come):
 * the hand-off's gate, the launch, the catalogue behind both, and the
 * fallback.
 *
 * A desk whose tool has no in-browser runner (`opens: null`) hands them to
 * the ticket dialog with its tool to be offered FIRST (`stage`). Otherwise
 * they pass the hand-off's own gate (`eligibleFilesFor`, the one a launch
 * passes, so the desk cannot disagree with it): none of them its tool's,
 * and the dialog says it cannot open them; some, and the tool opens with
 * them, counted (`onCount`) before it goes.
 */
export async function carryToGuideTool({
  files,
  via,
  tool,
  opens,
  router,
  onCount,
}: {
  readonly files: File[];
  readonly via: DropVia;
  readonly tool: { readonly slug: string; readonly name: string };
  readonly opens: "one" | "many" | null;
  readonly router: LaunchRouter | null;
  /** How many files will travel, once the gate has counted them. */
  readonly onCount: (count: number) => void;
}): Promise<"gone" | "stayed" | "failed"> {
  if (opens === null) {
    deliverToFallback(files, via, {
      kind: "stage",
      slug: tool.slug,
      name: tool.name,
    });
    return "stayed";
  }
  if (!router) return "failed";
  const eligible = eligibleFilesFor(tool.slug, files).length;
  if (eligible === 0) {
    deliverToFallback(files, via, { kind: "refused", name: tool.name });
    return "stayed";
  }
  onCount(opens === "one" ? 1 : eligible);
  const result = await launchWithFiles({
    toolSlug: tool.slug,
    files,
    origin: ORIGIN,
    suggestion: { source: "guide", rank: 1 },
    router,
    confirmLeave,
  });
  return result === "failed"
    ? "failed"
    : result === "cancelled"
      ? "stayed"
      : "gone";
}

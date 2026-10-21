"use client";

import {
  HandoffLoadedBadge,
  HandoffLoading,
  HandoffProblem,
} from "./handoff-notice";
import type { ToolHandoff } from "./use-tool-handoff";

/**
 * A worker panel's arrival notice (WP-10): the files are STAGED — they wait
 * in the panel, and nothing is uploaded until Run. Loaded only when a
 * hand-off was carried to the page (`use-staged-handoff.tsx`), so a tool
 * page that receives nothing never downloads it.
 */
export function StagedHandoffNotice({
  handoff,
  toolName,
  runLabel,
}: {
  handoff: ToolHandoff;
  toolName: string;
  /** The panel's Run button, named in the badge. */
  runLabel: string;
}) {
  if (handoff.status === "loading") return <HandoffLoading />;
  if (handoff.status === "ready")
    return (
      <HandoffLoadedBadge
        origin={handoff.origin}
        count={handoff.files.length}
        skipped={handoff.skipped}
        fileName={handoff.files[0]?.name ?? null}
        staged={runLabel}
      />
    );
  return <HandoffProblem handoff={handoff} toolName={toolName} />;
}

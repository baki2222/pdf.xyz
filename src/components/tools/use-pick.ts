"use client";

import { useCallback } from "react";
import { useToolRun } from "@/components/tools/runner/tool-context";
import type { Tool } from "@/lib/tools/types";
import {
  pickRefusal,
  type PickFacts,
  type PickRefusal,
} from "@/lib/uploads/pick-check";

/**
 * The pick facts the tool page computed for `tool` on the server
 * (`ToolRun.pick`), or null outside its page.
 *
 * Until 2026-11-09 each worker panel computed them in the browser
 * (`toolFileCeilingBytes`, and the converter over the whole directory
 * inside `pickRefusal`), which put every runner kind's ceiling, every
 * worker engine's tool list and the tool directory in every worker page's
 * first load. Now they arrive with the page as data.
 */
export function usePickFacts(tool: Tool): PickFacts | null {
  const run = useToolRun();
  return run?.slug === tool.slug ? (run.pick ?? null) : null;
}

/**
 * Why a picked file cannot go to `tool` — `pickRefusal` over the page's own
 * facts — for a Dropzone's `refuse`.
 *
 * With no facts (a panel mounted outside its tool page, or a page that
 * stopped handing them over) it THROWS at the pick, rather than wave every
 * file through: a pick check that silently passed everything is the defect
 * the check exists to prevent, and it would reach the server's refusal
 * after a full upload. `worker-panel-ceiling-refusal.test.tsx` renders every
 * worker panel inside the provider the page builds, so a page that drops
 * the facts fails there.
 */
export function usePickRefusal(tool: Tool): PickRefusal {
  const facts = usePickFacts(tool);
  return useCallback(
    (file: File) => {
      if (!facts)
        throw new Error(
          `${tool.slug}: no pick facts — mount the panel inside its tool page's ToolRunProvider (toolRunInfoFor)`,
        );
      return pickRefusal(tool, file, facts);
    },
    [tool, facts],
  );
}

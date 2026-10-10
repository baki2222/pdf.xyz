"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ContinuePlan } from "@/lib/intent/next-steps";
import type { ToolCategoryId } from "@/lib/tools/types";

/**
 * What a tool page's runner knows about the job it is part of — passed once,
 * from the server page, rather than threaded through 26 runners:
 *
 *  - the tool itself (its slug, name and category), for the result's
 *    receipt and the error's remedy, which must never be this tool;
 *  - where its output can go next (`continueTargetsFor`, computed on the
 *    server from the catalogue — never shipped as a graph);
 *  - the TRAIL: the tools the files already went through, read from the
 *    hand-off they arrived in (the runner's claim reports it here), so the
 *    page can draw the job's steps and "Continue with" can pass them on;
 *  - whether this step is DONE (a result is on screen), so the steps drawn
 *    tick this one too.
 *
 * Composes with `ToolTelemetry`; it reports nothing itself (addendum WP-08
 * #2: a mount emitter here would count `tool_viewed` twice).
 */
export interface ToolRunInfo {
  readonly slug: string;
  readonly name: string;
  readonly category: ToolCategoryId;
}

export interface ToolRun extends ToolRunInfo {
  readonly plan: ContinuePlan;
  /** The tools this job went through before this one, oldest first. */
  readonly trail: readonly string[];
  /** A result for this step is on screen. */
  readonly done: boolean;
  /** The runner's hand-off arrived; this is the job it came from. */
  arrived(trail: readonly string[]): void;
  /** A result appeared (true) or was left (false). */
  finished(done: boolean): void;
}

const ToolRunContext = createContext<ToolRun | null>(null);

/** The job this runner is part of; null outside a tool page (tests, panels). */
export function useToolRun(): ToolRun | null {
  return useContext(ToolRunContext);
}

export function ToolRunProvider({
  tool,
  plan,
  children,
}: {
  tool: ToolRunInfo;
  plan: ContinuePlan;
  children: ReactNode;
}) {
  const [trail, setTrail] = useState<readonly string[]>([]);
  const [done, setDone] = useState(false);
  const arrived = useCallback(
    (next: readonly string[]) => setTrail([...next]),
    [],
  );
  const finished = useCallback((value: boolean) => setDone(value), []);
  const value = useMemo<ToolRun>(
    () => ({ ...tool, plan, trail, done, arrived, finished }),
    [tool, plan, trail, done, arrived, finished],
  );
  return (
    <ToolRunContext.Provider value={value}>{children}</ToolRunContext.Provider>
  );
}

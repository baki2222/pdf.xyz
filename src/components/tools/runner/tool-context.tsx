"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
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
 *    tick this one too;
 *  - whether files are BEING BROUGHT OVER right now (the runner shows
 *    "Bringing your files over…"), so the page can hold the job's row open
 *    before it knows the job: see `useBringingFiles`.
 *
 * Composes with `ToolTelemetry`; it reports nothing itself (addendum WP-08
 * #2: a mount emitter here would count `tool_viewed` twice).
 */
export interface ToolRunInfo {
  readonly slug: string;
  readonly name: string;
  readonly category: ToolCategoryId;
  /**
   * The runner reads page content with pdf.js, so a file arriving warms
   * pdf.js and its worker (`warmPdfjs`). Computed on the server from
   * `runnerReadsWithPdfjs` (`@/lib/tools/tool-facts`), whose table is held to
   * each runner's call graph — the client never ships that table.
   */
  readonly readsWithPdfjs?: boolean;
}

export interface ToolRun extends ToolRunInfo {
  readonly plan: ContinuePlan;
  /** The tools this job went through before this one, oldest first. */
  readonly trail: readonly string[];
  /**
   * The tool that sent the files here to be FIXED, and is owed them back (a
   * remedy's `pending` step: Rotate sent a locked PDF to Unlock). Its
   * "Continue with" offers that tool first. Null for any other arrival.
   */
  readonly returnTo: string | null;
  /** A result for this step is on screen. */
  readonly done: boolean;
  /** The runner is showing "Bringing your files over…". */
  readonly bringing: boolean;
  /** The runner's hand-off arrived; this is the job it came from. */
  arrived(trail: readonly string[], returnTo?: string | null): void;
  /** A result appeared (true) or was left (false). */
  finished(done: boolean): void;
  /** "Bringing your files over…" was drawn (+1) or removed (−1). */
  bring(delta: 1 | -1): void;
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
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [bringing, setBringing] = useState(false);
  const bringers = useRef(0);
  const arrived = useCallback(
    (next: readonly string[], back: string | null = null) => {
      setTrail([...next]);
      setReturnTo(back);
    },
    [],
  );
  const finished = useCallback((value: boolean) => setDone(value), []);
  const bring = useCallback((delta: 1 | -1) => {
    bringers.current = Math.max(0, bringers.current + delta);
    setBringing(bringers.current > 0);
  }, []);
  const value = useMemo<ToolRun>(
    () => ({
      ...tool,
      plan,
      trail,
      returnTo,
      done,
      bringing,
      arrived,
      finished,
      bring,
    }),
    [tool, plan, trail, returnTo, done, bringing, arrived, finished, bring],
  );
  return (
    <ToolRunContext.Provider value={value}>{children}</ToolRunContext.Provider>
  );
}

/**
 * Marks the component that calls it as "Bringing your files over…" for the
 * page's job row (`TicketRail`): the row is held open from the commit that
 * draws that block, and stays open for the visit.
 *
 * Normally the row is open already: a page reached by a hand-off holds it
 * from its first painted frame, read from its address. This is the second
 * way in, for a runner bringing files over on a page whose address did not
 * say so. A LAYOUT effect, so its update applies before the browser paints
 * and the row opens in the frame the block appears — a move of the runner
 * all the same, which is why the address is read first. It never closes
 * the row: a row that closed with the block moved the runner back up,
 * counted (PR #180 review; the history is in `TicketRail`).
 */
export function useBringingFiles(): void {
  const bring = useToolRun()?.bring;
  useLayoutEffect(() => {
    if (!bring) return;
    bring(1);
    return () => bring(-1);
  }, [bring]);
}

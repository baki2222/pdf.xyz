"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { filesTheToolOpens } from "@/lib/handoff/capability-core";
import type { HandoffFileEntry } from "@/lib/handoff/types";
import {
  forgetDeparture,
  readDeparture,
  type Departure,
} from "@/lib/handoff/departure";
import {
  claimArrival,
  IDLE,
  LOADING,
  type ClaimedHandoff,
} from "@/lib/handoff/claim";
import { warmPdfLib } from "@/lib/pdf/pdf-lib";
import { useToolRun } from "./tool-context";
import { warmPdfjs } from "./runner-kit";

export {
  claimArrival,
  type ClaimedHandoff,
  type HandoffStatus,
} from "@/lib/handoff/claim";

export type ToolHandoff = ClaimedHandoff & {
  /** The receiving tool's `accept` row, for naming what it can open. */
  accept: readonly string[];
  /**
   * Where this page's files went, when this history entry sent them on to
   * another tool (`@/lib/handoff/departure`) — shown again on Back.
   */
  departed: Departure | null;
  /** Dismiss a notice (expired, incompatible, departed) for the picker. */
  dismiss: () => void;
};

/**
 * Client hook that lets a tool runner receive files handed off from another
 * page — the workspace, a drop on the home page, or a previous tool.
 * On mount it takes the token carried to this page (`claimArrival`: this
 * tab's sessionStorage, or an older `?handoff=` address), claims the
 * matching record from the browser-local handoff store (single-use, so it's
 * consumed), and narrows the files to the ones this tool can actually open.
 * The carried token is removed as it is read, so a reload can't retry a
 * consumed/expired claim.
 *
 * With nothing carried here, it reads whether THIS history entry sent its
 * files on to another tool (`readDeparture`), so Back says where they went.
 */

/**
 * @param slug the tool this runner implements, or `undefined` to disable the
 *   hook (used when a parent already claimed the handoff and passes it down).
 */
export function useToolHandoff(slug: string | undefined): ToolHandoff {
  const router = useRouter();
  const [state, setState] = useState<ClaimedHandoff>(IDLE);
  const [departed, setDeparted] = useState<Departure | null>(null);
  // The page's job: told which tools these files already went through, so it
  // can draw the steps and "Continue with" can pass them on.
  const run = useToolRun();
  const arrived = run?.arrived;
  const readsWithPdfjs = run?.readsWithPdfjs === true;
  /*
   * This tool's own `accept` row and hand-off capability, as the server
   * page computed them (`toolRunInfoFor`). Until 2026-11-09 both were
   * looked up here by slug — `eligibleFilesFor` and `getToolEntry` — which
   * put the tool directory and the capability tables in every tool page's
   * first load. Without them (a runner rendered outside a tool page: a
   * test) the same functions are fetched on demand, so the answer is the
   * one the tables give and only the bytes move.
   */
  const ownAccept = run && run.slug === slug ? run.accept : undefined;
  const ownHandoff = run && run.slug === slug ? run.handoff : undefined;
  const [fetchedAccept, setFetchedAccept] =
    useState<readonly string[]>(NO_FORMATS);
  // Claims exactly once, even under React StrictMode's double-invoked effects.
  const startedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!slug || startedRef.current) return;
    startedRef.current = true;

    const start = (
      select: (entries: HandoffFileEntry[]) => HandoffFileEntry[],
    ): void => {
      const claim = claimArrival(slug, select, router);
      if (!claim) {
        const left = readDeparture();
        if (!left) return;
        queueMicrotask(() => mountedRef.current && setDeparted(left));
        // An entry written before departures carried the name (2026-11-09):
        // looked up on demand, as it was before, for that entry alone.
        if (left.name === null)
          void import("@/lib/tools/directory").then(({ getToolEntry }) => {
            const name = getToolEntry(left.slug)?.name ?? null;
            if (name && mountedRef.current) setDeparted({ ...left, name });
          });
        return;
      }

      queueMicrotask(() => {
        if (mountedRef.current) {
          setState(LOADING);
        }
      });
      void claim.then((result) => {
        if (!mountedRef.current) return;
        if (result.status === "ready") {
          // Files are about to repopulate a runner without touching the
          // Dropzone, so this is the flow's file-pick moment: start the
          // engine download now rather than paying it at run-click (the one
          // gap the pdf-lib deferral left open — TASK-05 §3c).
          warmPdfLib();
          if (readsWithPdfjs) warmPdfjs();
          arrived?.(result.trail, null, result.names);
          focusArrival();
        }
        setState(result);
      });
    };

    if (ownAccept && ownHandoff) {
      start((entries) => filesTheToolOpens(ownAccept, ownHandoff, entries));
      return;
    }
    void Promise.all([
      import("@/lib/handoff/capability"),
      import("@/lib/tools/directory"),
    ]).then(([{ eligibleFilesFor }, { getToolEntry }]) => {
      if (!mountedRef.current) {
        startedRef.current = false;
        return;
      }
      setFetchedAccept(getToolEntry(slug)?.accept ?? NO_FORMATS);
      start((entries) => eligibleFilesFor(slug, entries));
    });
  }, [slug, router, arrived, readsWithPdfjs, ownAccept, ownHandoff]);

  const dismiss = useCallback(() => {
    setState(IDLE);
    setDeparted(null);
    forgetDeparture();
  }, []);
  const accept = !slug ? NO_FORMATS : (ownAccept ?? fetchedAccept);

  return { ...state, accept, departed, dismiss };
}

const NO_FORMATS: readonly string[] = [];

/** Frames to wait for the carried file's header before the page's heading. */
const ARRIVAL_FRAMES = 90;

/**
 * Where focus goes when files ARRIVE and it has nowhere to be: the link
 * that sent them (a Continue row, a desk, the ticket) left with its page,
 * and focus fell to <body> — after Enter on a Continue row a keyboard
 * reader began the next tool from the top of the document (PR #180
 * review). As a replaced file does (`replaceOpenFile`), it moves to what
 * arrived: the carried file's header in this tool (its name, pages and
 * size), once the runner draws it; for a runner with none (a list of
 * files), the page's heading. Never when focus is somewhere real, and
 * never with a scroll. `e2e/continue-chain.spec.ts` holds it after Enter.
 */
function focusArrival(): void {
  if (typeof requestAnimationFrame !== "function") return;
  let frames = 0;
  const into = (el: HTMLElement) => {
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
  };
  const look = () => {
    const now = document.activeElement;
    if (now && now !== document.body && now.isConnected) return;
    const header = document.querySelector<HTMLElement>(
      "[data-tool-panel] [data-file-header]",
    );
    if (header) return into(header);
    if (++frames <= ARRIVAL_FRAMES) return void requestAnimationFrame(look);
    const heading = document.querySelector<HTMLElement>("main h1");
    if (heading) into(heading);
  };
  requestAnimationFrame(look);
}

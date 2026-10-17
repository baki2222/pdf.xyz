"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { eligibleFilesFor } from "@/lib/handoff";
import {
  claimFromUrl,
  IDLE,
  LOADING,
  type ClaimedHandoff,
} from "@/lib/handoff/claim";
import { warmPdfLib } from "@/lib/pdf/pdf-lib";
import { getToolBySlug } from "@/lib/tools";
import { useToolRun } from "./tool-context";

export {
  claimFromUrl,
  type ClaimedHandoff,
  type HandoffStatus,
} from "@/lib/handoff/claim";

export type ToolHandoff = ClaimedHandoff & {
  /** The receiving tool's `accept` row, for naming what it can open. */
  accept: readonly string[];
  /** Dismiss an expired/incompatible notice and fall back to the picker. */
  dismiss: () => void;
};

/**
 * Client hook that lets a tool runner receive files handed off from another
 * page — the workspace, a drop on the home page, or a previous tool.
 * On mount it reads a `?handoff=<id>` token from the URL, claims the matching
 * record from the browser-local handoff store (single-use, so it's consumed),
 * and narrows the files to the ones this tool can actually open.
 *
 * Everything stays in the browser — the token references origin-private storage,
 * never a server. The `?handoff` param is stripped immediately so a reload can't
 * retry a consumed/expired claim and the URL stays clean and shareable-free.
 *
 * The strip applies through `window.history.replaceState`, the App Router's
 * `router.replace`, and a follow-up `replaceState` scheduled for the next
 * frame — see `stripHandoffParam` in `@/lib/handoff/claim` for why all three
 * are needed across a hard page load and an in-app soft navigation.
 */

/**
 * @param slug the tool this runner implements, or `undefined` to disable the
 *   hook (used when a parent already claimed the handoff and passes it down).
 */
export function useToolHandoff(slug: string | undefined): ToolHandoff {
  const router = useRouter();
  const [state, setState] = useState<ClaimedHandoff>(IDLE);
  // The page's job: told which tools these files already went through, so it
  // can draw the steps and "Continue with" can pass them on.
  const arrived = useToolRun()?.arrived;
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

    const claim = claimFromUrl(
      slug,
      (entries) => eligibleFilesFor(slug, entries),
      router,
    );
    if (!claim) return;

    queueMicrotask(() => {
      if (mountedRef.current) {
        setState(LOADING);
      }
    });
    void claim.then((result) => {
      if (!mountedRef.current) return;
      if (result.status === "ready") {
        // Files are about to repopulate a runner without touching the
        // Dropzone, so this is the flow's file-pick moment: start the engine
        // download now rather than paying it at run-click (the one gap the
        // pdf-lib deferral left open — TASK-05 §3c).
        warmPdfLib();
        arrived?.(result.trail);
        focusArrival();
      }
      setState(result);
    });
  }, [slug, router, arrived]);

  const dismiss = useCallback(() => setState(IDLE), []);
  const accept = useMemo(
    () => (slug ? (getToolBySlug(slug)?.accept ?? []) : []),
    [slug],
  );

  return { ...state, accept, dismiss };
}

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

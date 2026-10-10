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
      }
      setState(result);
    });
  }, [slug, router]);

  const dismiss = useCallback(() => setState(IDLE), []);
  const accept = useMemo(
    () => (slug ? (getToolBySlug(slug)?.accept ?? []) : []),
    [slug],
  );

  return { ...state, accept, dismiss };
}

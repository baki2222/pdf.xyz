"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { peekCarriedHandoff } from "@/lib/handoff/carry-key";
import type { ClaimedHandoff } from "@/lib/handoff/claim";
import { getToolBySlug } from "@/lib/tools";
import { useToolRun } from "./runner/tool-context";

const Notice = lazy(() =>
  import("./runner/handoff-notice").then(({ StagedHandoffNotice }) => ({
    default: StagedHandoffNotice,
  })),
);

/** Whether a hand-off was carried to this page — read without loading the store. */
function carried(): boolean {
  try {
    return (
      peekCarriedHandoff(window.location.pathname) !== null ||
      /[?&]handoff=/.test(window.location.search)
    );
  } catch {
    return false;
  }
}

/**
 * A worker panel's side of a hand-off (spec E.6, D.7): the file a result's
 * "Continue with", a remedy, the desk or the palette carried here is STAGED
 * in the panel — `onFiles` gets it, as if it had been dropped — and nothing
 * is uploaded until the reader presses Run. The upload is the panel's Run
 * and nothing else; `e2e/worker-panels.spec.ts` counts the requests.
 *
 * The claim and its notice load ONLY when a hand-off was carried to this
 * page (a sessionStorage peek, or an old `?handoff=` address), so a worker
 * tool page opened from a link pays nothing for it.
 */
export function useStagedHandoff(
  slug: string,
  runLabel: string,
  onFiles: (files: File[]) => void,
): ReactNode {
  const [state, setState] = useState<ClaimedHandoff | null>(null);
  const arrived = useToolRun()?.arrived;
  const take = useRef(onFiles);
  useEffect(() => {
    take.current = onFiles;
  });
  // Claims exactly once, even under StrictMode's doubled effects — so the
  // result is kept by a mounted flag, not by the effect's own cleanup.
  const started = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (started.current || !carried()) return;
    started.current = true;
    void (async () => {
      const [{ claimArrival, LOADING }, { eligibleFilesFor }] =
        await Promise.all([
          import("@/lib/handoff/claim"),
          import("@/lib/handoff/capability"),
        ]);
      const claim = claimArrival(
        slug,
        (entries) => eligibleFilesFor(slug, entries),
        // The legacy address strip replaces history itself; the App
        // Router's own `replace` is a nicety this panel does without.
        { replace: () => {} },
      );
      if (!claim) return;
      if (mounted.current) setState(LOADING);
      const result = await claim;
      if (!mounted.current) return;
      if (result.status === "ready") {
        // A remedy's files are owed back to the tool that sent them.
        arrived?.(result.trail, result.pending?.toolSlug ?? null);
        take.current(result.files.slice(0, 1));
      }
      setState(result);
    })();
  }, [slug, arrived]);

  const dismiss = useCallback(() => setState(null), []);
  if (!state || state.status === "idle") return null;
  const tool = getToolBySlug(slug);
  return (
    <Suspense fallback={null}>
      <Notice
        handoff={{
          ...state,
          accept: tool?.accept ?? [],
          departed: null,
          dismiss,
        }}
        toolName={tool?.name ?? slug}
        runLabel={runLabel}
      />
    </Suspense>
  );
}

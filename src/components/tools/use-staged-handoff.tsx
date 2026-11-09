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
import {
  filesTheToolOpens,
  takesOneFile,
  type HandoffCapability,
} from "@/lib/handoff/capability-core";
import { peekCarriedHandoff } from "@/lib/handoff/carry-key";
import type { ClaimedHandoff } from "@/lib/handoff/claim";
import type { HandoffFileEntry } from "@/lib/handoff/types";
import { useToolRun } from "./runner/tool-context";

const Notice = lazy(() =>
  import("./runner/staged-handoff-notice").then(({ StagedHandoffNotice }) => ({
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
 * What the arrival notice names as Run when the files open in a worker
 * batch's list: its button reads "Repair 3 PDFs", a count this hook cannot
 * know (the batch leaves out what it cannot take), so the notice names where
 * the button is instead.
 */
const BATCH_RUN = "the button under the list";

/**
 * A worker panel's side of a hand-off (spec E.6, D.7): the file a result's
 * "Continue with", a remedy, the desk, the palette or the workspace carried
 * here is STAGED in the panel — `onFiles` gets it, as if it had been dropped
 * — and nothing is uploaded until the reader presses Run. The upload is the
 * panel's Run and nothing else; `e2e/worker-panels.spec.ts` counts the
 * requests.
 *
 * A panel with no batch gets the first carried file. A panel with one
 * (batch plan P6: `handoffCapabilityFor` says `batch`) gets them ALL, as a
 * drop of several would give them, and opens its batch list for two or
 * more; the list caps them and names the rest with the reason. WAS the
 * first file for every panel, the rest dropped without a word.
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
  // The files went to a batch list, so Run is the button under it.
  const [many, setMany] = useState(false);
  const run = useToolRun();
  const arrived = run?.arrived;
  /*
   * This panel's own row — name, formats, hand-off capability — as the
   * server page computed it (`toolRunInfoFor`). Until 2026-11-09 the name
   * and formats came from `@/lib/tools/directory`, a static import that put
   * every tool's row in every worker page's first load, and the capability
   * from `@/lib/handoff/capability`, fetched with the claim. Outside a tool
   * page (a test) the same tables are fetched with the claim instead.
   */
  const ownRow: OwnRow | null =
    run && run.slug === slug && run.accept && run.handoff
      ? { name: run.name, accept: run.accept, handoff: run.handoff }
      : null;
  const ownName = ownRow?.name;
  const ownAccept = ownRow?.accept;
  const ownHandoff = ownRow?.handoff;
  const [fetchedRow, setFetchedRow] = useState<OwnRow | null>(null);
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
      const [{ claimArrival, LOADING }, row] = await Promise.all([
        import("@/lib/handoff/claim"),
        ownName && ownAccept && ownHandoff
          ? { name: ownName, accept: ownAccept, handoff: ownHandoff }
          : fetchRow(slug),
      ]);
      if (row !== null && row.name !== ownName && mounted.current)
        setFetchedRow(row);
      const select = (entries: HandoffFileEntry[]) =>
        row ? filesTheToolOpens(row.accept, row.handoff, entries) : [];
      const claim = claimArrival(
        slug,
        select,
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
        arrived?.(result.trail, result.pending?.toolSlug ?? null, result.names);
        const one = row === null || takesOneFile(row.handoff.mode);
        take.current(one ? result.files.slice(0, 1) : result.files);
        setMany(!one && result.files.length > 1);
      }
      setState(result);
    })();
  }, [slug, arrived, ownName, ownAccept, ownHandoff]);

  const dismiss = useCallback(() => setState(null), []);
  if (!state || state.status === "idle") return null;
  const tool = ownRow ?? fetchedRow;
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
        runLabel={many ? BATCH_RUN : runLabel}
      />
    </Suspense>
  );
}

/** What the claim and its notice read about the panel's own tool. */
interface OwnRow {
  readonly name: string;
  readonly accept: readonly string[];
  readonly handoff: HandoffCapability;
}

/**
 * The row the server page would have handed over, looked up by slug in the
 * tables that answer for every tool — fetched with the claim, for a panel
 * rendered outside a tool page. Null for a slug the directory does not know
 * (its claim then keeps no file, as `eligibleFilesFor` kept none).
 */
async function fetchRow(slug: string): Promise<OwnRow | null> {
  const [{ handoffCapabilityFor }, { getToolEntry }] = await Promise.all([
    import("@/lib/handoff/capability"),
    import("@/lib/tools/directory"),
  ]);
  const entry = getToolEntry(slug);
  return entry
    ? {
        name: entry.name,
        accept: entry.accept,
        handoff: handoffCapabilityFor(slug),
      }
    : null;
}

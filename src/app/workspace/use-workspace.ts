"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  clearHandoffs,
  handoffPayload,
  purgeExpiredHandoffs,
} from "@/lib/handoff";
import { launchWithFiles } from "@/lib/intent/launch";
import { isLikelyPdf, MAX_PDF_BYTES } from "@/lib/pdf/files";
import { countPdfPages } from "@/lib/pdf/page-count";
import {
  clearPersisted,
  createWorkspaceFile,
  emptyWorkspace,
  loadPersisted,
  MAX_RECENT_ACTIONS,
  planBatch,
  savePersisted,
  suggestTools,
  workspaceReducer,
  type BatchPlan,
  type ToolSuggestion,
  type WorkspaceAction,
  type WorkspaceFile,
  type WorkspaceState,
} from "@/lib/workspace";
import { modeUploadsFiles } from "@/lib/tools/processing-split";
import { indexSummaries, type WorkspaceToolSummary } from "./summary";

/** In-browser tools never load files larger than this. Exported so the copy
 * DERIVES the figure — the old comment admitted it was "manually kept in
 * sync" with a hand-written "100 MB", which is a lie waiting for a config
 * change (the numbers-honesty census now forbids the hand-written form). */
const MAX_FILE_BYTES = MAX_PDF_BYTES;
export const MAX_FILE_MB = Math.round(MAX_FILE_BYTES / (1024 * 1024));

/** A file the workspace declined to stage, with a user-facing reason. */
export interface RejectedFile {
  name: string;
  reason: string;
}

let idCounter = 0;
/** Opaque id for an activity entry. Random when available, monotonic otherwise. */
function activityId(): string {
  idCounter += 1;
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // Secure-context-only APIs can throw; fall through to the counter.
  }
  return `act-${idCounter}`;
}

export interface WorkspaceController {
  state: WorkspaceState;
  /** False until persisted preferences have loaded (client mount). */
  hydrated: boolean;
  /** Clock captured at hydration, for stable relative-time rendering. */
  now: number;
  rejected: RejectedFile[];
  suggestions: ToolSuggestion[];
  batchPlan: BatchPlan;
  addFiles: (list: FileList | File[] | null) => void;
  removeFile: (id: string) => void;
  clearFiles: () => void;
  /**
   * Wipe the whole session: staged files, remembered tool prefs, the activity
   * log, and any browser-local hand-off bytes still awaiting a claim. Purely
   * local — there is nothing on a server to clear.
   */
  clearSession: () => void;
  dismissRejected: () => void;
  selectTool: (slug: string | null) => void;
  /** Record + persist a tool open (survives the immediate client navigation). */
  openTool: (tool: WorkspaceToolSummary, fileCount?: number) => void;
  setBatchTool: (slug: string | null) => void;
  addAllToBatch: () => void;
  removeFromBatch: (id: string) => void;
  clearBatch: () => void;
  /** Record + persist that a batch was launched into a tool. */
  launchBatch: (tool: WorkspaceToolSummary, fileCount: number) => void;
  /**
   * Hand queued files off to a live tool: stash them in browser-local storage
   * and open the tool with them pre-loaded (falls back to a plain open if the
   * hand-off can't be created). Files never leave the device.
   */
  launchHandoff: (tool: WorkspaceToolSummary, ids: string[]) => void;
  /** Slug of the tool currently being launched via hand-off, or null. */
  launchingSlug: string | null;
  /**
   * Slug of the last tool whose hand-off could not be stored — the files did
   * not travel, nothing navigated, and the page must say so. Null otherwise.
   */
  launchFailedSlug: string | null;
}

/**
 * Wire the pure workspace model to React: a reducer for in-memory state, plus a
 * guarded localStorage bridge that persists only the safe subset (tool prefs +
 * activity — never file metadata). Files live in memory and clear when the tab
 * closes; on mount we restore preferences, letting a `?tool=` deep link win.
 */
export function useWorkspace(
  summaries: WorkspaceToolSummary[],
  preselected?: string,
): WorkspaceController {
  const [state, dispatch] = useReducer(workspaceReducer, null, emptyWorkspace);
  // A dispatch (not a setState) flips this on mount and captures the clock once
  // for relative-time display, keeping the mount effect free of setState-in-effect.
  const [hydration, markHydrated] = useReducer(
    (_prev: { ready: boolean; now: number }, now: number) => ({
      ready: true,
      now,
    }),
    { ready: false, now: 0 },
  );
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const router = useRouter();
  // Slug of the tool currently being launched with a hand-off (button spinner).
  const [launchingSlug, setLaunchingSlug] = useState<string | null>(null);
  // Slug of a launch whose files could not be stored (said on the page).
  const [launchFailedSlug, setLaunchFailedSlug] = useState<string | null>(null);

  // Live File handles for staged files, kept by id in a ref (never rendered, so
  // no re-render churn). This is what makes a real hand-off possible: staged
  // *metadata* lives in the reducer, but the actual bytes stay reachable here
  // until the user hands them to a tool. Cleared with the files.
  const fileHandles = useRef<Map<string, File>>(new Map());

  // Keep the latest state reachable from event handlers for eager persistence,
  // without making it an effect dependency. Written in an effect (never during
  // render); declared first so it syncs before the persist effect below reads it.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // Guards the async page-count enrichment from dispatching after unmount.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Sweep any expired hand-off bytes when the workspace opens. Landing here is
  // the natural moment to reclaim storage from a launch the user never finished,
  // rather than waiting for them to next open a tool page. Best-effort; failures
  // are swallowed inside the store.
  useEffect(() => {
    void purgeExpiredHandoffs();
  }, []);

  const bySlug = useMemo(() => indexSummaries(summaries), [summaries]);

  // Restore persisted preferences once, on mount. The deep-linked tool wins.
  useEffect(() => {
    const persisted = loadPersisted();
    dispatch({
      type: "hydrate",
      selectedToolSlug: preselected ?? persisted?.selectedToolSlug ?? null,
      batchToolSlug: persisted?.batchToolSlug ?? null,
      recentActions: persisted?.recentActions ?? [],
    });
    markHydrated(Date.now());
  }, [preselected]);

  // Persist the safe subset whenever a persisted-relevant field changes.
  useEffect(() => {
    if (!hydration.ready) return;
    savePersisted(stateRef.current);
  }, [
    hydration.ready,
    state.selectedToolSlug,
    state.batch.toolSlug,
    state.recentActions,
  ]);

  /**
   * Best-effort, local-only page-count enrichment. Reads each staged PDF's bytes
   * in the browser (never uploaded) just far enough to count pages, then attaches
   * the count to its card. Sequential to bound peak memory; the reducer ignores
   * ids that are no longer staged, so a file removed mid-parse is a safe no-op.
   */
  const enrichPageCounts = useCallback(
    async (handles: { id: string; file: File }[]) => {
      for (const { id, file } of handles) {
        if (!aliveRef.current) return;
        let pageCount: number | null = null;
        try {
          pageCount = await countPdfPages(
            new Uint8Array(await file.arrayBuffer()),
          );
        } catch {
          pageCount = null;
        }
        if (!aliveRef.current || pageCount === null) continue;
        dispatch({ type: "set-page-count", id, pageCount });
      }
    },
    [],
  );

  const addFiles = useCallback(
    (list: FileList | File[] | null) => {
      const incoming = list ? Array.from(list) : [];
      if (incoming.length === 0) return;
      const accepted: WorkspaceFile[] = [];
      const pdfHandles: { id: string; file: File }[] = [];
      const bad: RejectedFile[] = [];
      const now = Date.now();
      incoming.forEach((file, i) => {
        if (!file.size || file.size <= 0) {
          bad.push({
            name: file.name,
            reason: "This file is empty (0 bytes).",
          });
          return;
        }
        if (file.size > MAX_FILE_BYTES) {
          bad.push({
            name: file.name,
            reason: `Too large for in-browser tools — max ${MAX_FILE_MB} MB per file.`,
          });
          return;
        }
        const id = `${file.name}-${file.size}-${file.lastModified}-${i}`;
        accepted.push(
          createWorkspaceFile(
            { name: file.name, size: file.size, type: file.type },
            id,
            now,
          ),
        );
        // Retain the live File handle so it can be handed off to a tool later.
        fileHandles.current.set(id, file);
        // PDFs get a locally-parsed page count; keep the live File handle for it.
        if (isLikelyPdf(file)) pdfHandles.push({ id, file });
      });
      if (accepted.length > 0) dispatch({ type: "add-files", files: accepted });
      setRejected(bad);
      if (pdfHandles.length > 0) void enrichPageCounts(pdfHandles);
    },
    [enrichPageCounts],
  );

  const removeFile = useCallback((id: string) => {
    fileHandles.current.delete(id);
    dispatch({ type: "remove-file", id });
  }, []);

  const clearFiles = useCallback(() => {
    fileHandles.current.clear();
    dispatch({ type: "clear-files" });
    setRejected([]);
  }, []);

  const clearSession = useCallback(() => {
    fileHandles.current.clear();
    dispatch({ type: "reset" });
    setRejected([]);
    setLaunchingSlug(null);
    clearPersisted();
    // Drop any hand-off bytes this browser is still holding for an unclaimed
    // launch. Best-effort and local-only.
    void clearHandoffs();
  }, []);

  const dismissRejected = useCallback(() => setRejected([]), []);

  const selectTool = useCallback((slug: string | null) => {
    dispatch({ type: "select-tool", slug });
  }, []);

  /** Persist a projected next state immediately (before a client route change). */
  const persistWithAction = useCallback(
    (action: WorkspaceAction, selectSlug?: string) => {
      const current = stateRef.current;
      const next: WorkspaceState = {
        ...current,
        selectedToolSlug: selectSlug ?? current.selectedToolSlug,
        recentActions: [action, ...current.recentActions].slice(
          0,
          MAX_RECENT_ACTIONS,
        ),
      };
      savePersisted(next);
    },
    [],
  );

  const openTool = useCallback(
    (tool: WorkspaceToolSummary, fileCount?: number) => {
      const action: WorkspaceAction = {
        id: activityId(),
        kind: "opened-tool",
        label: `Opened ${tool.name}`,
        toolSlug: tool.slug,
        ...(typeof fileCount === "number" ? { fileCount } : {}),
        at: Date.now(),
      };
      dispatch({ type: "record-action", action });
      dispatch({ type: "select-tool", slug: tool.slug });
      persistWithAction(action, tool.slug);
    },
    [persistWithAction],
  );

  const setBatchTool = useCallback((slug: string | null) => {
    dispatch({ type: "set-batch-tool", slug });
  }, []);

  const addAllToBatch = useCallback(() => {
    dispatch({
      type: "add-to-batch",
      ids: stateRef.current.files.map((f) => f.id),
    });
  }, []);

  const removeFromBatch = useCallback((id: string) => {
    dispatch({ type: "remove-from-batch", id });
  }, []);

  const clearBatch = useCallback(() => dispatch({ type: "clear-batch" }), []);

  const launchBatch = useCallback(
    (tool: WorkspaceToolSummary, fileCount: number) => {
      const action: WorkspaceAction = {
        id: activityId(),
        kind: "queued-batch",
        label: `Queued ${fileCount} file${fileCount === 1 ? "" : "s"} for ${tool.name}`,
        toolSlug: tool.slug,
        fileCount,
        at: Date.now(),
      };
      dispatch({ type: "record-action", action });
      persistWithAction(action);
    },
    [persistWithAction],
  );

  const suggestions = useMemo(() => suggestTools(state.files), [state.files]);

  const batchPlan = useMemo(
    () =>
      planBatch(state.batch, (slug) => {
        const summary = bySlug.get(slug);
        return summary
          ? {
              live: summary.live,
              // Was `summary.processing !== "client"`: the fifth private copy
              // of "does this upload", and the one that decides what the batch
              // planner tells a user before their files move.
              usesWorker: modeUploadsFiles(summary.processing),
              handoff: summary.handoffMode,
            }
          : undefined;
      }),
    [state.batch, bySlug],
  );

  /**
   * Stash the queued files in browser-local storage and open the target tool
   * with them pre-loaded, through `launchWithFiles` — the one launch, which
   * also decides what travels (single-file tools receive just the first
   * eligible file) and measures it. A tool that can take none of them opens
   * plainly; a hand-off that cannot be stored does NOT navigate, and the page
   * says so (`launchFailedSlug`) instead of opening an empty tool.
   */
  const launchHandoff = useCallback(
    (tool: WorkspaceToolSummary, ids: string[]) => {
      const ordered = ids
        .map((id) => fileHandles.current.get(id))
        .filter((file): file is File => file !== undefined);

      // Record the launch as name-free activity, same as a plain batch launch.
      launchBatch(
        tool,
        handoffPayload(tool.slug, ordered).length || ids.length,
      );

      setLaunchFailedSlug(null);
      setLaunchingSlug(tool.slug);
      void launchWithFiles({
        toolSlug: tool.slug,
        files: ordered,
        origin: { kind: "workspace" },
        router,
      }).then((result) => {
        if (result === "carried" || result === "plain") return;
        setLaunchingSlug(null);
        if (result === "failed") setLaunchFailedSlug(tool.slug);
      });
    },
    [launchBatch, router],
  );

  return {
    state,
    hydrated: hydration.ready,
    now: hydration.now,
    rejected,
    suggestions,
    batchPlan,
    addFiles,
    removeFile,
    clearFiles,
    clearSession,
    dismissRejected,
    selectTool,
    openTool,
    setBatchTool,
    addAllToBatch,
    removeFromBatch,
    clearBatch,
    launchBatch,
    launchHandoff,
    launchingSlug,
    launchFailedSlug,
  };
}

"use client";

import { useEffect, useState, type ComponentType } from "react";
import { ErrorNote, Spinner } from "./runner-kit";
import type { LoadedPdf } from "./use-single-pdf";

/** The editor's chunk did not arrive (shown inline, with a retry). */
export const PANEL_LOAD_FAILED =
  "The editor didn't load. Check your connection and try again.";

/** What a single-PDF tool's editor takes from `SinglePdfRunner`. */
export interface PanelProps {
  pdf: LoadedPdf;
  onReset: () => void;
}

/**
 * An editor that is NOT in its page's first load, for a runner kind that
 * several tools share (`n-up`, `metadata`): each page pays for its own
 * editor, fetched when a file opens, and never for a sibling's.
 *
 * `prepare` goes to `SinglePdfRunner`, which runs it beside the file's
 * parse and awaits it before the editor first draws (`useSinglePdf`): the
 * chunk (and `also`, an engine the editor imports lazily) costs no round
 * trip of its own. Once it has resolved, `Panel` draws the editor directly
 * — no fallback frame, nothing that moves when it arrives. Only if `prepare`
 * did not finish (it failed; a test mounts the runner without opening a
 * file through it) does `Panel` fetch the chunk itself, showing `opening`
 * until it lands.
 *
 * A chunk that fails to arrive is an inline `ErrorNote` with "Try again",
 * which fetches it anew (webpack forgets a failed chunk, so a second
 * `import()` requests it again). As first written this fell back to
 * `React.lazy`, which throws a failed import to the error boundary: on a
 * flaky connection the whole tool became "This tool hit an unexpected
 * snag" (review of 6376d6da) — where a failed pdf-lib chunk on the same
 * page shows a message and keeps the page usable. `lazy-panel.test.tsx`.
 *
 * The property — no shared-kind page's first load carries a sibling's
 * editor — is measured on the build by `src/deploy/variant-panels.test.ts`.
 */
export function lazyPanel(
  load: () => Promise<ComponentType<PanelProps>>,
  opening: string,
  also?: () => Promise<unknown>,
): {
  Panel: (props: PanelProps) => React.JSX.Element;
  prepare: () => Promise<void>;
} {
  let loaded: ComponentType<PanelProps> | null = null;
  const fetchPanel = () =>
    load().then((component) => {
      loaded = component;
      return component;
    });
  const prepare = async () => {
    await Promise.all([fetchPanel(), also?.()]);
  };
  function Panel(props: PanelProps) {
    // The editor's element type changes once, from nothing to the editor:
    // never after it has drawn, which would remount it and drop every
    // option the reader had set.
    const [state, setState] = useState<
      { editor: ComponentType<PanelProps> } | "loading" | "failed"
    >(() => (loaded ? { editor: loaded } : "loading"));
    useEffect(() => {
      if (state !== "loading") return;
      let live = true;
      fetchPanel().then(
        (editor) => {
          if (live) setState({ editor });
        },
        () => {
          if (live) setState("failed");
        },
      );
      return () => {
        live = false;
      };
    }, [state]);
    if (typeof state === "object") return <state.editor {...props} />;
    if (state === "failed")
      return (
        <ErrorNote
          message={PANEL_LOAD_FAILED}
          action={
            <button
              type="button"
              onClick={() => setState("loading")}
              className="font-semibold underline underline-offset-2"
            >
              Try again
            </button>
          }
        />
      );
    return (
      <p className="text-muted inline-flex items-center gap-2 text-sm">
        <Spinner /> {opening}
      </p>
    );
  }
  return { Panel, prepare };
}

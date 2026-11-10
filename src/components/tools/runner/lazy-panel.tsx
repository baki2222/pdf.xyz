"use client";

import { lazy, Suspense, useState, type ComponentType } from "react";
import { Spinner } from "./runner-kit";
import type { LoadedPdf } from "./use-single-pdf";

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
 * — no Suspense boundary, so no fallback frame and nothing that moves when
 * it arrives. Only if `prepare` did not finish (it failed; a test mounts
 * the runner without opening a file through it) does `Panel` suspend,
 * showing `opening` until the chunk lands.
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
  const Lazy = lazy(() =>
    fetchPanel().then((component) => ({ default: component })),
  );
  const prepare = async () => {
    await Promise.all([fetchPanel(), also?.()]);
  };
  function Panel(props: PanelProps) {
    // Chosen ONCE per mount: switching from the lazy path to the direct one
    // on a later render would swap the element type and remount the editor,
    // dropping every option the reader had set.
    const [Loaded] = useState(() => loaded);
    if (Loaded) return <Loaded {...props} />;
    return (
      <Suspense
        fallback={
          <p className="text-muted inline-flex items-center gap-2 text-sm">
            <Spinner /> {opening}
          </p>
        }
      >
        <Lazy {...props} />
      </Suspense>
    );
  }
  return { Panel, prepare };
}

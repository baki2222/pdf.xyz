"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { registerPageTarget, type PageTarget } from "@/lib/intent/page-target";

/**
 * Make `target` the page's drop target while it is non-null
 * (`@/lib/intent/page-target`): a file dropped or pasted anywhere on the
 * page, and "Open files", come to it.
 *
 * It registers ONCE per activation, not per render: the registry is a stack
 * whose last entry wins, so re-registering on every render would move this
 * target above one that mounted after it (an editor's, a dialog's). Every
 * call reads the latest `target`, so a re-render's new name or busy state is
 * what the page sees.
 */
export function usePageTarget(target: PageTarget | null): void {
  const latest = useRef(target);
  useLayoutEffect(() => {
    latest.current = target;
  });
  const active = target !== null;
  useEffect(() => {
    if (!active) return;
    const now = () => latest.current;
    return registerPageTarget({
      get name() {
        return now()?.name ?? "";
      },
      get verb() {
        return now()?.verb ?? "open";
      },
      get current() {
        return now()?.current;
      },
      canReceive: () => now()?.canReceive() ?? false,
      takes: (file) => now()?.takes(file) ?? false,
      receive: (files, via) => now()?.receive(files, via),
      // Present only while the target has a picker of its own, so "Open
      // files" falls back to the page's when it has none.
      get pick() {
        return now()?.pick ? () => now()?.pick?.() : undefined;
      },
      arm: (on) => now()?.arm(on),
      element: () => now()?.element() ?? null,
    });
  }, [active]);
}

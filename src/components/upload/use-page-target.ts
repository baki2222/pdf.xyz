"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { PageTarget } from "@/lib/intent/page-target";

/**
 * Make `target` the page's drop target while it is non-null
 * (`@/lib/intent/page-target`): a file dropped or pasted anywhere on the
 * page, and "Open files", come to it.
 *
 * It registers ONCE per activation, not per render: the registry is a stack
 * whose last entry wins, so re-registering on every render would move this
 * target above one that mounted after it (an editor's, a dialog's). Every
 * call reads the latest `target` (`registerLatest`), so a re-render's new
 * name or busy state is what the page sees.
 *
 * THE REGISTRY IS IMPORTED HERE, ON MOUNT — not with the page. It is the
 * drop layer's (fetched on idle, or with the first file), and a page reaches
 * it through the same `import()` the layer does, so the two share one chunk
 * and one module. Order is kept: registrations resolve in the order their
 * effects ran, as a synchronous call would have made them, and each is in
 * the stack before the layer routes a file through the same import — this
 * callback was attached first. A target that leaves before the registry
 * arrives never registers.
 */
export function usePageTarget(target: PageTarget | null): void {
  const latest = useRef(target);
  useLayoutEffect(() => {
    latest.current = target;
  });
  const active = target !== null;
  useEffect(() => {
    if (!active) return;
    let off: (() => void) | undefined;
    let mounted = true;
    import("@/lib/intent/page-target").then(
      ({ registerLatest }) => {
        if (mounted) off = registerLatest(latest);
      },
      // Offline, or a deploy replaced the chunk: the page has no target,
      // and the layer — whose routing needs the same chunk — says so when a
      // file arrives.
      () => {},
    );
    return () => {
      mounted = false;
      off?.();
    };
  }, [active]);
}

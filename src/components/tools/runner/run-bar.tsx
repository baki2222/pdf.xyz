"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A runner's action row — its Run button and whatever sits beside it —
 * docked to the bottom of a phone's screen while the runner is in view, so
 * the run is never a scroll away from the options it runs with.
 *
 * It WRAPS the row the runner already renders: the same DOM nodes, so the
 * button a keyboard user is on is the one that docks, and nothing is
 * rendered twice. From `sm` up it is the plain row it always was. How it
 * docks is one rule in the stylesheet (`[data-run-dock]`, below `sm`).
 *
 * Docked, it sits above the consent banner while that is open (the banner
 * publishes its height as `--sf-bottom-inset`) and above the home bar
 * (`env(safe-area-inset-bottom)`). It publishes its own height as
 * `--sf-dock-h`, which the stylesheet adds to the page's scroll padding
 * (`html:has([data-run-dock])`), so a control the keyboard moves to is
 * scrolled clear of the dock instead of under it (WCAG 2.4.11;
 * `e2e/run-dock.mobile.spec.ts` tabs through a panel to prove it).
 */
export function RunBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    const root = document.documentElement;
    if (!node || typeof ResizeObserver === "undefined") return;
    const publish = () =>
      root.style.setProperty("--sf-dock-h", `${node.offsetHeight}px`);
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    publish();
    return () => {
      observer.disconnect();
      root.style.removeProperty("--sf-dock-h");
    };
  }, []);
  return (
    <div ref={ref} data-run-dock="" className={className}>
      {children}
    </div>
  );
}

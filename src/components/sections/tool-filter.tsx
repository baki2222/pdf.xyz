"use client";

import type { MouseEvent, ReactNode } from "react";

/**
 * The home page's chips, made to work: a click on a chip presses it, and
 * shows only the cards of its family.
 *
 * EVERYTHING IS THE SERVER'S. The chips, the status line and every card
 * arrive as server markup (`./tool-grid`), all cards shown and "All"
 * pressed, so with no script every tool shows and a crawler reads all of
 * them (`tool-grid.test.tsx`, from the rendered page). This wrapper carries
 * no markup, no class names and no catalogue — only the click — so the home
 * page's own script grows by a few hundred bytes, not by the grid.
 *
 * It writes three things, all on the server's own nodes: each chip's
 * `aria-pressed`, each card item's `hidden`, and the status line's words.
 * React renders none of them again: this component has no state, and the
 * markup it wraps is static server output.
 */
export function ToolFilter({ children }: { children: ReactNode }) {
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const chip = (event.target as Element).closest<HTMLElement>(
      "button[data-family]",
    );
    if (!chip) return;
    const family = chip.dataset.family;
    const root = event.currentTarget;
    for (const c of root.querySelectorAll("button[data-family]"))
      c.setAttribute("aria-pressed", String(c === chip));
    for (const li of root.querySelectorAll<HTMLElement>("li[data-family]"))
      li.hidden = family !== "all" && li.dataset.family !== family;
    const status = root.querySelector("[role=status]");
    if (status) status.textContent = chip.dataset.say ?? "";
  };
  return <div onClick={onClick}>{children}</div>;
}

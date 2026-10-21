"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A family's chip: its id, its word, and how many tools it holds. */
export interface FilterChip {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

/** One card, drawn on the server, with the family it belongs to. */
export interface FilterCard {
  readonly slug: string;
  readonly family: string;
  readonly card: ReactNode;
}

const ALL = "all";

/*
 * The chip, in the same utilities as /tools' category chips
 * (`tools-explorer.tsx`), so the home page adds no CSS for it. The site's
 * focus outline is a button's own.
 */
const CHIP =
  "rounded-tag inline-flex h-9 shrink-0 items-center gap-1.5 border px-3.5 text-sm font-medium whitespace-nowrap transition-colors";
const CHIP_ON = "bg-invert text-fg-invert border-transparent";
const CHIP_OFF =
  "border-line text-muted hover:border-line-strong hover:bg-wash hover:text-fg";

/**
 * The home page's chips and the card grid they filter.
 *
 * THE CARDS ARE THE SERVER'S. Each arrives drawn — icon, name, summary,
 * badge — so this module carries no catalogue and no icon registry; it only
 * decides which items show. Every card is in the server's HTML, none hidden:
 * with no script the chips do nothing and every tool shows, and a crawler
 * reads all of them (`tool-grid.test.tsx`, from the rendered page).
 *
 * The chips are toggle buttons (`aria-pressed`) in a named group: one is
 * pressed at a time, "All" first. A filter is said once, politely, in a
 * status line.
 */
export function ToolFilter({
  label,
  chips,
  cards,
}: {
  /** Names the chip group, e.g. "Filter tools by category". */
  label: string;
  chips: readonly FilterChip[];
  cards: readonly FilterCard[];
}) {
  const [on, setOn] = useState(ALL);
  const chosen = chips.find((c) => c.id === on);
  return (
    <>
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        {[{ id: ALL, label: "All", count: cards.length }, ...chips].map(
          (chip) => {
            const pressed = on === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                aria-pressed={pressed}
                onClick={() => setOn(chip.id)}
                className={cn(CHIP, pressed ? CHIP_ON : CHIP_OFF)}
              >
                {chip.label}{" "}
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    pressed ? "text-fg-invert/70" : "text-faint",
                  )}
                >
                  {chip.count}
                </span>
              </button>
            );
          },
        )}
      </div>
      <p role="status" className="sr-only">
        {chosen ? `Showing ${chosen.count} ${chosen.label} tools` : ""}
      </p>
      <ul
        data-tool-grid=""
        className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5"
      >
        {cards.map((c) => (
          <li key={c.slug} hidden={on !== ALL && c.family !== on}>
            {c.card}
          </li>
        ))}
      </ul>
    </>
  );
}

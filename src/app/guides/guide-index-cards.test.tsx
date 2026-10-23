// @vitest-environment jsdom
/**
 * Each card on the guides index wears its tool's tile, as the tool cards do
 * (owner, 2026-10-23: "/guides is still developer style").
 *
 * WAS a mono-capital eyebrow ("MERGE PDF") over the title and no colour,
 * while every tool card on the site had taken the home card's family tile.
 *
 * Pinned as a relationship: each card's tile is the family colour of the
 * guide's OWN primary tool (`guide.tools[0]`), and its glyph that tool's
 * icon — read from the drawn `data-icon`, not the card's idea of it. The
 * cards are discovered from the page as rendered, with a size health check.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import GuidesPage from "./page";
import { guides } from "@/lib/guides";
import { getToolBySlug } from "@/lib/tools";
import { familyIdOf } from "@/lib/tools/family-id";

const MONO = /(^|\s)(font-mono|uppercase|kicker)(\s|$)/;

describe("the guides index cards", () => {
  it("health: every guide is a card, and every guide names a tool", () => {
    const { container } = render(<GuidesPage />);
    const cards = container.querySelectorAll("[data-guide-card]");
    expect(cards.length).toBe(guides.length);
    expect(guides.length).toBeGreaterThan(5);
    for (const g of guides)
      expect(getToolBySlug(g.tools[0] ?? ""), g.slug).toBeDefined();
  });

  it("each card wears its primary tool's family tile and icon", () => {
    const { container } = render(<GuidesPage />);
    for (const guide of guides) {
      const card = container.querySelector(
        `[data-guide-card="${guide.slug}"]`,
      )!;
      const tool = getToolBySlug(guide.tools[0]!)!;
      const tile = card.querySelector("[data-tile]");
      expect(tile, `${guide.slug}: no tile`).not.toBeNull();
      expect(
        (tile!.getAttribute("class") ?? "").split(/\s+/),
        guide.slug,
      ).toContain(`bg-cat-${familyIdOf(tool.category)}`);
      expect(
        tile!.querySelector("[data-icon]")?.getAttribute("data-icon"),
        guide.slug,
      ).toBe(tool.icon);
    }
  });

  it("no card wears a mono or capitals eyebrow", () => {
    const { container } = render(<GuidesPage />);
    const offenders = [
      ...container.querySelectorAll("[data-guide-card], [data-guide-card] *"),
    ]
      .filter((el) => MONO.test(el.getAttribute("class") ?? ""))
      .map((el) => el.textContent);
    expect(offenders).toEqual([]);
  });

  it("positive control: the eyebrow that shipped is caught", () => {
    expect(
      MONO.test(
        "text-faint font-mono text-[11px] font-medium tracking-wide uppercase",
      ),
    ).toBe(true);
  });
});

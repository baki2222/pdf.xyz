// @vitest-environment jsdom
/**
 * A tool card, on every surface that shows one: `/tools`, the eight category
 * pages, a tool page's Related tools and a guide's Tools used.
 *
 * WHAT A CARD CARRIES (2026-10-23, the home card everywhere): its family's
 * coloured tile with the tool's own glyph (decorative), its name as the
 * card's one heading (an `<h3>` — no new heading, so no surface's outline
 * changes), the badge, its plain one-line summary (`cardSummary`), and where
 * it runs in the mode's plain word — and nothing in mono or capitals.
 *
 * WAS (redesign C.3, WP-06) the full tagline, the formats it takes and makes
 * on one mono line ("JPG, PNG → PDF") and the mode's mono short word
 * ("SECURE WORKER"). This file pinned all three; the test is inverted below,
 * with the formats line's own checks kept on the tool page's facts row,
 * which still shows it.
 *
 * WHERE THE ICON COMES FROM is the part with a cost. The icon registry
 * (`@/lib/icons`) is about fifty lucide glyphs; `/tools` renders its cards
 * inside a client component, so a card that drew its own icon would ship the
 * whole registry to that page (measured ~3.9 KB gz against 1.6 KB of
 * headroom). So the card markup (`ToolCardView`) takes its icon as a node;
 * `ToolCard` — what the server surfaces render — draws it; and `/tools`
 * renders every icon on the server and hands them to the explorer. The last
 * check below holds that chain on the page as served.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ToolCard } from "./tool-card";
import { FormatsLine } from "./formats-line";
import { getToolBySlug, tools } from "@/lib/tools";
import { familyOf } from "@/lib/tools/families";
import { cardSummary } from "@/lib/tools/page-copy";
import { processingMeta } from "@/lib/tools/processing";
import { formatsLine } from "@/lib/tools/formats-line";
import { normalizeFormatLabel } from "@/lib/jobs/mime-by-format";
import ToolsPage from "@/app/tools/page";

/** The card link for `slug` inside `scope`. */
function cardFor(scope: HTMLElement, slug: string): HTMLElement {
  const link = scope.querySelector<HTMLElement>(`a[href="/tools/${slug}"]`);
  expect(link, `no card links /tools/${slug}`).not.toBeNull();
  return link!;
}

describe("ToolCard", () => {
  it("renders a tool's name and links to its page", () => {
    const tool = getToolBySlug("merge-pdf");
    expect(tool).toBeDefined();

    render(<ToolCard tool={tool!} />);

    expect(screen.getByText(tool!.name)).toBeInTheDocument();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", `/tools/${tool!.slug}`);
  });

  it("every tool's card: one h3, its plain summary, where it runs, its family's tile and its own icon", () => {
    // Health: the catalogue, not a sample.
    expect(tools.length).toBeGreaterThanOrEqual(40);
    for (const tool of tools) {
      const { container, unmount } = render(<ToolCard tool={tool} />);
      const card = cardFor(container, tool.slug);
      const headings = card.querySelectorAll("h1,h2,h3,h4,h5,h6");
      expect(
        [...headings].map((h) => h.tagName),
        tool.slug,
      ).toEqual(["H3"]);
      expect(headings[0]!.textContent, tool.slug).toBe(tool.name);
      expect(card.textContent, tool.slug).toContain(cardSummary(tool));
      expect(card.textContent, tool.slug).toContain(
        processingMeta[tool.processing].plain,
      );
      const tile = card.querySelector("[data-tile]");
      expect(
        tile?.classList.contains(`bg-cat-${familyOf(tool)}`),
        tool.slug,
      ).toBe(true);
      expect(tile?.classList.contains("text-cat-ink"), tool.slug).toBe(true);
      const icon = card.querySelector("[data-icon]");
      expect(icon?.getAttribute("data-icon"), tool.slug).toBe(tool.icon);
      expect(icon?.closest("[aria-hidden]"), tool.slug).not.toBeNull();
      unmount();
    }
  });

  /*
   * Inverted 2026-10-23. Every card wore "PDF → PDF" and "IN-BROWSER" in mono
   * capitals, and the home cards — the only ones a first-time visitor could
   * read — wore neither. Held for EVERY tool's card, so a surface cannot
   * bring the old foot back for one category.
   */
  it("no card wears a mono or uppercase label, a format arrow, or says 'worker'", () => {
    const offenders: string[] = [];
    for (const tool of tools) {
      const { container, unmount } = render(<ToolCard tool={tool} />);
      const card = cardFor(container, tool.slug);
      for (const el of [card, ...card.querySelectorAll<HTMLElement>("*")]) {
        const cls = el.getAttribute("class") ?? "";
        if (/(^|\s)(font-mono|uppercase|kicker)(\s|$)/.test(cls))
          offenders.push(`${tool.slug}: ${cls}`);
      }
      if (/→|\bworkers?\b/i.test(card.textContent ?? ""))
        offenders.push(`${tool.slug}: ${card.textContent}`);
      unmount();
    }
    expect(offenders).toEqual([]);
  });

  it("positive control: the predicate sees a mono capital label and a format arrow", () => {
    const { container } = render(
      <div>
        <span className="text-muted font-mono uppercase">PDF → PDF</span>
      </div>,
    );
    const el = container.querySelector("span")!;
    expect(/(^|\s)(font-mono|uppercase|kicker)(\s|$)/.test(el.className)).toBe(
      true,
    );
    expect(/→/.test(el.textContent ?? "")).toBe(true);
  });

  it("the formats line (a tool page's facts row) is said, not drawn, to a screen reader", () => {
    const tool = getToolBySlug("jpg-to-pdf")!;
    const { container } = render(<FormatsLine tool={tool} />);
    const card = container as HTMLElement;
    // The arrow is hidden; the sentence carries the same facts.
    // "JPG, PNG" until 2026-10-30, when the accept row gained WebP, GIF, BMP.
    expect(
      within(card).getByText("JPG, PNG, WEBP, GIF, BMP → PDF"),
    ).toHaveAttribute("aria-hidden");
    expect(card.textContent).toContain(
      "Takes JPG, PNG, WEBP, GIF, BMP; makes PDF.",
    );
  });
});

describe("formatsLine", () => {
  it("names every format a tool takes and makes, once, in one spelling, and never the ZIP", () => {
    for (const tool of tools) {
      const { takes, makes } = formatsLine(tool);
      expect(takes.length, tool.slug).toBeGreaterThan(0);
      expect(makes.length, tool.slug).toBeGreaterThan(0);
      expect(new Set(takes).size, tool.slug).toBe(takes.length);
      expect(new Set(makes).size, tool.slug).toBe(makes.length);
      for (const alias of ["JPEG", "HTM", "MARKDOWN"])
        expect([...takes, ...makes], tool.slug).not.toContain(alias);
      // ZIP is packaging: whether a run hands one over depends on the run,
      // which a list cannot say (in-browser-claims.test.ts caught
      // "PDF → JPG, ZIP" on the first run of this line).
      expect(makes, tool.slug).not.toContain("ZIP");
      // Complete: every other format the catalogue lists is named.
      for (const label of tool.outputs.filter((f) => f !== "ZIP"))
        expect(makes, tool.slug).toContain(normalizeFormatLabel(label));
      for (const label of tool.accept)
        expect(takes, tool.slug).toContain(normalizeFormatLabel(label));
    }
    // Controls: an alias folds into its format; order is the catalogue's;
    // the ZIP is dropped, the formats it packages are not.
    expect(
      formatsLine({ accept: ["JPG", "JPEG", "PNG"], outputs: ["PDF"] }),
    ).toEqual({ takes: ["JPG", "PNG"], makes: ["PDF"] });
    expect(
      formatsLine({ accept: ["PDF"], outputs: ["JPG", "ZIP"] }).makes,
    ).toEqual(["JPG"]);
    expect(formatsLine({ accept: ["URL"], outputs: ["PDF"] })).toEqual({
      takes: ["URL"],
      makes: ["PDF"],
    });
  });
});

describe("/tools as rendered by its page", () => {
  it("gives every card its own tool's icon, drawn on the server", () => {
    const { container } = render(<ToolsPage />);
    const missing = tools.filter(
      (tool) =>
        cardFor(container, tool.slug)
          .querySelector("[data-icon]")
          ?.getAttribute("data-icon") !== tool.icon,
    );
    expect(missing.map((t) => t.slug)).toEqual([]);
  });
});

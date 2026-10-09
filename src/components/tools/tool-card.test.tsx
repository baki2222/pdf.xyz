// @vitest-environment jsdom
/**
 * A tool card, on every surface that shows one: `/tools`, the eight category
 * pages, a tool page's Related tools and a guide's Tools used.
 *
 * WHAT A CARD CARRIES (redesign C.3, WP-06): the tool's icon (decorative),
 * its name as the card's one heading (an `<h3>` — no new heading, so no
 * surface's outline changes), the badge, the FULL tagline in the DOM (the
 * two-line clamp is visual only), the formats it takes and makes on one mono
 * line ("JPG, PNG → PDF"), and where it runs in the mode's own short word.
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
import { getToolBySlug, tools } from "@/lib/tools";
import { processingMeta } from "@/lib/tools/processing";
import { formatsLine } from "@/lib/tools/formats-line";
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

  it("every tool's card: one h3, the whole tagline, its formats, where it runs, and its own icon", () => {
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
      expect(card.textContent, tool.slug).toContain(tool.tagline);
      expect(card.textContent, tool.slug).toContain(
        processingMeta[tool.processing].short,
      );
      const { takes, makes } = formatsLine(tool);
      expect(
        within(card).getByText(`${takes.join(", ")} → ${makes.join(", ")}`),
        tool.slug,
      ).toBeInTheDocument();
      const icon = card.querySelector("[data-icon]");
      expect(icon?.getAttribute("data-icon"), tool.slug).toBe(tool.icon);
      expect(icon?.closest("[aria-hidden]"), tool.slug).not.toBeNull();
      unmount();
    }
  });

  it("the formats line is said, not drawn, to a screen reader", () => {
    const tool = getToolBySlug("jpg-to-pdf")!;
    const { container } = render(<ToolCard tool={tool} />);
    const card = cardFor(container, tool.slug);
    // The arrow is hidden; the sentence carries the same facts.
    expect(within(card).getByText("JPG, PNG → PDF")).toHaveAttribute(
      "aria-hidden",
    );
    expect(card.textContent).toContain("Takes JPG, PNG; makes PDF.");
  });
});

describe("formatsLine", () => {
  it("names each format a tool takes and makes once, in one spelling", () => {
    for (const tool of tools) {
      const { takes, makes } = formatsLine(tool);
      expect(takes.length, tool.slug).toBeGreaterThan(0);
      expect(makes.length, tool.slug).toBeGreaterThan(0);
      expect(new Set(takes).size, tool.slug).toBe(takes.length);
      expect(new Set(makes).size, tool.slug).toBe(makes.length);
      for (const alias of ["JPEG", "HTM", "MARKDOWN"])
        expect([...takes, ...makes], tool.slug).not.toContain(alias);
    }
    // Controls: an alias folds into its format; order is the catalogue's.
    expect(
      formatsLine({ accept: ["JPG", "JPEG", "PNG"], outputs: ["PDF"] }),
    ).toEqual({ takes: ["JPG", "PNG"], makes: ["PDF"] });
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

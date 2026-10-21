// @vitest-environment jsdom
/**
 * The home page's tools, as cards (owner's brief, 2026-10-21): every tool in
 * the catalogue, server-rendered with its plain summary and where it runs,
 * under chips that filter on the client — and with no script, every card.
 *
 * WAS a table of contents: fifty dot-leader rows under eight category heads,
 * each row wearing a mono uppercase mode label ("SECURE WORKER"), and on a
 * phone only three rows per category shown (the tool-showcase test,
 * retired with the section; its "links every tool" property lives on here).
 *
 * Read from the RENDERED HOME PAGE (`renderToStaticMarkup(<HomePage />)`),
 * the markup a crawler and a no-script visitor get, not from the grid alone:
 * a grid that was right and never reached the page cannot pass. The filter
 * is driven through Testing Library on the same page.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";
import { tools } from "@/lib/tools";
import { toolFamilies } from "@/lib/tools/families";
import { cardSummary } from "@/lib/tools/page-copy";
import { processingMeta } from "@/lib/tools/processing";

function served(): Document {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(<HomePage />),
    "text/html",
  );
}

/** The cards: the items of the tools section's list of links. */
function cards(root: ParentNode): HTMLLIElement[] {
  return [
    ...root.querySelectorAll<HTMLLIElement>(
      "section#tools ul[data-tool-grid] > li",
    ),
  ];
}

const visible = (li: HTMLElement) => !li.hidden;

describe("the home page's tool cards, as served", () => {
  it("health: the catalogue is the real one", () => {
    expect(tools.length).toBeGreaterThanOrEqual(40);
  });

  it("renders one card per tool, each a single link to its page", () => {
    const items = cards(served());
    expect(items).toHaveLength(tools.length);
    const hrefs = items.map((li) => {
      const links = li.querySelectorAll("a");
      expect(links, li.textContent ?? "").toHaveLength(1);
      return links[0]!.getAttribute("href");
    });
    expect(hrefs.sort()).toEqual(tools.map((t) => `/tools/${t.slug}`).sort());
  });

  it("each card names its tool, says its plain summary and where it runs", () => {
    const bySlug = new Map(
      cards(served()).map((li) => [
        li.querySelector("a")!.getAttribute("href")!.replace("/tools/", ""),
        li,
      ]),
    );
    for (const tool of tools) {
      const li = bySlug.get(tool.slug)!;
      expect(li, tool.slug).toBeDefined();
      expect(li.querySelector("h3")?.textContent, tool.slug).toBe(tool.name);
      const text = li.textContent ?? "";
      expect(text, tool.slug).toContain(cardSummary(tool));
      expect(text, tool.slug).toContain(processingMeta[tool.processing].plain);
    }
  });

  it("with no script, every card shows: none is hidden in the HTML", () => {
    const items = cards(served());
    expect(items.length).toBe(tools.length);
    expect(items.filter((li) => li.hasAttribute("hidden"))).toEqual([]);
    // Nor by a class that hides it at some width.
    expect(
      items.filter((li) => /(^|\s)(\w+:)?hidden(\s|$)/.test(li.className)),
    ).toEqual([]);
  });

  it("no card wears a mono or uppercase label, or says 'worker'", () => {
    const items = cards(served());
    expect(items.length).toBe(tools.length);
    const offenders: string[] = [];
    for (const li of items) {
      for (const el of [li, ...li.querySelectorAll<HTMLElement>("*")]) {
        const cls = el.getAttribute("class") ?? "";
        if (/\b(font-mono|uppercase|kicker)\b/.test(cls))
          offenders.push(`${li.textContent}: ${cls}`);
      }
      if (/\bworkers?\b/i.test(li.textContent ?? ""))
        offenders.push(`says worker: ${li.textContent}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the chips are toggle buttons in a named group: All, then each family, from the catalogue", () => {
    const doc = served();
    const group = doc.querySelector<HTMLElement>(
      'section#tools [role="group"]',
    );
    expect(group?.getAttribute("aria-label")).toMatch(/\S/);
    const chips = [...group!.querySelectorAll("button")];
    expect(chips.map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "true",
      ...toolFamilies().map(() => "false"),
    ]);
    expect(chips.map((b) => b.textContent?.replace(/\d+$/, "").trim())).toEqual(
      ["All", ...toolFamilies().map((f) => f.label)],
    );
  });
});

describe("the chips filter the cards", () => {
  it("a chip shows its family's cards alone, and All shows every card again", () => {
    const { container } = render(<HomePage />);
    const section = container.querySelector<HTMLElement>("section#tools")!;
    const group = within(section).getByRole("group");
    for (const family of toolFamilies()) {
      fireEvent.click(
        within(group).getByRole("button", {
          name: new RegExp(`^${family.label}\\b`),
        }),
      );
      const shown = cards(container).filter(visible);
      expect(shown.length, family.id).toBe(family.tools.length);
      expect(
        shown.map((li) => li.querySelector("a")!.getAttribute("href")).sort(),
        family.id,
      ).toEqual(family.tools.map((t) => `/tools/${t.slug}`).sort());
      expect(
        within(group)
          .getAllByRole("button")
          .filter((b) => b.getAttribute("aria-pressed") === "true")
          .map((b) => b.textContent?.replace(/\d+$/, "").trim()),
      ).toEqual([family.label]);
    }
    fireEvent.click(within(group).getByRole("button", { name: /^All\b/ }));
    expect(cards(container).filter(visible)).toHaveLength(tools.length);
  });
});

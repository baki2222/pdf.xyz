// @vitest-environment jsdom
/**
 * The /tools explorer, rendered: its headings, its live status, and its deep
 * links. Three findings, one component:
 *
 *  - the grid jumped from the page's H1 straight to fifty H3s — no H2, no
 *    category structure for crawlers or for heading navigation;
 *  - the result count and "No tools found" changed silently (WCAG 4.1.3);
 *  - `/tools` read `searchParams` on the server to seed the filter, which
 *    made the hub dynamic. The explorer now reads `?category=`/`?q=` itself,
 *    so these tests also pin that a deep link still filters and that first
 *    paint does not strip it from the URL.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANNOUNCE_DELAY_MS,
  ToolsExplorer,
  resultAnnouncement,
} from "./tools-explorer";
import { categories, getToolsByCategory, tools } from "@/lib/tools";
import { categoryHref } from "@/lib/tools/category-href";

function headingLevels(container: HTMLElement): number[] {
  return [...container.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) =>
    Number(h.tagName.slice(1)),
  );
}

const status = () => screen.getByRole("status");
const search = () => screen.getByRole("searchbox", { name: /search tools/i });

beforeEach(() => {
  window.history.replaceState(null, "", "/tools");
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ToolsExplorer headings", () => {
  it("groups every tool under an H2 per category, each linking its landing page", () => {
    const { container } = render(<ToolsExplorer />);
    const h2s = screen.getAllByRole("heading", { level: 2 });
    // Derived from `categories`: a category with tools has a heading.
    expect(h2s.map((h) => h.textContent?.replace(/\d+$/, "").trim())).toEqual(
      categories.map((c) => c.name),
    );
    for (const category of categories) {
      const heading = screen.getByRole("heading", {
        level: 2,
        name: new RegExp(`^${category.name.replace(/[&]/g, "\\$&")}`),
      });
      expect(within(heading).getByRole("link").getAttribute("href")).toBe(
        categoryHref(category.id),
      );
    }
    // No card heading comes before the first H2, and every tool is present.
    const levels = headingLevels(container);
    expect(levels[0]).toBe(2);
    expect(levels.filter((l) => l === 3)).toHaveLength(tools.length);
  });

  it("a search is one flat list under a hidden 'Search results' H2", () => {
    render(<ToolsExplorer />);
    fireEvent.change(search(), { target: { value: "pdf" } });
    const h2s = screen.getAllByRole("heading", { level: 2 });
    expect(h2s.map((h) => h.textContent)).toEqual(["Search results"]);
  });
});

describe("ToolsExplorer live status", () => {
  it("is silent on load, then announces the empty state after the pause", () => {
    vi.useFakeTimers();
    render(<ToolsExplorer />);
    expect(status().textContent).toBe("");
    fireEvent.change(search(), { target: { value: "zzzz" } });
    // Debounced: nothing is read out mid-typing.
    expect(status().textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    });
    expect(status().textContent).toContain("No tools match “zzzz”");
  });

  it("announces a non-zero count for a real search (positive control)", () => {
    vi.useFakeTimers();
    render(<ToolsExplorer />);
    fireEvent.change(search(), { target: { value: "merge" } });
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    });
    expect(status().textContent).toMatch(/^[1-9]\d* tools? for “merge”$/);
  });

  it("announces a category filter", () => {
    vi.useFakeTimers();
    render(<ToolsExplorer />);
    fireEvent.click(screen.getByRole("button", { name: /^AI/ }));
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    });
    expect(status().textContent).toBe(
      resultAnnouncement(getToolsByCategory("ai").length, {
        category: "ai",
        query: "",
      }),
    );
    expect(status().textContent).toMatch(/in AI Tools$/);
  });
});

describe("ToolsExplorer deep links (read in the browser, not on the server)", () => {
  it("applies ?category= and ?q= and leaves the URL as the reader arrived", () => {
    window.history.replaceState(null, "", "/tools?category=ai&q=chat");
    render(<ToolsExplorer />);
    const links = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"))
      .filter((h) => h?.startsWith("/tools/"));
    expect(links).toEqual(["/tools/chat-with-pdf"]);
    expect(search()).toHaveValue("chat");
    expect(window.location.search).toBe("?category=ai&q=chat");
  });

  it("an unknown category falls back to every tool, not an empty grid", () => {
    window.history.replaceState(null, "", "/tools?category=bogus");
    const { container } = render(<ToolsExplorer />);
    expect(headingLevels(container).filter((l) => l === 3)).toHaveLength(
      tools.length,
    );
  });

  it("writes the filter back once the reader changes it", () => {
    render(<ToolsExplorer />);
    fireEvent.click(screen.getByRole("button", { name: /^AI/ }));
    expect(window.location.search).toBe("?category=ai");
    fireEvent.click(screen.getByRole("button", { name: /^All tools/ }));
    expect(window.location.search).toBe("");
  });
});

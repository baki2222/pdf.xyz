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
import { toolAcceptsFormat } from "@/lib/intent/formats";
import { categories, getToolsByCategory, tools } from "@/lib/tools";
import { categoryHref } from "@/lib/tools/category-href";
import * as searchEngine from "@/lib/tools/search-tools";

function headingLevels(container: HTMLElement): number[] {
  return [...container.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) =>
    Number(h.tagName.slice(1)),
  );
}

const status = () => screen.getByRole("status");
const search = () => screen.getByRole("searchbox", { name: /search tools/i });

/**
 * The search engine is its own chunk, fetched on demand. Most tests hand the
 * explorer the module already in memory — still as a promise, the way the
 * real import arrives — and let it land inside act(); the tests of the
 * loading itself use the real import, a loader that never answers, and one
 * that fails.
 */
const engineNow = () => Promise.resolve(searchEngine);
const settle = () => act(async () => {});

beforeEach(() => {
  window.history.replaceState(null, "", "/tools");
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ToolsExplorer headings", () => {
  it("groups every tool under an H2 per category, each linking its landing page", () => {
    const { container } = render(<ToolsExplorer loadEngine={engineNow} />);
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

  it("a search is one ranked list under a visible H2 that says what kind of answer it is", async () => {
    // INVERTED 2026-10-09. This pinned a visually hidden "Search results"
    // heading over an unranked filter of the grid. The list is ranked now,
    // and it can be the best matches or only the closest ones, so the
    // heading a sighted reader sees says which — and it is still the one H2
    // the cards sit under.
    render(<ToolsExplorer loadEngine={engineNow} />);
    fireEvent.change(search(), { target: { value: "pdf" } });
    await settle();
    const h2s = screen.getAllByRole("heading", { level: 2 });
    expect(h2s.map((h) => h.textContent)).toEqual(["Best matches for “pdf”"]);
    expect(h2s[0]!.className).not.toMatch(/\bsr-only\b/);
  });
});

describe("ToolsExplorer live status", () => {
  it("is silent on load, then announces the empty state after the pause", async () => {
    vi.useFakeTimers();
    render(<ToolsExplorer loadEngine={engineNow} />);
    expect(status().textContent).toBe("");
    fireEvent.change(search(), { target: { value: "zzzz" } });
    await settle();
    // Debounced: nothing is read out mid-typing.
    expect(status().textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    });
    expect(status().textContent).toContain("No tools match “zzzz”");
  });

  it("announces a non-zero count for a real search (positive control)", async () => {
    vi.useFakeTimers();
    render(<ToolsExplorer loadEngine={engineNow} />);
    fireEvent.change(search(), { target: { value: "merge" } });
    await settle();
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    });
    expect(status().textContent).toMatch(/^[1-9]\d* tools? for “merge”$/);
  });

  it("announces a category filter", () => {
    vi.useFakeTimers();
    render(<ToolsExplorer loadEngine={engineNow} />);
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
  it("applies ?category= and ?q= and leaves the URL as the reader arrived", async () => {
    window.history.replaceState(null, "", "/tools?category=ai&q=chat");
    render(<ToolsExplorer loadEngine={engineNow} />);
    await settle();
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
    const { container } = render(<ToolsExplorer loadEngine={engineNow} />);
    expect(headingLevels(container).filter((l) => l === 3)).toHaveLength(
      tools.length,
    );
  });

  it("writes the filter back once the reader changes it", () => {
    render(<ToolsExplorer loadEngine={engineNow} />);
    fireEvent.click(screen.getByRole("button", { name: /^AI/ }));
    expect(window.location.search).toBe("?category=ai");
    fireEvent.click(screen.getByRole("button", { name: /^All tools/ }));
    expect(window.location.search).toBe("");
  });
});

/** The tool pages the explorer currently links, in order. */
const toolLinks = () =>
  screen
    .queryAllByRole("link")
    .map((a) => a.getAttribute("href"))
    .filter((h): h is string => Boolean(h?.match(/^\/tools\/[a-z0-9-]+$/)));

/**
 * The ranked search, as the reader receives it — deep links rendered after
 * hydration, the way `/tools?q=` arrives from the WebSite SearchAction.
 * The served HTML stays the whole catalogue (`ssr-content.test.ts` holds
 * that); these are the acceptance checks the redesign spec wrote for "the
 * served HTML", moved to where the ranking actually happens.
 */
describe("ToolsExplorer ranked search", () => {
  it("/tools?q=pdf%20jpg puts PDF to JPG first, under 'Best matches'", async () => {
    window.history.replaceState(null, "", "/tools?q=pdf%20jpg");
    render(<ToolsExplorer loadEngine={engineNow} />);
    await settle();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Best matches for “pdf jpg”",
      }),
    ).toBeInTheDocument();
    expect(toolLinks()[0]).toBe("/tools/pdf-to-jpg");
  });

  it("/tools?q=heic answers that nothing opens HEIC, and never offers Webpage to PDF", async () => {
    window.history.replaceState(null, "", "/tools?q=heic");
    render(<ToolsExplorer loadEngine={engineNow} />);
    await settle();
    const answer = screen.getByRole("region", {
      name: "No tool here opens HEIC photos.",
    });
    expect(
      within(answer).getByText(/Save a JPG copy first\./),
    ).toBeInTheDocument();
    expect(
      within(answer).getByRole("link", { name: /JPG to PDF/ }),
    ).toHaveAttribute("href", "/tools/jpg-to-pdf");
    expect(toolLinks()).not.toContain("/tools/webpage-to-pdf");
    // Every card heading still sits under an H2.
    expect(headingLevels(document.body)[0]).toBe(2);
  });

  it("labels the fallback: a query no tool matches in full shows 'Closest matches'", async () => {
    window.history.replaceState(null, "", "/tools?q=merge%20zzqx");
    render(<ToolsExplorer loadEngine={engineNow} />);
    await settle();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Closest matches for “merge zzqx”",
      }),
    ).toBeInTheDocument();
    expect(toolLinks()[0]).toBe("/tools/merge-pdf");
  });

  it("an empty result says so, offers the nearest names and the guides, and resets", async () => {
    window.history.replaceState(null, "", "/tools?q=mregee");
    render(<ToolsExplorer loadEngine={engineNow} />);
    await settle();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Nothing matches “mregee”",
      }),
    ).toBeInTheDocument();
    expect(toolLinks()).toEqual(["/tools/merge-pdf"]);
    expect(screen.getByRole("link", { name: /guides/i })).toHaveAttribute(
      "href",
      "/guides",
    );
    fireEvent.click(screen.getByRole("button", { name: /reset filters/i }));
    expect(toolLinks()).toHaveLength(tools.length);
  });

  it("noise gets no guesses", async () => {
    window.history.replaceState(null, "", "/tools?q=zzzz");
    render(<ToolsExplorer loadEngine={engineNow} />);
    await settle();
    expect(
      screen.getByRole("heading", { level: 2, name: "Nothing matches “zzzz”" }),
    ).toBeInTheDocument();
    expect(toolLinks()).toEqual([]);
  });

  it("an archive's answer leads to the tools that take what is inside", async () => {
    window.history.replaceState(null, "", "/tools?q=zip");
    render(<ToolsExplorer loadEngine={engineNow} />);
    await settle();
    const takesPdf = tools.filter((t) => toolAcceptsFormat(t.accept, "PDF"));
    fireEvent.click(
      screen.getByRole("button", {
        name: `Show the ${takesPdf.length} tools that take PDF`,
      }),
    );
    expect(window.location.search).toBe("?accepts=pdf");
    expect(new Set(toolLinks())).toEqual(
      new Set(takesPdf.map((t) => `/tools/${t.slug}`)),
    );
  });
});

describe("ToolsExplorer ?accepts=", () => {
  it("shows only the tools that take the format, with a chip that removes the filter", () => {
    window.history.replaceState(null, "", "/tools?accepts=docx");
    render(<ToolsExplorer loadEngine={engineNow} />);
    const expected = tools
      .filter((t) => toolAcceptsFormat(t.accept, "DOCX"))
      .map((t) => `/tools/${t.slug}`);
    expect(expected.length).toBeGreaterThan(0);
    expect(toolLinks()).toEqual(expected);
    fireEvent.click(screen.getByRole("button", { name: /takes docx/i }));
    expect(toolLinks()).toHaveLength(tools.length);
    expect(window.location.search).toBe("");
  });

  it("reads any spelling of the format, and keeps it through a category click", () => {
    window.history.replaceState(null, "", "/tools?accepts=JPEG");
    render(<ToolsExplorer loadEngine={engineNow} />);
    expect(
      screen.getByRole("button", { name: /takes jpg/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^All tools/ }));
    expect(window.location.search).toBe("?accepts=jpg");
  });

  it("negative control: an unknown or unsupported format filters nothing and shows no chip", () => {
    for (const value of ["bogus", "heic"]) {
      window.history.replaceState(null, "", `/tools?accepts=${value}`);
      const { unmount } = render(<ToolsExplorer loadEngine={engineNow} />);
      expect(toolLinks(), value).toHaveLength(tools.length);
      expect(
        screen.queryByRole("button", { name: /^takes/i }),
        value,
      ).toBeNull();
      unmount();
    }
  });
});

describe("resultAnnouncement", () => {
  it("says which kind of answer it is", () => {
    const state = {
      category: "all" as const,
      query: "merge zzqx",
      accepts: null,
    };
    expect(resultAnnouncement(3, state, { mode: "closest" })).toBe(
      "No tool matches every word of “merge zzqx”. 3 closest matches",
    );
    expect(
      resultAnnouncement(2, { category: "all", query: "", accepts: "DOCX" }),
    ).toBe("2 tools take DOCX");
    expect(
      resultAnnouncement(0, { category: "ai", query: "", accepts: "DOCX" }),
    ).toBe("No tools take DOCX in AI Tools");
    expect(
      resultAnnouncement(
        0,
        { category: "all", query: "heic", accepts: null },
        { unsupported: "No tool here opens HEIC photos." },
      ),
    ).toBe("No tool here opens HEIC photos. No tools match “heic”");
  });
});

describe("the search engine loads on demand, never with the page", () => {
  it("is not fetched on load; approaching the field fetches it, once", () => {
    const loader = vi.fn(engineNow);
    render(<ToolsExplorer loadEngine={loader} />);
    expect(loader).not.toHaveBeenCalled();
    fireEvent.pointerEnter(search());
    fireEvent.focus(search());
    fireEvent.change(search(), { target: { value: "merge" } });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("a deep link with a query fetches the real chunk at once, and marks the results it ranked", async () => {
    window.history.replaceState(null, "", "/tools?q=pdf%20jpg");
    render(<ToolsExplorer />);
    const heading = await screen.findByRole("heading", {
      level: 2,
      name: "Best matches for “pdf jpg”",
    });
    // The marker the bundle tests find this chunk by, rendered from the
    // module the browser actually loaded.
    expect(heading.closest("section")).toHaveAttribute(
      "data-chunk",
      searchEngine.SEARCH_ENGINE_CHUNK,
    );
  });

  it("while it loads, a query shows the served grid, busy, and announces nothing", () => {
    vi.useFakeTimers();
    const { container } = render(
      <ToolsExplorer loadEngine={() => new Promise(() => {})} />,
    );
    fireEvent.change(search(), { target: { value: "merge" } });
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_DELAY_MS * 2);
    });
    expect(status().textContent).toBe("");
    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((h) => h.textContent?.replace(/\d+$/, "").trim()),
    ).toEqual(categories.map((c) => c.name));
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("a chunk that fails to load leaves every tool and says how to search", async () => {
    // A tab holding a page from before a deploy asks for a chunk that no
    // longer exists. The page must not go blank, or reject unhandled.
    window.history.replaceState(null, "", "/tools?q=merge");
    render(
      <ToolsExplorer
        loadEngine={() => Promise.reject(new Error("ChunkLoadError"))}
      />,
    );
    await settle();
    expect(screen.getByRole("note")).toHaveTextContent(
      "Search could not load. Reload the page to search",
    );
    expect(toolLinks()).toHaveLength(tools.length);
    expect(
      screen.queryByRole("heading", { level: 2, name: /matches for/ }),
    ).toBeNull();
  });
});

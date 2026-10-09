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
import { UNSUPPORTED_FORMATS, toolAcceptsFormat } from "@/lib/intent/formats";
import { categories, getToolsByCategory, tools } from "@/lib/tools";
import { categoryHref } from "@/lib/tools/category-href";
import { processingSplit } from "@/lib/tools/processing-split";
import { runsChoices, whereItRuns } from "@/lib/tools/where-it-runs";
import * as searchEngine from "@/lib/tools/search-tools";

function headingLevels(container: HTMLElement): number[] {
  return [...container.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) =>
    Number(h.tagName.slice(1)),
  );
}

const status = () => screen.getByRole("status");
const search = () => screen.getByRole("searchbox", { name: /search tools/i });

/**
 * The visible result count beside the search field. Fails, rather than
 * returning null, when the count is gone: an assertion that it does NOT read
 * "50 tools" would otherwise pass on a page with no count at all.
 */
function countText(): string {
  const count = document.querySelector("[data-result-count]");
  expect(count, "the result count is not rendered").not.toBeNull();
  return count!.textContent ?? "";
}

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

/**
 * A query with a format filter on, where the FILTER is what emptied the list.
 *
 * WAS: "Nothing matches “merge”" on screen and "No tools match “merge”" in
 * the live region, at /tools?q=merge&accepts=docx — while Merge PDF matches
 * every word of "merge"; Takes DOCX is what removed it. Both sentences named
 * the category filter and never the format one. The reader reaches this by
 * pressing the ZIP answer's "Show the … tools that take PDF" and then typing.
 */
describe("ToolsExplorer: an empty list says which filter emptied it", () => {
  it("?q=merge&accepts=docx names the format filter, says it hides the match, and can show it", async () => {
    window.history.replaceState(null, "", "/tools?q=merge&accepts=docx");
    render(<ToolsExplorer loadEngine={engineNow} />);
    await settle();
    // Health: the query does match without the filter.
    expect(searchEngine.rankTools("merge").ranked.length).toBeGreaterThan(0);
    const heading = screen.getByRole("heading", { level: 2, name: /merge/ });
    expect(heading).toHaveTextContent(
      "Nothing that takes DOCX matches “merge”",
    );
    expect(heading.textContent).not.toBe("Nothing matches “merge”");
    expect(screen.getByText("The filter hides 1 match.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show the match" }));
    expect(toolLinks()).toEqual(["/tools/merge-pdf"]);
    expect(search()).toHaveValue("merge");
    expect(window.location.search).toBe("?q=merge");
  });

  it("announces the format filter, not a bare 'No tools match'", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/tools?accepts=docx");
    render(<ToolsExplorer loadEngine={engineNow} />);
    fireEvent.change(search(), { target: { value: "merge" } });
    await settle();
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    });
    expect(status().textContent).toBe(
      "No tools for “merge” take DOCX. The filter hides 1 match",
    );
  });

  it("control: a query nothing matches at all says so plainly, filter or not", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/tools?q=zzzz&accepts=docx");
    render(<ToolsExplorer loadEngine={engineNow} />);
    await settle();
    expect(
      screen.getByRole("heading", { level: 2, name: "Nothing matches “zzzz”" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/hides? \d+ match/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Show the/ })).toBeNull();
    fireEvent.change(search(), { target: { value: "zzzzz" } });
    await settle();
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    });
    expect(status().textContent).toBe("No tools match “zzzzz”");
  });

  it("the closest list's announcement keeps the format filter too", () => {
    expect(
      resultAnnouncement(
        1,
        { category: "all", query: "word zzqx", accepts: "DOCX" },
        { mode: "closest" },
      ),
    ).toBe(
      "No tool matches every word of “word zzqx”. 1 closest match that takes DOCX",
    );
  });
});

/**
 * The unsupported-format answer, read where the reader receives it: the
 * region the explorer renders for /tools?q=<format>, for every format the
 * site says it cannot open.
 *
 * WAS: these checks ran over `answerText()` in `@/lib/intent/unsupported`,
 * a function nothing rendered — the explorer composed its own sentences, so a
 * deferral or a wrong sentence in the rendered answer passed both (review of
 * WP-03; house rule 5). The function is gone; the checks read the DOM.
 */
describe("ToolsExplorer: the unsupported-format answer, as rendered", () => {
  /** Words that defer a capability to an unstated future. */
  const DEFERRAL = /\b(?:yet|soon|coming|planned|eventually)\b/i;

  async function renderedAnswer(format: string): Promise<HTMLElement | null> {
    window.history.replaceState(
      null,
      "",
      `/tools?q=${encodeURIComponent(format.toLowerCase())}`,
    );
    const view = render(<ToolsExplorer loadEngine={engineNow} />);
    await settle();
    const region = screen.queryByRole("region", {
      name: /^No tool here opens/,
    });
    const copy = region?.cloneNode(true) as HTMLElement | undefined;
    view.unmount();
    return copy ?? null;
  }

  it("renders for every unsupported format, and none of it defers to a future nobody promised", async () => {
    const texts: string[] = [];
    for (const format of UNSUPPORTED_FORMATS) {
      const region = await renderedAnswer(format);
      expect(region, `no answer rendered for ?q=${format}`).not.toBeNull();
      texts.push(region!.textContent ?? "");
    }
    // Health: one non-empty answer per format, each with its headline.
    expect(texts).toHaveLength(UNSUPPORTED_FORMATS.length);
    expect(texts.length).toBeGreaterThanOrEqual(10);
    for (const text of texts) expect(text).toMatch(/^No tool here opens /);
    expect(texts.filter((text) => DEFERRAL.test(text))).toEqual([]);
    // Positive control: the spec's own wording would have been caught.
    expect(DEFERRAL.test("No tool here takes HEIC files yet.")).toBe(true);
  });

  it("the HEIC answer reads, word for word, as the reader sees it", async () => {
    const region = await renderedAnswer("HEIC");
    const heading = region!.querySelector("h2");
    const body = heading?.nextElementSibling;
    expect(heading?.textContent).toBe("No tool here opens HEIC photos.");
    expect(body?.textContent).toBe(
      "Save a JPG copy first. JPG to PDF takes JPG and PNG.",
    );
  });

  it("an answer with no way in is its headline alone", async () => {
    const region = await renderedAnswer("EPUB");
    expect(region!.textContent).toBe("No tool here opens EPUB e-books.");
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

  it("while it loads, a query says it is searching above the served grid, busy, and announces nothing", () => {
    // INVERTED 2026-10-09. This pinned the served grid under its category
    // headings and nothing else while the engine loaded — with the count
    // beside the field still reading "50 tools". A reader who arrived on
    // /tools?q=heic saw the whole catalogue presented as the answer to
    // "heic" (review of WP-03, reproduced on the production build with the
    // chunk held back 4 s). The grid stays, every link in it, but under a
    // heading that says the search is still running.
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
    ).toEqual(["Searching for “merge”…", ...categories.map((c) => c.name)]);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("a deep link that arrives before the engine says it is searching, keeps every tool, and claims no count", async () => {
    // The WebSite SearchAction lands here: /tools?q=heic, the chunk not yet
    // in. Every tool link stays in the DOM (the page is still the served
    // catalogue), but nothing on screen may present it as the answer.
    const loader = vi.fn(() => new Promise<never>(() => {}));
    window.history.replaceState(null, "", "/tools?q=heic");
    render(<ToolsExplorer loadEngine={loader} />);
    await settle();
    // Health: the query was read and the engine asked for, so this IS the
    // pending state and not a page that ignored ?q=.
    expect(search()).toHaveValue("heic");
    expect(loader).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("heading", { level: 2, name: "Searching for “heic”…" }),
    ).toBeInTheDocument();
    expect(countText()).not.toMatch(/\d/);
    expect(countText()).not.toBe(`${tools.length} tools`);
    expect(toolLinks()).toHaveLength(tools.length);
    expect(
      screen.queryByRole("region", { name: /No tool here opens/ }),
    ).toBeNull();
  });

  it("positive control: the same deep link with an engine that answers shows the HEIC answer and a real count", async () => {
    window.history.replaceState(null, "", "/tools?q=heic");
    render(<ToolsExplorer loadEngine={engineNow} />);
    await settle();
    expect(
      screen.getByRole("region", { name: "No tool here opens HEIC photos." }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /^Searching for/ }),
    ).toBeNull();
    expect(countText()).toBe("0 tools");
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
    expect(
      screen.queryByRole("heading", { name: /^Searching for/ }),
    ).toBeNull();
  });

  it("a chunk that fails to load is what the live region says, not the unfiltered count", async () => {
    // WAS: the reader typed "merge" and heard "50 tools" — the count of the
    // unranked grid, read out as if it answered the query — while the note
    // that said search had failed was visible only. A tab left open across a
    // deploy reaches this on its first keystroke (WCAG 4.1.3).
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/tools?q=merge");
    render(
      <ToolsExplorer
        loadEngine={() => Promise.reject(new Error("ChunkLoadError"))}
      />,
    );
    await settle();
    fireEvent.change(search(), { target: { value: "merge pdf" } });
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    });
    expect(status().textContent).toBe(
      `Search could not load. Showing all ${tools.length} tools`,
    );
    expect(status().textContent).not.toBe(`${tools.length} tools`);
  });
});

/**
 * "Where it runs" — the filter a reader reaches for when the question is
 * whether their file leaves the device. Radios, not toggle buttons: one
 * choice at a time, arrow keys between them, and `getByRole("button",
 * {name: /^AI/})` still resolves to the AI CATEGORY chip alone (the smoke
 * e2e and the tests above select it that way).
 *
 * The choices and their counts are read from `whereItRuns(processingSplit())`
 * at assertion time, never typed: a tool that changes where it runs moves a
 * count here without this file changing.
 */
describe("ToolsExplorer: Where it runs", () => {
  const options = whereItRuns(processingSplit());
  /** What `app/tools/page.tsx` hands the explorer: the choices as slugs. */
  const RUNS = runsChoices(options);
  const group = () => screen.getByRole("radiogroup", { name: "Where it runs" });
  const radio = (name: RegExp) => within(group()).getByRole("radio", { name });
  const hrefsOf = (list: readonly { slug: string }[]) =>
    list.map((t) => `/tools/${t.slug}`);

  it("offers All, then one choice per place a tool runs, each named with its count", () => {
    render(<ToolsExplorer loadEngine={engineNow} runs={RUNS} />);
    const expected = [
      "All",
      ...options.map((o) => `${o.label} ${o.tools.length}`),
    ];
    // Each name resolves to exactly one radio, and there are no others.
    for (const name of expected) within(group()).getByRole("radio", { name });
    expect(within(group()).getAllByRole("radio")).toHaveLength(expected.length);
    expect(radio(/^All$/)).toBeChecked();
    // Health: the never-upload choice is there and is not the whole catalogue.
    expect(options[0]!.tools.length).toBeGreaterThan(0);
    expect(options[0]!.tools.length).toBeLessThan(tools.length);
  });

  it("choosing a place shows exactly its tools, keeps the URL shareable, and says so", () => {
    vi.useFakeTimers();
    render(<ToolsExplorer loadEngine={engineNow} runs={RUNS} />);
    const never = options[0]!;
    fireEvent.click(radio(/^Never uploads/));
    expect(radio(/^Never uploads/)).toBeChecked();
    expect(new Set(toolLinks())).toEqual(new Set(hrefsOf(never.tools)));
    expect(window.location.search).toBe("?runs=never-uploads");
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    });
    expect(status().textContent).toBe(
      `${never.tools.length} tools work without uploading`,
    );
    fireEvent.click(radio(/^All$/));
    expect(toolLinks()).toHaveLength(tools.length);
    expect(window.location.search).toBe("");
  });

  it("a deep link checks its choice and filters, after hydration", () => {
    window.history.replaceState(null, "", "/tools?runs=secure-worker");
    render(<ToolsExplorer loadEngine={engineNow} runs={RUNS} />);
    const worker = options.find((o) => o.id === "secure-worker")!;
    expect(radio(/^Secure worker/)).toBeChecked();
    expect(new Set(toolLinks())).toEqual(new Set(hrefsOf(worker.tools)));
  });

  it("without choices from the page there is no such filter, and ?runs= filters nothing", () => {
    window.history.replaceState(null, "", "/tools?runs=never-uploads");
    render(<ToolsExplorer loadEngine={engineNow} />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(toolLinks()).toHaveLength(tools.length);
  });

  it("negative control: an unknown ?runs= is All, never an empty grid", () => {
    window.history.replaceState(null, "", "/tools?runs=bogus");
    render(<ToolsExplorer loadEngine={engineNow} runs={RUNS} />);
    expect(radio(/^All$/)).toBeChecked();
    expect(toolLinks()).toHaveLength(tools.length);
  });

  it("combines with a category, and an empty combination says which filters emptied it and resets them all", () => {
    window.history.replaceState(
      null,
      "",
      "/tools?category=ai&runs=never-uploads",
    );
    render(<ToolsExplorer loadEngine={engineNow} runs={RUNS} />);
    // Health: no AI tool works without uploading, so this IS empty.
    expect(options[0]!.tools.filter((t) => t.category === "ai")).toEqual([]);
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "No tools work without uploading in AI Tools",
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reset filters/i }));
    expect(radio(/^All$/)).toBeChecked();
    expect(toolLinks()).toHaveLength(tools.length);
    expect(window.location.search).toBe("");
  });

  it("a query keeps the choice, and the count names it", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/tools?runs=ai");
    render(<ToolsExplorer loadEngine={engineNow} runs={RUNS} />);
    fireEvent.change(search(), { target: { value: "pdf" } });
    await settle();
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    });
    const ai = hrefsOf(options.find((o) => o.id === "ai")!.tools);
    expect(toolLinks().length).toBeGreaterThan(0);
    expect(toolLinks().filter((h) => !ai.includes(h))).toEqual([]);
    expect(status().textContent).toMatch(
      /^\d+ tools? for “pdf” that uses? AI$/,
    );
    expect(window.location.search).toBe("?runs=ai&q=pdf");
  });
});

describe("resultAnnouncement: where it runs", () => {
  it("names the place as a verb, beside the other filters", () => {
    expect(
      resultAnnouncement(29, {
        category: "all",
        query: "",
        runs: "never-uploads",
      }),
    ).toBe("29 tools work without uploading");
    expect(
      resultAnnouncement(1, {
        category: "all",
        query: "",
        runs: "browser-first",
      }),
    ).toBe("1 tool runs browser-first");
    expect(
      resultAnnouncement(3, {
        category: "organize",
        query: "",
        accepts: "PDF",
        runs: "never-uploads",
      }),
    ).toBe("3 tools take PDF and work without uploading in Organize");
    expect(
      resultAnnouncement(0, {
        category: "ai",
        query: "",
        runs: "secure-worker",
      }),
    ).toBe("No tools run on a secure worker in AI Tools");
    // Unchanged when no place is chosen: the sentences pinned above stand.
    expect(
      resultAnnouncement(0, { category: "ai", query: "", accepts: "DOCX" }),
    ).toBe("No tools take DOCX in AI Tools");
  });
});

// @vitest-environment jsdom
/**
 * The 404 page reads the address it was asked for.
 *
 * THE DEFECT. `/merge-pdf`, `/compress-pdf` and `/tools/pdf-to-docx` all
 * answered with the same six popular tools. The first two name a real tool
 * exactly (the path style other PDF sites use), and the third is one keyword
 * away from PDF to Word. The page could not use any of that.
 *
 * The subjects are DERIVED: every tool in the catalogue must be found from its
 * own slug typed at the site root, and the page must render that suggestion.
 * Negative control: a path that names no tool renders "No close match", never
 * a guess.
 *
 * WP-13 (D.10, E.12) turned the suggestion into `NotFoundAssist`: a reserved
 * 56px row (`data-slot`, so the layout-stability spec charges any shift in it
 * to the slot) that the island fills after idle, and a server-rendered GET
 * search form it pre-fills with the path's words. The form is what a reader
 * without JavaScript gets — `e2e/not-found.spec.ts` submits it with JS off.
 * The suggestion component this file used to drive,
 * `components/layout/missing-path-suggestion.tsx`, is no longer rendered.
 */
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAllToolSlugs, getToolBySlug, tools } from "@/lib/tools";
import { toolsForMissingPath } from "@/lib/tools/path-suggest";
import { pathQuery } from "@/lib/intent/path-query";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { default: NotFound } = await import("./not-found");
const { NotFoundAssist } = await import("@/components/intent/not-found-assist");

afterEach(() => {
  pathname = "/";
});

/**
 * The island fills its row after idle, from a matcher it imports on demand
 * (a static import put the whole catalogue in every route's first load). Every
 * test waits the same way, so the positive tests prove the wait is long
 * enough for the negative control.
 */
async function settle() {
  await act(async () => {
    await import("@/lib/tools/path-suggest");
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

async function renderAndSettle() {
  const view = render(<NotFound />);
  await settle();
  return view;
}

const row = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-slot="not-found-assist"]');

describe("toolsForMissingPath", () => {
  it("finds every tool from its own slug at the site root", () => {
    const slugs = getAllToolSlugs();
    expect(slugs.length).toBe(tools.length);
    expect(slugs.length).toBeGreaterThan(40);
    for (const slug of slugs) {
      expect(
        toolsForMissingPath(`/${slug}`).map((t) => t.slug),
        slug,
      ).toEqual([slug]);
    }
  });

  it("finds a tool from a keyword its slug does not spell", () => {
    const [first] = toolsForMissingPath("/tools/pdf-to-docx");
    expect(first?.keywords).toContain("pdf to docx");
  });

  it("finds Merge PDF from /merge, the spec's example (E.12)", () => {
    expect(toolsForMissingPath("/merge").map((t) => t.slug)).toEqual([
      "merge-pdf",
    ]);
  });

  it("negative control: a path that names no tool suggests nothing", () => {
    expect(toolsForMissingPath("/zzqx-vvbn")).toEqual([]);
    expect(toolsForMissingPath("/pdf")).toEqual([]);
    expect(toolsForMissingPath("/")).toEqual([]);
  });
});

describe("pathQuery: the address as words", () => {
  it("reads the last segment as words", () => {
    expect(pathQuery("/merge")).toBe("merge");
    expect(pathQuery("/pdf-to-doc")).toBe("pdf to doc");
    expect(pathQuery("/tools/pdf-to-docx")).toBe("pdf to docx");
    expect(pathQuery("/old/Compress_PDF.html")).toBe("compress pdf");
    expect(pathQuery("/a%20b")).toBe("a b");
  });

  it("an empty or malformed path is no words, never a throw", () => {
    expect(pathQuery("/")).toBe("");
    expect(pathQuery("")).toBe("");
    expect(pathQuery("/%E0%A4%A")).toBe("e0 a4 a");
  });
});

describe("the 404 page", () => {
  it("server-renders a GET search form that works without JavaScript", () => {
    // Rendered WITHOUT settling: this is the markup a reader with JS off gets.
    const { container } = render(<NotFound />);
    const form = container.querySelector("form")!;
    expect(form).not.toBeNull();
    expect(form.getAttribute("action")).toBe("/tools");
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("role")).toBe("search");
    const input = within(form).getByRole("searchbox");
    expect(input.getAttribute("name")).toBe("q");
    // A visible label, not a placeholder or an aria-label alone.
    const label = form.querySelector(`label[for="${input.id}"]`);
    expect(label?.textContent?.trim().length).toBeGreaterThan(3);
    expect(label?.className ?? "").not.toMatch(/sr-only/);
    expect(
      within(form).getByRole("button", { name: /search/i }),
    ).toHaveAttribute("type", "submit");
  });

  it("keeps the heading the e2e reads, and its status is the route's", () => {
    render(<NotFound />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "This page took a wrong turn",
      }),
    ).toBeInTheDocument();
  });

  it("reserves the assist row before anything fills it", () => {
    const { container } = render(<NotFound />);
    const slot = row(container);
    expect(slot).not.toBeNull();
    // A fixed height (56px), so filling it moves nothing below.
    expect(slot!.className).toMatch(/(?:^|\s)h-14(?:\s|$)/);
    expect(slot!.textContent?.trim()).toBe("");
  });

  it("suggests the tool the missing path names: /merge -> Merge PDF", async () => {
    pathname = "/merge";
    const { container } = await renderAndSettle();
    const merge = getToolBySlug("merge-pdf")!;
    const slot = row(container)!;
    expect(slot.textContent).toMatch(/did you mean merge pdf\?/i);
    expect(
      within(slot).getByRole("link", { name: merge.name }),
    ).toHaveAttribute("href", `/tools/${merge.slug}`);
  });

  it("offers PDF to Word for /tools/pdf-to-docx", async () => {
    pathname = "/tools/pdf-to-docx";
    const { container } = await renderAndSettle();
    const [expected] = toolsForMissingPath(pathname);
    expect(expected).toBeDefined();
    expect(
      within(row(container)!).getByRole("link", { name: expected!.name }),
    ).toHaveAttribute("href", `/tools/${expected!.slug}`);
  });

  it("pre-fills the server-rendered search input with the path's words", async () => {
    pathname = "/pdf-to-doc";
    await renderAndSettle();
    expect(screen.getByRole("searchbox")).toHaveValue("pdf to doc");
  });

  it("never overwrites what the reader already typed", async () => {
    pathname = "/merge";
    const { container, rerender } = render(<NotFound />);
    const input = screen.getByRole<HTMLInputElement>("searchbox");
    await settle();
    input.value = "split";
    pathname = "/compress";
    rerender(<NotFound />);
    await settle();
    expect(input.value).toBe("split");
    expect(row(container)).not.toBeNull();
  });

  it("negative control: an unrelated path says there is no close match, and links the search", async () => {
    pathname = "/zzqx-vvbn";
    const { container } = await renderAndSettle();
    const slot = row(container)!;
    expect(slot.textContent).toMatch(/no close match/i);
    expect(slot.textContent).not.toMatch(/did you mean/i);
    expect(
      within(slot).getByRole("link", { name: /search all tools/i }),
    ).toHaveAttribute("href", "/tools?q=zzqx%20vvbn");
  });

  it("popular chips use the tag radius, not a pill", () => {
    const { container } = render(<NotFound />);
    const chips = [...container.querySelectorAll('a[href^="/tools/"]')];
    expect(chips.length).toBeGreaterThanOrEqual(6);
    for (const chip of chips) {
      expect(chip.className).toMatch(/(?:^|\s)rounded-tag(?:\s|$)/);
      expect(chip.className).not.toMatch(/rounded-full/);
    }
  });

  it("a matcher that fails to load costs only the suggestion — and is handled", async () => {
    // Ultrareview, 2026-10-09: the import had no handler, so a chunk that
    // failed to load (a tab holding a pre-deploy build) rejected unhandled on
    // every 404. The failure arrives through the component's own loader seam
    // rather than vi.mock (a mocked module would stay cached for other files);
    // vitest fails the run on an unhandled rejection, so this is red without
    // the handler. Nothing is claimed either way: no "did you mean", and no
    // "no close match" the page did not establish.
    pathname = "/merge";
    const { container } = render(
      <NotFoundAssist
        inputId="none"
        loadMatcher={() =>
          Promise.reject(new Error("simulated ChunkLoadError"))
        }
      />,
    );
    await settle();
    expect(row(container)!.textContent?.trim()).toBe("");
  });

  it("after a client navigation to another missing path, the old suggestion never shows", async () => {
    // Ultrareview, 2026-10-09: suggestions lived in state that only the
    // effect replaced, so the previous path's "Did you mean" painted until it
    // ran. Asserted BEFORE settling, on the very render the path changes.
    pathname = "/merge";
    const view = render(<NotFound />);
    await settle();
    expect(row(view.container)!.textContent).toMatch(/did you mean/i);
    pathname = "/zzqx-vvbn";
    view.rerender(<NotFound />);
    expect(row(view.container)!.textContent).not.toMatch(/did you mean/i);
  });
});

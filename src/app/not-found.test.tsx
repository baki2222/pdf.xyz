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
 * Negative control: a path that names no tool renders no "did you mean" at
 * all, rather than a guess.
 */
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAllToolSlugs, getToolBySlug, tools } from "@/lib/tools";
import { toolsForMissingPath } from "@/lib/tools/path-suggest";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { default: NotFound } = await import("./not-found");
const { MissingPathSuggestion } =
  await import("@/components/layout/missing-path-suggestion");

afterEach(() => {
  pathname = "/";
});

/**
 * The suggestion loads its matcher on mount (a static import put the whole
 * catalogue in every route's first load; see missing-path-suggestion.tsx), so
 * it renders AFTER the import settles. Every test waits the same way, so the
 * positive tests prove this wait is long enough for the negative control.
 */
async function renderAndSettle() {
  render(<NotFound />);
  await act(async () => {
    await import("@/lib/tools/path-suggest");
  });
}

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

  it("negative control: a path that names no tool suggests nothing", () => {
    expect(toolsForMissingPath("/zzqx-vvbn")).toEqual([]);
    expect(toolsForMissingPath("/pdf")).toEqual([]);
    expect(toolsForMissingPath("/")).toEqual([]);
  });
});

describe("the 404 page", () => {
  it("offers the tool the missing path names", async () => {
    pathname = "/merge-pdf";
    await renderAndSettle();
    const merge = getToolBySlug("merge-pdf")!;
    // Scoped to the suggestion: the popular-tools row may list Merge PDF too.
    const box = screen.getByText(/did you mean/i).parentElement!;
    const link = within(box).getByRole("link", { name: merge.name });
    expect(link).toHaveAttribute("href", `/tools/${merge.slug}`);
  });

  it("offers PDF to Word for /tools/pdf-to-docx", async () => {
    pathname = "/tools/pdf-to-docx";
    await renderAndSettle();
    const [expected] = toolsForMissingPath(pathname);
    expect(expected).toBeDefined();
    const box = screen.getByText(/did you mean/i).parentElement!;
    expect(
      within(box).getByRole("link", { name: expected!.name }),
    ).toHaveAttribute("href", `/tools/${expected!.slug}`);
  });

  it("negative control: an unrelated path shows no suggestion, only the page", async () => {
    pathname = "/zzqx-vvbn";
    await renderAndSettle();
    expect(screen.queryByText(/did you mean/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("a matcher that fails to load costs only the suggestion — and is handled", async () => {
    // Ultrareview, 2026-10-09: the import had no handler, so a chunk that
    // failed to load (a tab holding a pre-deploy build) rejected unhandled on
    // every 404. The failure arrives through the component's own loader seam
    // rather than vi.mock (a mocked module would stay cached for other files);
    // vitest fails the run on an unhandled rejection, so this is red without
    // the handler.
    pathname = "/merge-pdf";
    render(
      <MissingPathSuggestion
        loadMatcher={() =>
          Promise.reject(new Error("simulated ChunkLoadError"))
        }
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByText(/did you mean/i)).not.toBeInTheDocument();
  });

  it("after a client navigation to another missing path, the old suggestion never shows", async () => {
    // Ultrareview, 2026-10-09: suggestions lived in state that only the
    // effect replaced, so the previous path's "Did you mean" painted until it
    // ran. Asserted BEFORE settling, on the very render the path changes.
    pathname = "/merge-pdf";
    const view = render(<NotFound />);
    await act(async () => {
      await import("@/lib/tools/path-suggest");
    });
    expect(screen.getByText(/did you mean/i)).toBeInTheDocument();
    pathname = "/zzqx-vvbn";
    view.rerender(<NotFound />);
    expect(screen.queryByText(/did you mean/i)).not.toBeInTheDocument();
  });
});

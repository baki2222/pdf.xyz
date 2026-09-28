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
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAllToolSlugs, getToolBySlug, tools } from "@/lib/tools";
import { toolsForMissingPath } from "@/lib/tools/path-suggest";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { default: NotFound } = await import("./not-found");

afterEach(() => {
  pathname = "/";
});

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
  it("offers the tool the missing path names", () => {
    pathname = "/merge-pdf";
    render(<NotFound />);
    const merge = getToolBySlug("merge-pdf")!;
    // Scoped to the suggestion: the popular-tools row may list Merge PDF too.
    const box = screen.getByText(/did you mean/i).parentElement!;
    const link = within(box).getByRole("link", { name: merge.name });
    expect(link).toHaveAttribute("href", `/tools/${merge.slug}`);
  });

  it("offers PDF to Word for /tools/pdf-to-docx", () => {
    pathname = "/tools/pdf-to-docx";
    render(<NotFound />);
    const [expected] = toolsForMissingPath(pathname);
    expect(expected).toBeDefined();
    const box = screen.getByText(/did you mean/i).parentElement!;
    expect(
      within(box).getByRole("link", { name: expected!.name }),
    ).toHaveAttribute("href", `/tools/${expected!.slug}`);
  });

  it("negative control: an unrelated path shows no suggestion, only the page", () => {
    pathname = "/zzqx-vvbn";
    render(<NotFound />);
    expect(screen.queryByText(/did you mean/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
/**
 * "Find a guide" on the guides index (D.9).
 *
 * The spec's button opens the command palette scoped to guides; the palette
 * is WP-09's and was not on main when this shipped, so the button opens an
 * in-page finder over the same ranked search (`@/lib/intent/search`, guide
 * documents). The index stays a complete server-rendered list: the finder
 * only hides cards, so a reader without JavaScript, and a crawler, still get
 * every guide.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import GuidesPage from "./page";
import { guides } from "@/lib/guides";

async function settle() {
  await act(async () => {
    await import("@/lib/intent/search");
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const cards = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>("[data-guide-card]"),
];

describe("the guides index", () => {
  it("server-renders every guide, all visible", () => {
    const { container } = render(<GuidesPage />);
    const list = cards(container);
    expect(list.map((c) => c.dataset.guideCard)).toEqual(
      guides.map((g) => g.slug),
    );
    expect(list.filter((c) => c.hidden)).toEqual([]);
  });

  it("Find a guide narrows the list to the guides the query names", async () => {
    const { container } = render(<GuidesPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Find a guide" }),
    );
    const input = await screen.findByRole("searchbox", {
      name: /find a guide/i,
    });
    fireEvent.change(input, { target: { value: "merge" } });
    await settle();
    const shown = cards(container).filter((c) => !c.hidden);
    expect(shown.map((c) => c.dataset.guideCard)).toContain(
      "how-to-merge-pdf-files",
    );
    // It narrowed: a query naming one task is not the whole catalogue.
    expect(shown.length).toBeLessThan(guides.length);
    expect(shown.length).toBeGreaterThan(0);
  });

  it("an empty query shows every guide again, and a miss says so", async () => {
    const { container } = render(<GuidesPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Find a guide" }),
    );
    const input = await screen.findByRole("searchbox", {
      name: /find a guide/i,
    });
    fireEvent.change(input, { target: { value: "zzqxvv" } });
    await settle();
    expect(cards(container).filter((c) => !c.hidden)).toEqual([]);
    expect(screen.getByText(/no guide matches/i)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "" } });
    await settle();
    expect(cards(container).filter((c) => c.hidden)).toEqual([]);
  });
});

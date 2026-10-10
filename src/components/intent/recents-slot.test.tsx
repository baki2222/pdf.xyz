// @vitest-environment jsdom
/**
 * The desk's "Recent: Merge PDF · Compress PDF" row, rendered from what this
 * browser stored.
 *
 * WHY THIS FILE. The write (`tool-outcome.test.tsx`) and the store
 * (`recents.test.ts`) were tested; the row a visitor SEES was not. It names
 * tools through the ticket chunk's re-export of the catalogue lookup
 * (`export { getToolBySlug } from "@/lib/tools"` in `ticket-view.tsx`) and
 * swallows a failed fetch, so losing that re-export would have left the row
 * empty for good with no error and no red test — while `/privacy` tells
 * visitors the key exists "so the home page can offer them again"
 * (`browser-storage.ts`). The row is rendered here through the real lazy
 * module, over the real storage key.
 */
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { clearRecents, RECENTS_STORAGE_KEY } from "@/lib/intent/recents";
import { getToolBySlug } from "@/lib/tools";
import { RecentsSlot } from "./recents-slot";
import { loadTicketView } from "./use-ticket";

function seed(slugs: readonly string[]) {
  window.localStorage.setItem(
    RECENTS_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      items: slugs.map((slug, i) => ({ slug, at: 1_700_000_000_000 - i })),
    }),
  );
}

afterEach(() => {
  // `isolate: false`: storage outlives the file, and the next file's ranking
  // reads recents.
  clearRecents();
});

describe("the desk's Recent row", () => {
  it("names each stored tool from the catalogue, links its page, and skips a slug the catalogue no longer has", async () => {
    // Health: the slug this test leans on is in the catalogue at all.
    const merge = getToolBySlug("merge-pdf");
    expect(merge?.name).toBeTruthy();
    expect(getToolBySlug("no-such-tool")).toBeUndefined();

    seed(["merge-pdf", "no-such-tool"]);
    render(<RecentsSlot />);
    const nav = await screen.findByRole(
      "navigation",
      { name: "Recent tools" },
      { timeout: 5000 },
    );
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      [merge!.name, "/tools/merge-pdf"],
    ]);
    expect(nav.textContent).not.toContain("no-such-tool");
  });

  it("control: with nothing stored there is no row, only the reserved slot", async () => {
    const { container } = render(<RecentsSlot />);
    const slot = container.querySelector('[data-slot="recents"]');
    expect(slot).not.toBeNull();
    // Wait as long as a row would: the module that names the tools has
    // loaded, and React has had a turn to render what it would have named.
    await loadTicketView();
    await act(async () => {});
    expect(slot!.childElementCount).toBe(0);
    expect(screen.queryByRole("navigation", { name: "Recent tools" })).toBe(
      null,
    );
  });
});

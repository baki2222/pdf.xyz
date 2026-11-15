// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ViewerPdf } from "@/lib/pdf/viewer";
import { VIEWER_TEXT_CAPPED_NOTE } from "@/lib/pdf/viewer-copy";
import type { SearchMatch } from "@/lib/pdf/viewer-search";
import { ViewerPage } from "./viewer-page";

/**
 * ViewerPage's additions for Compare PDF's page view (S2, 2026-11-15),
 * additive only: a range's `kind` becomes the mark's `data-mark-kind`, a
 * range without one draws exactly the mark the search always drew, and the
 * capped-text note can be replaced by the caller's sentence. PDF Viewer's
 * own behaviour is held, unchanged, by pdf-viewer.test.tsx.
 */

const ITEMS = ["Total due: ", "100", " now"];

function fakeDoc(capped = false): ViewerPdf {
  return {
    numPages: 1,
    imageTooLarge: false,
    pageSize: async () => ({ width: 612, height: 792 }),
    render: async () => ({
      kind: "drawn",
      canvas: document.createElement("canvas"),
    }),
    renderForPrint: async () => null,
    text: async () => ({ items: ITEMS.map((str) => ({ str })), capped }),
    textLayer: async (_i, container) => {
      const divs = ITEMS.map((str) => {
        const span = document.createElement("span");
        span.textContent = str;
        container.append(span);
        return span;
      });
      return { divs, capped, cancel: () => {} };
    },
    links: async () => [],
    outline: async () => ({ entries: [], truncated: false }),
    destroy: async () => {},
  };
}

function mount(
  hits: SearchMatch[],
  extra: { capped?: boolean; textCappedNote?: string } = {},
) {
  return render(
    <ViewerPage
      doc={fakeDoc(extra.capped)}
      index={0}
      top={0}
      left={0}
      width={612}
      height={792}
      scale={1}
      turn={0}
      live
      pixelRatio={1}
      hits={hits}
      activeHit={-1}
      revealToken={0}
      onPage={() => {}}
      textCappedNote={extra.textCappedNote}
    />,
  );
}

describe("ViewerPage: kinds on marks, and the caller's capped note", () => {
  it("a range with a kind draws a mark carrying it", async () => {
    const { container } = mount([
      [
        { item: 0, start: 0, end: 10, kind: "line" },
        { item: 1, start: 0, end: 3, kind: "removed" },
      ],
    ]);
    await waitFor(() =>
      expect(container.querySelectorAll("mark").length).toBe(2),
    );
    const marks = [...container.querySelectorAll("mark")];
    expect(marks.map((m) => m.getAttribute("data-mark-kind"))).toEqual([
      "line",
      "removed",
    ]);
    expect(marks.map((m) => m.textContent)).toEqual(["Total due:", "100"]);
  });

  it("a range without a kind draws the search's mark, with no kind attribute", async () => {
    const { container } = mount([[{ item: 1, start: 0, end: 3 }]]);
    await waitFor(() =>
      expect(container.querySelectorAll("mark").length).toBe(1),
    );
    const mark = container.querySelector("mark")!;
    expect(mark.hasAttribute("data-mark-kind")).toBe(false);
    expect(mark.getAttribute("data-viewer-hit")).toBe("");
  });

  it("the capped note is the viewer's own unless the caller gives one", async () => {
    const own = mount([], { capped: true });
    await waitFor(() =>
      expect(
        own.container.querySelector("[data-viewer-text-capped]")?.textContent,
      ).toBe(VIEWER_TEXT_CAPPED_NOTE),
    );
    own.unmount();
    const theirs = mount([], {
      capped: true,
      textCappedNote: "A caller's sentence.",
    });
    await waitFor(() =>
      expect(
        theirs.container.querySelector("[data-viewer-text-capped]")
          ?.textContent,
      ).toBe("A caller's sentence."),
    );
  });
});

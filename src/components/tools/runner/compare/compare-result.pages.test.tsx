// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ComparablePdfText } from "@/lib/pdf/compare-pdf";
import type { ViewerPdf } from "@/lib/pdf/viewer";
import { compareDocsOpen } from "./compare-docs";
import {
  CompareChanges,
  compareExtractedPdfText,
  compareViewerChunk,
  type ComparePages,
} from "./compare-result";

/**
 * The view switch in Compare PDF's changes view (S2, 2026-11-15): Show
 * changes on the pages fetches the page view's chunk and opens both
 * documents side by side, never one after another; the list is not drawn
 * while the pages are; Previous and Next move the pages without focusing a
 * hidden heading; Show the list hands focus back to the list; and every way
 * out lets both documents go. Through the module's own seams
 * (`compareViewerChunk`, `compareDocsOpen`), never `vi.mock`.
 */

afterEach(cleanup);

function doc(name: string, pages: string[][]): ComparablePdfText {
  const texts = pages.map((p) => p.join("\n"));
  const text = texts.join("\n\n");
  return {
    name,
    size: text.length,
    extracted: {
      pageCount: pages.length,
      pages: texts.map((t, i) => ({
        pageNumber: i + 1,
        text: t,
        characterCount: t.length,
      })),
      text,
      characterCount: text.length,
      hasText: true,
    },
  };
}

const body = (tag: string) =>
  Array.from({ length: 10 }, (_, i) => `${tag} line ${i + 1}`);

function setup() {
  const leftPages = [body("alpha"), body("bravo"), body("charlie")];
  const rightPages = leftPages.map((page, p) =>
    page.map((line, i) => (i === 5 ? `${line} amended ${p + 1}` : line)),
  );
  const a = doc("a.pdf", leftPages);
  const b = doc("b.pdf", rightPages);
  const result = compareExtractedPdfText(a, b);
  const pages: ComparePages = {
    left: new Uint8Array([1]),
    right: new Uint8Array([2]),
    leftPages: a.extracted.pages,
    rightPages: b.extracted.pages,
  };
  return { result, pages };
}

interface Held<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}
function held<T>(): Held<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const realLoad = compareViewerChunk.load;
const realOpen = compareDocsOpen.open;
let events: string[] = [];
let chunk: Held<unknown>;
let opens: Held<ViewerPdf>[] = [];
/** This test's documents destroyed (an earlier test's may still be let go). */
let tally = { destroyed: 0 };

function install() {
  events = [];
  opens = [];
  tally = { destroyed: 0 };
  chunk = held();
  compareViewerChunk.load = (() => {
    events.push("chunk");
    return chunk.promise;
  }) as typeof compareViewerChunk.load;
  compareDocsOpen.open = () => {
    events.push("open");
    const h = held<ViewerPdf>();
    opens.push(h);
    return h.promise;
  };
}

function fakeDoc(): ViewerPdf {
  const mine = tally;
  return {
    numPages: 3,
    destroy: async () => {
      mine.destroyed += 1;
    },
  } as unknown as ViewerPdf;
}

const FAKE_MODULE = {
  CompareViewer: () => <div data-fake-viewer="">pages</div>,
};

afterEach(() => {
  compareViewerChunk.load = realLoad;
  compareDocsOpen.open = realOpen;
});

const tick = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });

function mount() {
  install();
  const { result, pages } = setup();
  const view = render(
    <CompareChanges
      result={result}
      options={{}}
      onOptions={() => {}}
      pages={pages}
    />,
  );
  return { view, result };
}

async function openPages() {
  fireEvent.click(
    screen.getByRole("button", { name: "Show changes on the pages" }),
  );
  await tick();
  chunk.resolve(FAKE_MODULE);
  for (const o of opens) o.resolve(fakeDoc());
  await tick();
}

describe("the view switch", () => {
  it("offers both views as pressed buttons when the files are at hand, and only the list otherwise", () => {
    mount();
    const pagesButton = screen.getByRole("button", {
      name: "Show changes on the pages",
    });
    const listButton = screen.getByRole("button", { name: "Show the list" });
    expect(pagesButton.getAttribute("aria-pressed")).toBe("false");
    expect(listButton.getAttribute("aria-pressed")).toBe("true");
    cleanup();
    const { result } = setup();
    render(
      <CompareChanges result={result} options={{}} onOptions={() => {}} />,
    );
    expect(
      screen.queryByRole("button", { name: "Show changes on the pages" }),
    ).toBeNull();
  });

  it("the press starts the chunk and both opens together, before any of them lands (G14)", async () => {
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Show changes on the pages" }),
    );
    await tick();
    // Nothing has resolved, and all three are already asked for.
    expect(events.filter((e) => e === "chunk").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(events.filter((e) => e === "open").length).toBe(2);
    expect(screen.getByText("Opening both files…")).toBeTruthy();
    // The list is not drawn while the pages are.
    expect(screen.queryByRole("group", { name: "List of changes" })).toBeNull();
  });

  it("a pointer reaching the button fetches the chunk and opens nothing", () => {
    mount();
    fireEvent.pointerEnter(
      screen.getByRole("button", { name: "Show changes on the pages" }),
    );
    expect(events).toEqual(["chunk"]);
  });

  it("in the page view, Next moves the change without focusing a hidden heading", async () => {
    mount();
    await openPages();
    expect(document.querySelector("[data-fake-viewer]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    await tick();
    expect(document.activeElement?.tagName).not.toBe("H3");
    expect(screen.getAllByRole("status")[0]!.textContent).toMatch(
      /^Change 2 of 3/,
    );
  });

  it("Show the list brings the list back, focused, and lets both documents go", async () => {
    mount();
    await openPages();
    expect(tally.destroyed).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Show the list" }));
    await tick();
    const list = screen.getByRole("group", { name: "List of changes" });
    expect(document.activeElement).toBe(list);
    expect(tally.destroyed).toBe(2);
  });

  it("leaving the result (Start over, a change of files, a new run) lets both documents go", async () => {
    const { view } = mount();
    await openPages();
    view.unmount();
    await tick();
    expect(tally.destroyed).toBe(2);
  });
});

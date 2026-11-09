// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getToolBySlug } from "@/lib/tools";
import type { ViewerPdf } from "@/lib/pdf/viewer";
import { VIEWER_IMAGE_NOTE, VIEWER_LABELS } from "@/lib/pdf/viewer-copy";
import { InToolPage } from "@/tests/in-tool-page";
import type { LoadedPdf } from "../use-single-pdf";
import { PdfViewer } from "./pdf-viewer";

/**
 * The viewer's shell in the DOM, through an injected `ViewerPdf` (the
 * component's `open` seam, not `vi.mock`): keys, the page field, roles and
 * labels, search highlights, the failure tile, the notes and Download.
 * pdf.js itself is proved in src/lib/pdf/viewer.pdfjs.test.ts and in the
 * browser by e2e/client-proof/cases.ts.
 */

const PAGES = [
  ["Page one text"],
  ["Nothing here", "either"],
  ["The third page holds the ", "zeb", "ra word"],
  ["Page four"],
  ["Last page"],
];

function fakeDoc(over: Partial<ViewerPdf> = {}): ViewerPdf {
  return {
    numPages: PAGES.length,
    imageTooLarge: false,
    pageSize: async () => ({ width: 612, height: 792 }),
    render: async (index) =>
      index === 1
        ? { kind: "failed" }
        : { kind: "drawn", canvas: document.createElement("canvas") },
    renderForPrint: async () => null,
    text: async (index) => ({
      items: (PAGES[index] ?? []).map((str) => ({ str })),
      capped: false,
    }),
    textLayer: async (index, container) => {
      const divs = (PAGES[index] ?? []).map((str) => {
        const span = document.createElement("span");
        span.textContent = str;
        container.append(span);
        return span;
      });
      return { divs, cancel: () => {} };
    },
    links: async () => [],
    outline: async () => ({ entries: [], truncated: false }),
    destroy: async () => {},
    ...over,
  };
}

const BYTES = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 1, 2, 3]);
const loaded = (): LoadedPdf => ({
  file: new File([BYTES], "proof.pdf", { type: "application/pdf" }),
  bytes: BYTES,
  pageCount: PAGES.length,
  rotations: PAGES.map(() => 0),
  digitalSignatures: 0,
});

async function mount(doc = fakeDoc()) {
  const tool = getToolBySlug("pdf-viewer")!;
  render(
    <InToolPage tool={tool}>
      <PdfViewer
        pdf={loaded()}
        onReset={() => {}}
        opening={Promise.resolve(doc)}
      />
    </InToolPage>,
  );
  const region = await screen.findByRole("region", {
    name: "PDF viewer: proof.pdf",
  });
  // The column is laid out once page sizes are read.
  await waitFor(() =>
    expect(region.querySelector("[data-viewer-page]")).not.toBeNull(),
  );
  return region;
}

const pageField = () =>
  screen.getByRole("textbox", { name: VIEWER_LABELS.pageNumber });

afterEach(() => vi.restoreAllMocks());

describe("PDF Viewer shell: roles and labels", () => {
  it("is a labelled region with a toolbar of named controls and a page field", async () => {
    await mount();
    const toolbar = screen.getByRole("toolbar", { name: "Viewer controls" });
    for (const name of [
      VIEWER_LABELS.thumbnails,
      VIEWER_LABELS.bookmarks,
      VIEWER_LABELS.previous,
      VIEWER_LABELS.next,
      VIEWER_LABELS.zoomOut,
      VIEWER_LABELS.zoomIn,
      VIEWER_LABELS.rotate,
      VIEWER_LABELS.search,
      VIEWER_LABELS.print,
      VIEWER_LABELS.download,
    ]) {
      expect(
        toolbar.querySelector(`button[aria-label="${name}"]`),
        name,
      ).not.toBeNull();
    }
    expect(
      screen.getByRole("combobox", { name: VIEWER_LABELS.zoom }),
    ).toBeTruthy();
    // The search's checkbox is named by the label the page's copy quotes.
    fireEvent.click(screen.getByRole("button", { name: VIEWER_LABELS.search }));
    expect(
      screen.getByRole("checkbox", { name: VIEWER_LABELS.matchCase }),
    ).toBeTruthy();
    expect(pageField()).toHaveProperty("value", "1");
    expect(screen.getByText(`of ${PAGES.length}`)).toBeTruthy();
    // Pages are groups named by number.
    expect(screen.getByRole("group", { name: "Page 1" })).toBeTruthy();
    // The previous button is unavailable on page 1.
    // aria-disabled, never `disabled`: the button keeps its focus.
    expect(
      screen
        .getByRole("button", { name: VIEWER_LABELS.previous })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });
});

describe("PDF Viewer: page navigation", () => {
  it("the page field jumps to a typed page, and clamps a page past the end", async () => {
    await mount();
    const field = pageField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "3" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(pageField()).toHaveProperty("value", "3"));
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "99" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(pageField()).toHaveProperty("value", "5"));
    // Letters are not a page number.
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "x2" } });
    expect(pageField()).toHaveProperty("value", "2");
  });

  it("Next and Previous step a page and say where they went", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: VIEWER_LABELS.next }));
    await waitFor(() => expect(pageField()).toHaveProperty("value", "2"));
    expect(screen.getByText(`Page 2 of ${PAGES.length}`)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: VIEWER_LABELS.previous }),
    );
    await waitFor(() => expect(pageField()).toHaveProperty("value", "1"));
  });

  it("keys inside the viewer: Page Down, End, Home, Page Up", async () => {
    const region = await mount();
    const scroller = region.querySelector<HTMLElement>(
      "[data-viewer-scroller]",
    )!;
    scroller.focus();
    fireEvent.keyDown(scroller, { key: "PageDown" });
    await waitFor(() => expect(pageField()).toHaveProperty("value", "2"));
    fireEvent.keyDown(scroller, { key: "End" });
    await waitFor(() => expect(pageField()).toHaveProperty("value", "5"));
    fireEvent.keyDown(scroller, { key: "PageUp" });
    await waitFor(() => expect(pageField()).toHaveProperty("value", "4"));
    fireEvent.keyDown(scroller, { key: "Home" });
    await waitFor(() => expect(pageField()).toHaveProperty("value", "1"));
  });

  it("never takes Ctrl+P, and keys typed in a field are the field's", async () => {
    const region = await mount();
    const scroller = region.querySelector<HTMLElement>(
      "[data-viewer-scroller]",
    )!;
    // fireEvent returns false when the default was prevented.
    expect(fireEvent.keyDown(scroller, { key: "p", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(scroller, { key: "p", metaKey: true })).toBe(true);
    // Positive control: a key the viewer does take is prevented.
    expect(fireEvent.keyDown(scroller, { key: "PageDown" })).toBe(false);
    const field = pageField();
    expect(fireEvent.keyDown(field, { key: "Home" })).toBe(true);
  });
});

describe("PDF Viewer: search", () => {
  it("finds a word split across items, highlights its characters and reports the count", async () => {
    const region = await mount();
    fireEvent.click(screen.getByRole("button", { name: VIEWER_LABELS.search }));
    const search = screen.getByRole("search");
    const field = screen.getByRole("searchbox", {
      name: VIEWER_LABELS.searchField,
    });
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.change(field, { target: { value: "zebra" } });
    fireEvent.keyDown(field, { key: "Enter" });
    const status = search.querySelector("[data-viewer-search-status]")!;
    await waitFor(() =>
      expect(status.textContent).toContain("1 match on 1 page."),
    );
    // The viewer moved to page 3, and the match is marked across the split.
    await waitFor(() => expect(pageField()).toHaveProperty("value", "3"));
    await waitFor(() => {
      const marks = [
        ...region.querySelectorAll(
          '[data-viewer-page="3"] mark[data-viewer-hit]',
        ),
      ];
      expect(marks.map((m) => m.textContent)).toEqual(["zeb", "ra"]);
      expect(
        marks.every((m) => m.getAttribute("data-viewer-hit") === "active"),
      ).toBe(true);
    });
    // The span keeps its text around the mark, by character.
    const span = region.querySelector(
      '[data-viewer-page="3"] mark',
    )!.parentElement!;
    expect(span.textContent).toBe("zeb");
  });

  it("Escape closes search and returns focus to the Search button", async () => {
    await mount();
    const button = screen.getByRole("button", { name: VIEWER_LABELS.search });
    fireEvent.click(button);
    const field = await screen.findByRole("searchbox");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("search")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("Ctrl+F inside the viewer opens search", async () => {
    const region = await mount();
    const scroller = region.querySelector<HTMLElement>(
      "[data-viewer-scroller]",
    )!;
    expect(fireEvent.keyDown(scroller, { key: "f", ctrlKey: true })).toBe(
      false,
    );
    expect(await screen.findByRole("search")).toBeTruthy();
  });

  it("counts pages with no text and points to OCR PDF", async () => {
    await mount(
      fakeDoc({
        text: async (i) => ({
          items: i === 0 ? [{ str: "only text" }] : [{ str: " " }],
          capped: false,
        }),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: VIEWER_LABELS.search }));
    const field = await screen.findByRole("searchbox");
    fireEvent.change(field, { target: { value: "text" } });
    fireEvent.keyDown(field, { key: "Enter" });
    const search = screen.getByRole("search");
    await waitFor(() =>
      expect(search.textContent).toContain(
        "4 pages have no selectable text, so they were not searched.",
      ),
    );
    expect(search.querySelector('a[href="/tools/ocr-pdf"]')?.textContent).toBe(
      "OCR PDF",
    );
  });
});

describe("PDF Viewer: what it says", () => {
  it("a page that cannot be drawn says so on its sheet", async () => {
    const region = await mount();
    // Page 2 is in the first window (page 1 and one past it).
    await waitFor(() =>
      expect(
        region.querySelector('[data-viewer-page="2"] [data-viewer-page-failed]')
          ?.textContent,
      ).toContain("This page could not be drawn. (page 2)"),
    );
    // Positive control: page 1 drew.
    expect(
      region
        .querySelector('[data-viewer-page="1"]')!
        .getAttribute("data-viewer-page-status"),
    ).toBe("drawn");
  });

  it("no image note for a file within budget (control)", async () => {
    const region = await mount();
    expect(region.querySelector("[data-viewer-image-note]")).toBeNull();
  });

  it("an over-budget image is said once, naming no page", async () => {
    const region = await mount(fakeDoc({ imageTooLarge: true }));
    const notes = region.querySelectorAll("[data-viewer-image-note]");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.getAttribute("role")).toBe("note");
    expect(notes[0]!.textContent).toContain(VIEWER_IMAGE_NOTE);
    expect(VIEWER_IMAGE_NOTE).not.toMatch(/page \d/i);
  });

  it("Rotate view says the file is not changed and links Rotate PDF", async () => {
    const region = await mount();
    expect(region.querySelector("[data-viewer-rotate-note]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: VIEWER_LABELS.rotate }));
    const note = region.querySelector("[data-viewer-rotate-note]")!;
    expect(note.textContent).toContain("the file is not changed");
    expect(note.querySelector('a[href="/tools/rotate-pdf"]')).not.toBeNull();
  });

  it("Download saves the bytes it was given, unchanged", async () => {
    await mount();
    let saved: Blob | null = null;
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      saved = b as Blob;
      return "blob:proof";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: VIEWER_LABELS.download }),
      );
    });
    expect(saved).not.toBeNull();
    const out = new Uint8Array(await saved!.arrayBuffer());
    expect([...out]).toEqual([...BYTES]);
    expect(saved!.type).toBe("application/pdf");
  });

  it("an open that is refused shows the refusal, not an empty viewer", async () => {
    const tool = getToolBySlug("pdf-viewer")!;
    const refused = Promise.reject(new Error("This file could not be opened."));
    refused.catch(() => {});
    render(
      <InToolPage tool={tool}>
        <PdfViewer pdf={loaded()} onReset={() => {}} opening={refused} />
      </InToolPage>,
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "This file could not be opened.",
    );
    expect(screen.queryByRole("region", { name: /PDF viewer/ })).toBeNull();
  });
});

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
import {
  VIEWER_IMAGE_NOTE,
  VIEWER_LABELS,
  VIEWER_PRINT_WAITING,
  VIEWER_TEXT_CAPPED_NOTE,
} from "@/lib/pdf/viewer-copy";
import { VIEWER_MAX_TEXT_ITEMS } from "@/lib/pdf/viewer-geometry";
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
      return { divs, capped: false, cancel: () => {} };
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

  it("the arrow keys are the browser's: they pan a zoomed page, never step one", async () => {
    // History (review, 2026-11-10): ArrowLeft/ArrowRight stepped pages and
    // prevented the default, so at 400% the right of every page could not
    // be reached by keyboard (WCAG 2.1.1).
    const region = await mount();
    const scroller = region.querySelector<HTMLElement>(
      "[data-viewer-scroller]",
    )!;
    scroller.focus();
    for (const key of ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"]) {
      expect(fireEvent.keyDown(scroller, { key }), key).toBe(true);
    }
    expect(pageField()).toHaveProperty("value", "1");
    // Positive control: Page Down still steps, prevented.
    expect(fireEvent.keyDown(scroller, { key: "PageDown" })).toBe(false);
    await waitFor(() => expect(pageField()).toHaveProperty("value", "2"));
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

  it("a search's progress is shown, not announced; its result is announced once", async () => {
    // History (review, 2026-11-10): the status was a polite live region
    // republished every 120 ms with "Searching… page N of M".
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const base = fakeDoc();
    await mount(
      fakeDoc({
        text: async (index) => {
          if (index === 3) await held;
          return base.text(index);
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: VIEWER_LABELS.search }));
    const search = screen.getByRole("search");
    const field = screen.getByRole("searchbox", {
      name: VIEWER_LABELS.searchField,
    });
    fireEvent.change(field, { target: { value: "zebra" } });
    fireEvent.keyDown(field, { key: "Enter" });
    const status = search.querySelector("[data-viewer-search-status]")!;
    const announce = search.querySelector("[data-viewer-search-announce]")!;
    // The shown status is not a live region; the announcement is.
    expect(status.getAttribute("aria-live")).toBeNull();
    expect(status.getAttribute("role")).toBeNull();
    expect(announce.getAttribute("role")).toBe("status");
    expect(announce.getAttribute("aria-live")).toBe("polite");
    // Mid-search: progress shown, nothing announced.
    await waitFor(() => expect(status.textContent).toContain("Searching…"));
    expect(announce.textContent).toBe("");
    await act(async () => release());
    // Done: the result, said once.
    await waitFor(() =>
      expect(announce.textContent).toContain("1 match on 1 page."),
    );
    expect(announce.textContent).not.toContain("Searching");
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

describe("PDF Viewer: the side panel on a phone is a sheet", () => {
  const OUTLINE = {
    entries: [
      { title: "Second page", depth: 0, page: 1, href: null },
      { title: "Third page", depth: 0, page: 2, href: null },
    ],
    truncated: false,
  };
  const phoneScreen = (matches: boolean) =>
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
  afterEach(() => vi.unstubAllGlobals());

  it("focus moves into it, Escape closes it and returns focus, and the pages it covers are inert", async () => {
    // History (review, 2026-11-10): focus stayed on the toolbar, Escape
    // left the sheet open, and Tab reached the column hidden under it.
    phoneScreen(true);
    const region = await mount(fakeDoc({ outline: async () => OUTLINE }));
    const scroller = region.querySelector<HTMLElement>(
      "[data-viewer-scroller]",
    )!;
    const toggle = screen.getByRole("button", {
      name: VIEWER_LABELS.bookmarks,
    });
    fireEvent.click(toggle);
    const sheet = region.querySelector<HTMLElement>(
      '[data-viewer-sidebar="bookmarks"]',
    )!;
    await waitFor(() =>
      expect(sheet.contains(document.activeElement)).toBe(true),
    );
    expect(scroller.hasAttribute("inert")).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() =>
      expect(region.querySelector("[data-viewer-sidebar]")).toBeNull(),
    );
    expect(document.activeElement).toBe(toggle);
    expect(scroller.hasAttribute("inert")).toBe(false);
  });

  it("control: beside the pages (wider screens), focus stays put and nothing is inert", async () => {
    phoneScreen(false);
    const region = await mount(fakeDoc({ outline: async () => OUTLINE }));
    const toggle = screen.getByRole("button", {
      name: VIEWER_LABELS.bookmarks,
    });
    toggle.focus();
    fireEvent.click(toggle);
    await screen.findByRole("button", { name: "Third page" });
    expect(document.activeElement).toBe(toggle);
    expect(
      region.querySelector("[data-viewer-scroller]")!.hasAttribute("inert"),
    ).toBe(false);
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

  it("a page whose text passed the cap says so on the page, where text is selected", async () => {
    // History (review, 2026-11-10): the FAQ said the viewer reports the
    // cap, but only a search's tally did; selecting text on a capped page
    // said nothing.
    const base = fakeDoc();
    const region = await mount(
      fakeDoc({
        textLayer: async (index, container, scale, turn, signal) => {
          const handle = await base.textLayer(
            index,
            container,
            scale,
            turn,
            signal,
          );
          return handle && { ...handle, capped: index === 0 };
        },
      }),
    );
    await waitFor(() =>
      expect(
        region.querySelector('[data-viewer-page="1"] [data-viewer-text-capped]')
          ?.textContent,
      ).toBe(VIEWER_TEXT_CAPPED_NOTE),
    );
    expect(VIEWER_TEXT_CAPPED_NOTE).toContain(
      VIEWER_MAX_TEXT_ITEMS.toLocaleString("en-US"),
    );
    // Control: page 3 drew its text, uncapped, and says nothing.
    await waitFor(() =>
      expect(
        region.querySelector('[data-viewer-page="2"] .textLayer span'),
      ).not.toBeNull(),
    );
    expect(
      region.querySelector('[data-viewer-page="2"] [data-viewer-text-capped]'),
    ).toBeNull();
  });

  it("Print waits for the page sizes it plans from, and says why", async () => {
    // History (review, 2026-11-10): Print was usable at once, planned from
    // page 1's size repeated for every page — an unread landscape page was
    // drawn into a portrait canvas.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const doc = fakeDoc({
      pageSize: async (index) => {
        if (index === 1) await held;
        return index === 1
          ? { width: 1_440, height: 100 }
          : { width: 612, height: 792 };
      },
    });
    await mount(doc);
    const printButton = screen.getByRole("button", {
      name: VIEWER_LABELS.print,
    });
    expect(printButton.getAttribute("aria-disabled")).toBe("true");
    expect(printButton.getAttribute("title")).toBe(VIEWER_PRINT_WAITING);
    await act(async () => release());
    // Positive control: once read, Print is offered.
    await waitFor(() =>
      expect(printButton.getAttribute("aria-disabled")).toBe("false"),
    );
    expect(printButton.getAttribute("title")).toBe(VIEWER_LABELS.print);
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

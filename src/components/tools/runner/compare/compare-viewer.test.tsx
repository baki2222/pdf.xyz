// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComparablePdfText } from "@/lib/pdf/compare-pdf";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { ViewerPdf } from "@/lib/pdf/viewer";
import { VIEWER_LIVE_PAGES } from "@/lib/pdf/viewer-geometry";
import { compareExtractedPdfText } from "./compare-result";
import {
  COMPARE_CAPPED_NOTE,
  COMPARE_LAYER_CSS,
  COMPARE_LIVE_PAGES_PER_SIDE,
  COMPARE_NO_TEXT_NOTE,
  COMPARE_VIEWER_CHUNK,
  CompareViewer,
  compareUnplacedNote,
} from "./compare-viewer";

/**
 * Compare PDF's page view in the DOM, through injected `ViewerPdf`s whose
 * text is the extraction's (the composed chain on real PDFs is
 * src/lib/pdf/compare/view-marks.test.ts; the browser, e2e/compare-viewer
 * .spec.ts). Held here: the chunk marker, moves reaching both files, the
 * reveal happening once and only on the move's page, every note, the phone
 * switch, the announcement, and the bounds the view promises.
 */

type Pages = string[][];

function extracted(pages: Pages): ExtractedPdfText {
  const texts = pages.map((p) => p.join("\n"));
  const text = texts.filter(Boolean).join("\n\n");
  return {
    pageCount: pages.length,
    pages: texts.map((t, i) => ({
      pageNumber: i + 1,
      text: t,
      characterCount: t.length,
    })),
    text,
    characterCount: text.length,
    hasText: text.trim().length > 0,
  };
}

interface DocOptions {
  /** Text the page's items hold, when it differs from the extraction's. */
  itemsOf?: Record<number, string[]>;
  capped?: number[];
}

function fakeDoc(pages: Pages, opts: DocOptions = {}): ViewerPdf {
  const items = (i: number) => {
    const lines = opts.itemsOf?.[i] ?? pages[i] ?? [];
    return lines.map((str, k) => ({ str, hasEOL: k < lines.length - 1 }));
  };
  const capped = (i: number) => opts.capped?.includes(i) ?? false;
  return {
    numPages: pages.length,
    imageTooLarge: false,
    pageSize: async () => ({ width: 612, height: 792 }),
    render: async () => ({
      kind: "drawn",
      canvas: document.createElement("canvas"),
    }),
    renderForPrint: async () => null,
    text: async (i) => ({ items: items(i), capped: capped(i) }),
    textLayer: async (i, container) => {
      const divs = items(i).map((it) => {
        const span = document.createElement("span");
        span.textContent = it.str;
        container.append(span);
        return span;
      });
      return { divs, capped: capped(i), cancel: () => {} };
    },
    links: async () => [],
    outline: async () => ({ entries: [], truncated: false }),
    destroy: async () => {},
  };
}

const body = (tag: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${tag} line ${i + 1}`);

function setup(
  left: Pages,
  right: Pages,
  docs: { left?: DocOptions; right?: DocOptions } = {},
) {
  const a: ComparablePdfText = {
    name: "v1.pdf",
    size: 1,
    extracted: extracted(left),
  };
  const b: ComparablePdfText = {
    name: "v2.pdf",
    size: 1,
    extracted: extracted(right),
  };
  const result = compareExtractedPdfText(a, b);
  const props = {
    left: fakeDoc(left, docs.left),
    right: fakeDoc(right, docs.right),
    result,
    leftPages: a.extracted.pages,
    rightPages: b.extracted.pages,
  };
  return { result, props };
}

/** Records every write to a scroller's scrollTop, as the delta it made. */
function recordWrites(el: HTMLElement): number[] {
  const writes: number[] = [];
  let value = 0;
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => value,
    set: (v: number) => {
      writes.push(v - value);
      value = v;
    },
  });
  return writes;
}

const realRect = Element.prototype.getBoundingClientRect;
afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
  vi.unstubAllGlobals();
});

/** Marks report a place far down their page, so a reveal moves the scroller by a known amount. */
function placeMarks() {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.tagName === "MARK") {
      const page = Number(
        this.closest("[data-viewer-page]")?.getAttribute("data-viewer-page"),
      );
      const top = 400 + page * 1000;
      return {
        top,
        bottom: top + 10,
        left: 0,
        right: 10,
        height: 10,
        width: 10,
        x: 0,
        y: top,
        toJSON() {},
      } as DOMRect;
    }
    return realRect.call(this);
  };
}

// 3000 ms: each wait below covers the whole in-memory chain of a column
// (sizes, layout write, text layer, placement, marks), and the file's
// first test pays first-execution costs inside it. That test took at
// most 503 ms in all on CI (run 44299285879, ci-durations.tsv, 12
// passing runs of 11-18), so > 5x where the 1 s default gave 1.7x; and
// it stays under the 5 s test timeout, so a wait's own message wins. Not
// configure({ asyncUtilTimeout }): that is module state, and under
// isolate:false it would leak into later files in the same worker.
const SETTLE = { timeout: 3_000 } as const;

describe("Compare PDF's page view", () => {
  it("renders its chunk marker, two labelled columns and the sync box", async () => {
    const { props } = setup(
      [body("a", 3)],
      [[...body("a", 2), "a line 3 changed"]],
    );
    render(<CompareViewer {...props} current={0} navToken={1} />);
    const panel = await screen.findByRole(
      "group",
      { name: "Changes on the pages" },
      SETTLE,
    );
    expect(panel.getAttribute("data-chunk")).toBe(COMPARE_VIEWER_CHUNK);
    expect(panel.hasAttribute("data-pdf-viewer")).toBe(true);
    expect(
      screen.getByRole("region", { name: "Original: v1.pdf" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Revised: v2.pdf" }),
    ).toBeTruthy();
    expect(screen.getByText("Original · v1.pdf")).toBeTruthy();
    expect(screen.getByText("Revised · v2.pdf")).toBeTruthy();
    const box = screen.getByRole("checkbox", {
      name: "Scroll both files together",
    });
    expect((box as HTMLInputElement).checked).toBe(true);
    // The marks land: removed on the original, added on the revised.
    await waitFor(
      () =>
        expect(
          panel.querySelector('mark[data-mark-kind="added"]')?.textContent,
        ).toBe(" changed"),
      SETTLE,
    );
    expect(panel.querySelector('mark[data-mark-kind="removed"]')).toBeNull();
  });

  it("a move takes both files to the change's first page on each side", async () => {
    const left = [
      body("p1", 3),
      body("p2", 3),
      [...body("p3", 2), "p3 line 3"],
    ];
    const right = [
      body("p1", 3),
      body("ins", 3),
      body("p2", 3),
      [...body("p3", 2), "p3 line 3 edited"],
    ];
    const { props, result } = setup(left, right);
    expect(result.hunks.length).toBeGreaterThanOrEqual(2);
    const view = render(<CompareViewer {...props} current={0} navToken={1} />);
    const [l, r] = ["Original: v1.pdf", "Revised: v2.pdf"].map((n) =>
      screen.getByRole("region", { name: n }),
    );
    await waitFor(
      () => expect(l!.querySelector("[data-viewer-page]")).not.toBeNull(),
      SETTLE,
    );
    const last = result.hunks.length - 1;
    view.rerender(<CompareViewer {...props} current={last} navToken={2} />);
    await waitFor(() => {
      const lp = result.hunks[last]!.leftPages[0] - 1;
      const rp = result.hunks[last]!.rightPages[0] - 1;
      // scrollForPage: the page's top less half the column pad.
      expect(l!.scrollTop).toBeGreaterThan(lp === 0 ? -1 : 0);
      expect(r!.scrollTop).toBeGreaterThan(rp === 0 ? -1 : 0);
      expect(r!.scrollTop).toBeGreaterThan(l!.scrollTop);
    }, SETTLE);
  });

  it("a change across two live pages reveals once, on its first page, and a remount does not reveal again (G16)", async () => {
    placeMarks();
    const left = [
      body("x", 4),
      ...Array.from({ length: 18 }, (_, i) => body(`tail${i}`, 2)),
    ];
    const right = [
      [...body("x", 3), "x line 4 moved"],
      ["new first line on page two", ...body("tail0", 2)],
      ...Array.from({ length: 17 }, (_, i) => body(`tail${i + 1}`, 2)),
    ];
    const { props, result } = setup(left, right);
    const hunk = result.hunks[0]!;
    expect(hunk.rightPages).toEqual([1, 2]);
    const view = render(<CompareViewer {...props} current={0} navToken={1} />);
    const r = screen.getByRole("region", { name: "Revised: v2.pdf" });
    const writes = recordWrites(r);
    view.rerender(<CompareViewer {...props} current={0} navToken={2} />);
    // Both pages are live and carry the change's marks.
    await waitFor(() => {
      expect(
        r.querySelector(
          '[data-viewer-page="1"] mark[data-viewer-hit="active"]',
        ),
      ).not.toBeNull();
      expect(
        r.querySelector(
          '[data-viewer-page="2"] mark[data-viewer-hit="active"]',
        ),
      ).not.toBeNull();
    }, SETTLE);
    // The reveal is synchronous with applying the active mark the wait above
    // saw, so a timer-free flush is enough (a 30 ms sleep stood here).
    await act(async () => {});
    // Page 1's mark centred once (top 1,400 + 5); page 2's (2,405) never.
    expect(writes.filter((d) => d === 1405).length).toBe(1);
    expect(writes.filter((d) => d === 2405).length).toBe(0);
    // Scroll far away (the reader's own scroll), then back: page 1 remounts.
    const scrollTo = (top: number) => {
      fireEvent.pointerDown(r);
      r.scrollTop = top;
      fireEvent.scroll(r);
    };
    // Health check, which the 40 ms sleeps here never had: page 1 really
    // LEFT the mounted window, so the return below is a remount and "not
    // revealed again" is a measurement, not the mark that never went away.
    scrollTo(15_000);
    await waitFor(
      () => expect(r.querySelector('[data-viewer-page="1"]')).toBeNull(),
      SETTLE,
    );
    scrollTo(0);
    await waitFor(
      () =>
        expect(
          r.querySelector(
            '[data-viewer-page="1"] mark[data-viewer-hit="active"]',
          ),
        ).not.toBeNull(),
      SETTLE,
    );
    await act(async () => {});
    expect(writes.filter((d) => d === 1405).length).toBe(1);
  });

  it("notes: lines that cannot be placed, a page past the item cap, a page with no text", async () => {
    const left = [
      body("a", 3),
      [...body("b", 2), "b line 3"],
      [],
      body("d", 2),
    ];
    const right = [
      [...body("a", 2), "a line 3 x"],
      [...body("b", 2), "b line 3 y"],
      [],
      body("d", 2),
    ];
    const { props } = setup(left, right, {
      // Page 1's items are not the text the comparison read: flagged.
      right: { itemsOf: { 0: ["something else entirely"] }, capped: [1] },
    });
    render(<CompareViewer {...props} current={0} navToken={1} />);
    const r = screen.getByRole("region", { name: "Revised: v2.pdf" });
    await waitFor(
      () =>
        expect(
          [...r.querySelectorAll("[data-compare-page-note]")].map(
            (n) => n.textContent,
          ),
        ).toContain(compareUnplacedNote(1)),
      SETTLE,
    );
    await waitFor(
      () =>
        expect(r.querySelector("[data-viewer-text-capped]")?.textContent).toBe(
          COMPARE_CAPPED_NOTE,
        ),
      SETTLE,
    );
    // One sentence on the capped page, never the flag note beside it.
    expect(
      r
        .querySelector('[data-viewer-page="2"]')
        ?.parentElement?.querySelectorAll("[data-compare-page-note]").length,
    ).toBeLessThanOrEqual(1);
    const l = screen.getByRole("region", { name: "Original: v1.pdf" });
    await waitFor(
      () =>
        expect(
          [...l.querySelectorAll("[data-compare-page-note]")].map(
            (n) => n.textContent,
          ),
        ).toContain(COMPARE_NO_TEXT_NOTE),
      SETTLE,
    );
    // The move's page could not be marked: the polite region says so.
    await waitFor(
      () =>
        expect(
          document.querySelector("[data-compare-viewer-announce]")?.textContent,
        ).toContain(compareUnplacedNote(1)),
      SETTLE,
    );
  });

  it("on a phone one file is shown at a time, switched by Original and Revised", async () => {
    vi.stubGlobal(
      "matchMedia",
      (q: string) =>
        ({
          matches: q === "(max-width: 639px)",
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    const { props } = setup(
      [body("a", 3)],
      [[...body("a", 2), "a line 3 changed"]],
    );
    render(<CompareViewer {...props} current={0} navToken={1} />);
    const original = await screen.findByRole(
      "button",
      { name: "Original" },
      SETTLE,
    );
    const revised = screen.getByRole("button", { name: "Revised" });
    expect(original.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.queryByRole("region", { name: "Revised: v2.pdf" }),
    ).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(revised);
    expect(revised.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.queryByRole("region", { name: "Original: v1.pdf" }),
    ).toBeNull();
    const r = screen.getByRole("region", { name: "Revised: v2.pdf" });
    await waitFor(
      () =>
        expect(r.querySelector('mark[data-mark-kind="added"]')).not.toBeNull(),
      SETTLE,
    );
  });
});

describe("the page view's bounds and colours", () => {
  it("two sides hold no more live canvases than one PDF Viewer", () => {
    expect(2 * COMPARE_LIVE_PAGES_PER_SIDE).toBeLessThanOrEqual(
      VIEWER_LIVE_PAGES,
    );
  });

  /** WCAG relative luminance of a #rrggbb or #rgb colour. */
  function luminance(hex: string): number {
    const h =
      hex.length === 4
        ? [...hex.slice(1)].map((c) => c + c).join("")
        : hex.slice(1);
    const [r, g, b] = [0, 2, 4].map((i) => {
      const c = Number.parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  }
  const contrast = (hex: string) => 1.05 / (luminance(hex) + 0.05);

  it("every line and outline colour holds 3:1 on white; every fill stays translucent (G11)", () => {
    const strokes = [
      ...COMPARE_LAYER_CSS.matchAll(
        /(?:text-decoration-color|outline)\s*:[^;}]*?(#[0-9a-fA-F]{3,6})\b/g,
      ),
    ].map((m) => m[1]!);
    const fills = [
      ...COMPARE_LAYER_CSS.matchAll(
        /background\s*:\s*rgb\([^)]*\/\s*([0-9.]+)\)/g,
      ),
    ].map((m) => Number(m[1]));
    // Health: the parser sees the colours the marks use.
    expect(strokes.length).toBeGreaterThanOrEqual(3);
    expect(fills.length).toBeGreaterThanOrEqual(2);
    for (const c of strokes) expect(contrast(c), c).toBeGreaterThanOrEqual(3);
    for (const a of fills) expect(a).toBeLessThanOrEqual(0.35);
    // Positive control: a light green fails.
    expect(contrast("#6c6")).toBeLessThan(3);
  });
});

// @vitest-environment jsdom
// @native-canvas
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { PDFDocument, PDFName } from "pdf-lib";
import { mergePdfs, type MergeOptions } from "@/lib/pdf/engine";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ToolRunner } from "./tool-runner";
import { runnerMounted } from "@/tests/runner-mounted";

/**
 * Merge PDF's options, driven the way a visitor drives them, with the verdict
 * read off the bytes the Download button hands the browser: an option the
 * engine honours but the panel never sends is an option nobody has.
 *
 * No `vi.mock` (the suite shares one module cache); the browser seams are
 * stubbed on the globals and restored, as in `overlay-runner.test.tsx`.
 */

const router = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};

function Router({ children }: { children: ReactNode }) {
  return (
    <AppRouterContext.Provider value={router as never}>
      {children}
    </AppRouterContext.Provider>
  );
}

let downloads: Blob[] = [];
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  downloads = [];
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    if (obj instanceof Blob) downloads.push(obj);
    return `blob:merge-runner-test/${downloads.length}`;
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
});

/** A PDF whose pages have the given widths: page identity is its width. */
async function pdfOfWidths(widths: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, 100]);
  return doc.save();
}

function pdfFile(bytes: Uint8Array, name: string, lastModified = 0) {
  return new File([bytes.slice()], name, {
    type: "application/pdf",
    lastModified,
  });
}

/** Mount Merge PDF and drop `files` on it; resolves once both are listed. */
async function mountWith(files: File[]): Promise<void> {
  const { container } = render(
    <Router>
      <ToolRunner kind="merge" slug="merge-pdf" />
    </Router>,
  );
  await runnerMounted(container);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input, "the merge dropzone file input").not.toBeNull();
  fireEvent.change(input!, { target: { files } });
  for (const file of files) await screen.findAllByText(file.name);
}

/** Press Merge, download, and return the page widths of the file handed over. */
async function mergeAndRead(): Promise<{ widths: number[]; summary: string }> {
  const run = screen.getByRole("button", { name: /^merge/i });
  await waitFor(() => expect(run).toBeEnabled());
  fireEvent.click(run);
  const download = await screen.findByRole(
    "button",
    { name: /download merged pdf/i },
    { timeout: 10_000 },
  );
  const summary = download.closest('[role="group"]')?.textContent ?? "";
  fireEvent.click(download);
  expect(downloads, "the Download button handed over no Blob").toHaveLength(1);
  const doc = await PDFDocument.load(
    new Uint8Array(await downloads[0]!.arrayBuffer()),
  );
  return {
    widths: doc.getPages().map((p) => Math.round(p.getSize().width)),
    summary,
  };
}

describe("merge-pdf: the options reach the downloaded file", () => {
  it("'Add a blank page after files with an odd page count' pads the odd file, and the summary counts it", async () => {
    await mountWith([
      pdfFile(await pdfOfWidths([11, 12, 13]), "a.pdf"),
      pdfFile(await pdfOfWidths([21, 22]), "b.pdf"),
    ]);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /add a blank page after files with an odd page count/i,
      }),
    );
    const { widths, summary } = await mergeAndRead();
    expect(widths).toEqual([11, 12, 13, 13, 21, 22]);
    expect(summary).toContain("6 pages (1 blank)");
  }, 30_000);

  it("with 'Add a contents page' ticked too, every file still starts on the front of a sheet", async () => {
    // Review of audit merge-pdf#3: one contents page in front once moved
    // every file onto the back of a sheet.
    await mountWith([
      pdfFile(await pdfOfWidths([11, 12, 13]), "a.pdf"),
      pdfFile(await pdfOfWidths([21, 22]), "b.pdf"),
      pdfFile(await pdfOfWidths([31]), "c.pdf"),
    ]);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /add a blank page after files with an odd page count/i,
      }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /^add a contents page/i }),
    );
    const { widths, summary } = await mergeAndRead();
    const firsts = [11, 21, 31].map((x) => widths.indexOf(x));
    expect(
      firsts.every((i) => i % 2 === 0),
      `widths ${widths}`,
    ).toBe(true);
    expect(summary).toContain(`${widths.length} pages (1 contents, 2 blank)`);
  }, 30_000);

  it("CONTROL: left unticked, nothing is added", async () => {
    await mountWith([
      pdfFile(await pdfOfWidths([11, 12, 13]), "a.pdf"),
      pdfFile(await pdfOfWidths([21, 22]), "b.pdf"),
    ]);
    const { widths } = await mergeAndRead();
    expect(widths).toEqual([11, 12, 13, 21, 22]);
  }, 30_000);

  it("'Print each file's name at the foot of its pages' stamps the names into the download", async () => {
    await mountWith([
      pdfFile(await pdfOfWidths([300]), "exhibit-a.pdf"),
      pdfFile(await pdfOfWidths([310]), "exhibit-b.pdf"),
    ]);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /print each file's name at the foot of its pages/i,
      }),
    );
    await mergeAndRead();
    const { extractPdfText } = await import("@/lib/pdf/text");
    const { pages } = await extractPdfText(
      new Uint8Array(await downloads[0]!.arrayBuffer()),
      async () => (await import("pdfjs-dist/legacy/build/pdf.mjs")) as never,
    );
    // Named as the bookmarks are: the file name without its .pdf ending.
    expect(pages.map((p) => p.text.trim())).toEqual(["exhibit-a", "exhibit-b"]);
  }, 30_000);

  it("'Oldest first' and 'Newest first' order the files by when they were last modified", async () => {
    // Names carry no date, and the drop order is neither: only the files'
    // own modified times put them in the order they were made.
    await mountWith([
      pdfFile(await pdfOfWidths([20]), "scan.pdf", Date.UTC(2026, 1, 1)),
      pdfFile(await pdfOfWidths([10]), "scan (1).pdf", Date.UTC(2026, 0, 1)),
      pdfFile(await pdfOfWidths([30]), "scan (2).pdf", Date.UTC(2026, 2, 1)),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Oldest first" }));
    expect((await mergeAndRead()).widths).toEqual([10, 20, 30]);
  }, 30_000);

  it("'Newest first' is the reverse", async () => {
    await mountWith([
      pdfFile(await pdfOfWidths([20]), "scan.pdf", Date.UTC(2026, 1, 1)),
      pdfFile(await pdfOfWidths([10]), "scan (1).pdf", Date.UTC(2026, 0, 1)),
      pdfFile(await pdfOfWidths([30]), "scan (2).pdf", Date.UTC(2026, 2, 1)),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Newest first" }));
    expect((await mergeAndRead()).widths).toEqual([30, 20, 10]);
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 *  Arrange pages (audit backlog #9, 2026-11-17): the page grid, driven
 *  the way a visitor drives it, read back from the download.
 * ------------------------------------------------------------------ */

/** The downloaded file's pages: widths and /Rotate. */
async function downloaded(): Promise<{ widths: number[]; turns: number[] }> {
  const doc = await PDFDocument.load(
    new Uint8Array(await downloads[0]!.arrayBuffer()),
  );
  return {
    widths: doc.getPages().map((p) => Math.round(p.getSize().width)),
    turns: doc.getPages().map((p) => p.getRotation().angle),
  };
}

/** Choose Arrange pages and wait for its (lazy) grid. */
async function arrangePages(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("radio", { name: "Arrange pages" }));
  return screen.findByRole(
    "list",
    { name: /^Pages of every file/ },
    { timeout: 10_000 },
  );
}

/** The grid's tiles, as their names: "Page 1 of b.pdf, page 1 of 5 ...". */
function tileNames(): string[] {
  const grid = screen.getByRole("list", { name: /^Pages of every file/ });
  return [...grid.querySelectorAll('[role="listitem"]')].map(
    (el) => el.getAttribute("aria-label") ?? "",
  );
}

/** Keyboard move: grab the handle, press `key`, drop (one node throughout). */
function keyboardMove(handle: RegExp, key: string) {
  const grip = screen.getByRole("button", { name: handle });
  fireEvent.keyDown(grip, { key: "Enter" });
  expect(grip.getAttribute("aria-pressed")).toBe("true");
  fireEvent.keyDown(grip, { key });
  fireEvent.keyDown(grip, { key: "Enter" });
  expect(grip.getAttribute("aria-pressed")).toBe("false");
}

const pagesBox = (name: string) =>
  screen.getByRole("textbox", {
    name: new RegExp(`^Pages of ${name.replace(".", "\\.")} to merge`),
  }) as HTMLInputElement;

const MIDDLE_DOT = String.fromCodePoint(0xb7);

describe("merge-pdf: Arrange pages reaches the downloaded file", () => {
  it("a keyboard move across files, a turn and a page left out are what the download holds", async () => {
    await mountWith([
      pdfFile(await pdfOfWidths([11, 12, 13]), "alpha.pdf"),
      pdfFile(await pdfOfWidths([21, 22]), "beta.pdf"),
    ]);
    await arrangePages();
    expect(tileNames()).toHaveLength(5);
    keyboardMove(/^Reorder page 1 of beta\.pdf/, "Home");
    expect(tileNames()[0]).toMatch(/^Page 1 of beta\.pdf, page 1 of 5/);
    fireEvent.click(
      screen.getByRole("button", { name: "Rotate page 2 of beta.pdf right" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Leave out page 2 of alpha.pdf" }),
    );
    expect(
      screen.getByText(`2 files ${MIDDLE_DOT} 4 pages`, { exact: false }),
    ).toBeTruthy();
    // The box says WHICH pages of alpha go in, never their order.
    expect(pagesBox("alpha.pdf").value).toBe("1, 3");
    expect(pagesBox("beta.pdf").value).toBe("");
    await mergeAndRead();
    expect(await downloaded()).toEqual({
      widths: [21, 11, 13, 22],
      turns: [0, 0, 0, 90],
    });
  }, 30_000);

  it("a page typed back in returns to its slot, and leaving to One after another and back keeps order and turns", async () => {
    await mountWith([
      pdfFile(await pdfOfWidths([11, 12, 13]), "alpha.pdf"),
      pdfFile(await pdfOfWidths([21, 22]), "beta.pdf"),
    ]);
    await arrangePages();
    keyboardMove(/^Reorder page 1 of beta\.pdf/, "Home");
    fireEvent.click(
      screen.getByRole("button", { name: "Rotate page 1 of alpha.pdf left" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Leave out page 2 of alpha.pdf" }),
    );
    const left = tileNames();
    expect(left[2]).toBe("Page 2 of alpha.pdf, left out");
    // Typed back in: same slot, nothing else moves.
    fireEvent.change(pagesBox("alpha.pdf"), { target: { value: "1-3" } });
    expect(tileNames()[2]).toMatch(/^Page 2 of alpha\.pdf, page 3 of 5/);
    expect(tileNames().map((n) => n.split(",")[0])).toEqual(
      left.map((n) => n.split(",")[0]),
    );
    fireEvent.blur(pagesBox("alpha.pdf"));
    expect(pagesBox("alpha.pdf").value).toBe("");
    // A typo is held, and blocks the merge with the existing reason.
    fireEvent.change(pagesBox("alpha.pdf"), { target: { value: "9" } });
    expect(screen.getByText("Fix the page range above first.")).toBeTruthy();
    fireEvent.change(pagesBox("alpha.pdf"), { target: { value: "" } });
    const before = tileNames();
    fireEvent.click(screen.getByRole("radio", { name: "One after another" }));
    // File mode lists the files by their first pages, and says the rest waits.
    expect(screen.getByText(/Your page arrangement is kept\./)).toBeTruthy();
    const rows = screen.getAllByRole("listitem", { name: /, file \d of 2/ });
    expect(
      rows.map((r) => r.getAttribute("aria-label")?.split(",")[0]),
    ).toEqual(["beta.pdf", "alpha.pdf"]);
    await arrangePages();
    expect(tileNames()).toEqual(before);
    await mergeAndRead();
    expect(await downloaded()).toEqual({
      widths: [21, 11, 12, 13, 22],
      turns: [0, 270, 0, 0, 0],
    });
  }, 30_000);

  it("a file's last kept page cannot be left out", async () => {
    await mountWith([
      pdfFile(await pdfOfWidths([11, 12]), "alpha.pdf"),
      pdfFile(await pdfOfWidths([21]), "beta.pdf"),
    ]);
    await arrangePages();
    const last = screen.getByRole("button", {
      name: "Keep at least one page of beta.pdf, or remove the file",
    });
    expect(last.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(last);
    expect(tileNames()[2]).toMatch(/^Page 1 of beta\.pdf, page 3 of 3/);
    // Control: a file with two kept pages CAN drop one.
    fireEvent.click(
      screen.getByRole("button", { name: "Leave out page 1 of alpha.pdf" }),
    );
    expect(tileNames()[0]).toBe("Page 1 of alpha.pdf, left out");
  }, 30_000);
});

describe("merge-pdf: the options Arrange pages offers are exactly the ones the engine takes", () => {
  /** Each option checkbox's opening words, and the MergeOptions key it sends. */
  const OPTION_KEYS = {
    "Add a bookmark for each file": "fileBookmarks",
    "Add a contents page": "contentsPage",
    "Add a blank page after files with an odd page count": "blankAfterOdd",
    "Print each file's name at the foot of its pages": "fileNames",
  } as const satisfies Record<string, keyof MergeOptions>;
  type Label = keyof typeof OPTION_KEYS;

  /** The option checkboxes as rendered, discovered by role, never listed. */
  function discovered(): { label: Label; box: HTMLInputElement }[] {
    return screen.getAllByRole("checkbox").map((box) => {
      const name = box.closest("label")?.textContent ?? "";
      const label = (Object.keys(OPTION_KEYS) as Label[]).find((l) =>
        name.startsWith(l),
      );
      if (!label) throw new Error(`an option the table does not know: ${name}`);
      return { label, box: box as HTMLInputElement };
    });
  }

  const valueFor = (key: string) =>
    key === "blankAfterOdd" ? true : ["alpha", "beta"];

  it("grouped: all four are offered, and each one's effect is in the download", async () => {
    await mountWith([
      pdfFile(await pdfOfWidths([311, 312, 313]), "alpha.pdf"),
      pdfFile(await pdfOfWidths([321, 322]), "beta.pdf"),
    ]);
    await arrangePages();
    // Reordered inside alpha only: the files stay together.
    keyboardMove(/^Reorder page 3 of alpha\.pdf/, "Home");
    const boxes = discovered();
    expect(new Set(boxes.map((b) => b.label))).toEqual(
      new Set(Object.keys(OPTION_KEYS)),
    );
    for (const { box } of boxes) {
      expect(box.getAttribute("aria-disabled")).toBeNull();
      fireEvent.click(box);
      expect(box.checked).toBe(true);
    }
    const { widths, summary } = await mergeAndRead();
    // Contents (sized like the first page) and its pad, then alpha 313 311
    // 312 (odd: padded), then beta, last, unpadded.
    expect(widths).toEqual([313, 313, 313, 311, 312, 312, 321, 322]);
    expect(summary).toContain("(1 contents, 2 blank)");
    const bytes = new Uint8Array(await downloads[0]!.arrayBuffer());
    const { extractPdfText } = await import("@/lib/pdf/text");
    const { pages } = await extractPdfText(
      bytes,
      async () => (await import("pdfjs-dist/legacy/build/pdf.mjs")) as never,
    );
    expect(pages[0]!.text).toMatch(/Contents/);
    expect(pages[2]!.text).toContain("alpha");
    expect(pages[6]!.text).toContain("beta");
    const doc = await PDFDocument.load(bytes);
    expect(doc.catalog.get(PDFName.of("Outlines"))).toBeDefined();
  }, 30_000);

  it("interleaved: the greyed-out options are exactly the ones the engine refuses", async () => {
    const alpha = await pdfOfWidths([311, 312, 313]);
    const beta = await pdfOfWidths([321, 322]);
    await mountWith([pdfFile(alpha, "alpha.pdf"), pdfFile(beta, "beta.pdf")]);
    await arrangePages();
    // Beta's first page to the front: beta, alpha, alpha, alpha, beta.
    keyboardMove(/^Reorder page 1 of beta\.pdf/, "Home");
    expect(
      screen.getByText(
        /^Your files' pages are mixed, so these options are off/,
      ),
    ).toBeTruthy();
    const boxes = discovered();
    expect(new Set(boxes.map((b) => b.label))).toEqual(
      new Set(Object.keys(OPTION_KEYS)),
    );
    const disabled = boxes
      .filter((b) => b.box.getAttribute("aria-disabled") === "true")
      .map((b) => OPTION_KEYS[b.label])
      .sort();
    const order = [
      { file: 0, page: 0 },
      { file: 1, page: 0 },
      { file: 1, page: 1 },
      { file: 1, page: 2 },
      { file: 0, page: 1 },
    ];
    const refused: string[] = [];
    for (const key of Object.values(OPTION_KEYS)) {
      try {
        await mergePdfs([beta, alpha], { order, [key]: valueFor(key) });
      } catch {
        refused.push(key);
      }
    }
    expect(disabled).toEqual(refused.sort());
    // Positive control: the split is real, some of each.
    expect(disabled.length).toBeGreaterThan(0);
    expect(disabled.length).toBeLessThan(boxes.length);
    // Greyed out on screen too, not only to a screen reader (review of
    // 2026-11-17: aria-disabled alone drew an ordinary box). Each greyed
    // label is drawn unlike every offered one.
    const look = (box: HTMLInputElement) => {
      const s = getComputedStyle(box.closest("label")!);
      return `${s.opacity}|${getComputedStyle(box).cursor}`;
    };
    const offLooks = boxes
      .filter((b) => disabled.includes(OPTION_KEYS[b.label]))
      .map((b) => look(b.box));
    const onLooks = boxes
      .filter((b) => !disabled.includes(OPTION_KEYS[b.label]))
      .map((b) => look(b.box));
    for (const off of offLooks) expect(onLooks).not.toContain(off);
    expect(offLooks[0]).toBe("0.5|not-allowed");
    // A greyed-out box shows unticked and is never sent: tick them all,
    // merge, and the download carries no contents page and no pad.
    for (const { box } of boxes) fireEvent.click(box);
    for (const { label, box } of boxes)
      expect(box.checked, label).toBe(!disabled.includes(OPTION_KEYS[label]));
    const { widths } = await mergeAndRead();
    expect(widths).toEqual([321, 311, 312, 313, 322]);
  }, 30_000);
});

describe("merge-pdf: an untouched Arrange pages merges what the mode it came from merges", () => {
  async function widthsAfter(
    files: File[],
    setup: () => void,
    arrange: boolean,
  ): Promise<number[]> {
    await mountWith(files);
    setup();
    if (arrange) await arrangePages();
    const { widths } = await mergeAndRead();
    cleanup();
    downloads = [];
    return widths;
  }

  it("from One after another, with a Pages selection", async () => {
    const files = async () => [
      pdfFile(await pdfOfWidths([11, 12, 13, 14]), "alpha.pdf"),
      pdfFile(await pdfOfWidths([21, 22]), "beta.pdf"),
    ];
    const setup = () =>
      fireEvent.change(pagesBox("alpha.pdf"), { target: { value: "4, 2" } });
    const plain = await widthsAfter(await files(), setup, false);
    const arranged = await widthsAfter(await files(), setup, true);
    expect(plain).toEqual([12, 14, 21, 22]);
    expect(arranged).toEqual(plain);
  }, 60_000);

  it("from Alternate pages, with Reverse page order", async () => {
    const files = async () => [
      pdfFile(await pdfOfWidths([11, 12, 13]), "fronts.pdf"),
      pdfFile(await pdfOfWidths([23, 22, 21]), "backs.pdf"),
    ];
    const setup = () => {
      fireEvent.click(screen.getByRole("radio", { name: "Alternate pages" }));
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: "Reverse the page order of backs.pdf",
        }),
      );
    };
    const plain = await widthsAfter(await files(), setup, false);
    const arranged = await widthsAfter(await files(), setup, true);
    expect(plain).toEqual([11, 21, 12, 22, 13, 23]);
    expect(arranged).toEqual(plain);
  }, 60_000);
});

describe("merge-pdf: Arrange pages chosen again follows what was set in between", () => {
  // Review of 2026-11-17: the list kept from the first visit came back
  // whatever the file mode did, so the grid merged an order the visitor had
  // just changed. Now it comes back only while it says something file mode
  // cannot; otherwise the grid is seeded from the mode just left.
  it("a file moved up in One after another leads the grid and the download", async () => {
    await mountWith([
      pdfFile(await pdfOfWidths([11, 12, 13]), "alpha.pdf"),
      pdfFile(await pdfOfWidths([21, 22]), "beta.pdf"),
    ]);
    await arrangePages();
    fireEvent.click(screen.getByRole("radio", { name: "One after another" }));
    expect(screen.queryByText(/Your page arrangement is kept\./)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Move beta.pdf up" }));
    await arrangePages();
    expect(tileNames().map((n) => n.split(",")[0])).toEqual([
      "Page 1 of beta.pdf",
      "Page 2 of beta.pdf",
      "Page 1 of alpha.pdf",
      "Page 2 of alpha.pdf",
      "Page 3 of alpha.pdf",
    ]);
    await mergeAndRead();
    expect((await downloaded()).widths).toEqual([21, 22, 11, 12, 13]);
  }, 30_000);

  it("Alternate pages left untouched seeds the grid it would merge", async () => {
    await mountWith([
      pdfFile(await pdfOfWidths([11, 12, 13]), "alpha.pdf"),
      pdfFile(await pdfOfWidths([21, 22]), "beta.pdf"),
    ]);
    await arrangePages();
    fireEvent.click(screen.getByRole("radio", { name: "Alternate pages" }));
    await arrangePages();
    await mergeAndRead();
    expect((await downloaded()).widths).toEqual([11, 21, 12, 22, 13]);
  }, 30_000);

  // Re-review of 2026-11-17: an Alternate seed visited and left untouched was
  // kept aside as if the user had mixed it, because it interleaves. The grid
  // then came back in Alternate order from One after another, under a "kept"
  // note for an arrangement nobody made.
  it.each([
    ["", false],
    [", with Reverse page order", true],
  ])(
    "an untouched Alternate grid is not kept: One after another then seeds its own%s",
    async (_label, reverse) => {
      await mountWith([
        pdfFile(await pdfOfWidths([11, 12, 13]), "alpha.pdf"),
        pdfFile(await pdfOfWidths([21, 22, 23]), "beta.pdf"),
      ]);
      fireEvent.click(screen.getByRole("radio", { name: "Alternate pages" }));
      if (reverse)
        fireEvent.click(
          screen.getByRole("checkbox", {
            name: "Reverse the page order of beta.pdf",
          }),
        );
      await arrangePages();
      // Health check: the grid really is the mixed Alternate seed.
      expect(tileNames().map((n) => n.split(",")[0])[1]).toBe(
        reverse ? "Page 3 of beta.pdf" : "Page 1 of beta.pdf",
      );
      fireEvent.click(screen.getByRole("radio", { name: "One after another" }));
      expect(screen.queryByText(/Your page arrangement is kept\./)).toBeNull();
      await arrangePages();
      expect(tileNames().map((n) => n.split(",")[0])).toEqual([
        "Page 1 of alpha.pdf",
        "Page 2 of alpha.pdf",
        "Page 3 of alpha.pdf",
        "Page 1 of beta.pdf",
        "Page 2 of beta.pdf",
        "Page 3 of beta.pdf",
      ]);
      await mergeAndRead();
      expect((await downloaded()).widths).toEqual([11, 12, 13, 21, 22, 23]);
    },
    30_000,
  );

  it("CONTROL: a touched Alternate grid is kept, under the note", async () => {
    await mountWith([
      pdfFile(await pdfOfWidths([11, 12, 13]), "alpha.pdf"),
      pdfFile(await pdfOfWidths([21, 22, 23]), "beta.pdf"),
    ]);
    fireEvent.click(screen.getByRole("radio", { name: "Alternate pages" }));
    await arrangePages();
    fireEvent.click(
      screen.getByRole("button", { name: "Rotate page 2 of alpha.pdf right" }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "One after another" }));
    expect(screen.getByText(/Your page arrangement is kept\./)).toBeTruthy();
    await arrangePages();
    await mergeAndRead();
    expect(await downloaded()).toEqual({
      widths: [11, 21, 12, 22, 13, 23],
      turns: [0, 0, 90, 0, 0, 0],
    });
  }, 30_000);

  it("a turned page is kept, and the new file order applies while files stay together", async () => {
    await mountWith([
      pdfFile(await pdfOfWidths([11, 12, 13]), "alpha.pdf"),
      pdfFile(await pdfOfWidths([21, 22]), "beta.pdf"),
    ]);
    await arrangePages();
    fireEvent.click(
      screen.getByRole("button", { name: "Rotate page 2 of alpha.pdf right" }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "One after another" }));
    expect(screen.getByText(/Your page arrangement is kept\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move beta.pdf up" }));
    await arrangePages();
    await mergeAndRead();
    expect(await downloaded()).toEqual({
      widths: [21, 22, 11, 12, 13],
      turns: [0, 0, 0, 90, 0],
    });
  }, 30_000);

  it("CONTROL: a mixed arrangement is kept as it was, and the page says the file order does not change it", async () => {
    await mountWith([
      pdfFile(await pdfOfWidths([11, 12, 13]), "alpha.pdf"),
      pdfFile(await pdfOfWidths([21, 22]), "beta.pdf"),
    ]);
    await arrangePages();
    keyboardMove(/^Reorder page 1 of beta\.pdf/, "Home");
    fireEvent.click(screen.getByRole("radio", { name: "One after another" }));
    expect(
      screen.getByText(/the file order chosen here does not change it/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move alpha.pdf up" }));
    await arrangePages();
    await mergeAndRead();
    expect((await downloaded()).widths).toEqual([21, 11, 12, 13, 22]);
  }, 30_000);
});

describe("merge-pdf: the page grid's keyboard", () => {
  it("Escape puts a grabbed page back where it was", async () => {
    await mountWith([
      pdfFile(await pdfOfWidths([11, 12]), "alpha.pdf"),
      pdfFile(await pdfOfWidths([21, 22]), "beta.pdf"),
    ]);
    await arrangePages();
    const before = tileNames();
    const grip = screen.getByRole("button", {
      name: /^Reorder page 1 of beta\.pdf/,
    });
    fireEvent.keyDown(grip, { key: "Enter" });
    fireEvent.keyDown(grip, { key: "ArrowLeft" });
    expect(tileNames()[1]).toMatch(/^Page 1 of beta\.pdf/);
    fireEvent.keyDown(grip, { key: "Escape" });
    expect(tileNames()).toEqual(before);
    expect(grip.getAttribute("aria-pressed")).toBe("false");
    await mergeAndRead();
    expect((await downloaded()).widths).toEqual([11, 12, 21, 22]);
  }, 30_000);

  it("the grid is one tab stop, and the arrow keys go from page to page", async () => {
    await mountWith([
      pdfFile(await pdfOfWidths([11, 12, 13]), "alpha.pdf"),
      pdfFile(await pdfOfWidths([21, 22]), "beta.pdf"),
    ]);
    const grid = await arrangePages();
    const tiles = () => [...grid.querySelectorAll('[role="listitem"]')];
    /** The grid's controls Tab can land on, by tile. */
    const stops = () =>
      tiles().map(
        (t) =>
          [...t.querySelectorAll("button")].filter((el) => el.tabIndex >= 0)
            .length,
      );
    // Health check: every tile HAS buttons, so a count of 0 means skipped.
    const perTile = tiles()[0]!.querySelectorAll("button").length;
    expect(perTile).toBeGreaterThanOrEqual(6);
    expect(stops()).toEqual([perTile, 0, 0, 0, 0]);
    const rotateRight = (n: number, file: string) =>
      screen.getByRole("button", { name: `Rotate page ${n} of ${file} right` });
    rotateRight(1, "alpha.pdf").focus();
    fireEvent.keyDown(rotateRight(1, "alpha.pdf"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(rotateRight(2, "alpha.pdf"));
    // Focus moved the tab stop with it.
    expect(stops()).toEqual([0, perTile, 0, 0, 0]);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(rotateRight(2, "beta.pdf"));
    // The arrows only moved focus: the order is untouched.
    expect(tileNames()[4]).toMatch(/^Page 2 of beta\.pdf, page 5 of 5/);
  }, 30_000);
});

describe("merge-pdf: a Sort that undoes a mixed order can be undone", () => {
  it("Undo brings the mixed order back, and the download follows it", async () => {
    await mountWith([
      pdfFile(await pdfOfWidths([11, 12]), "alpha.pdf"),
      pdfFile(await pdfOfWidths([21, 22]), "beta.pdf"),
    ]);
    await arrangePages();
    keyboardMove(/^Reorder page 1 of beta\.pdf/, "Home");
    const mixed = tileNames();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Name A/ }));
    expect(tileNames()).not.toEqual(mixed);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(tileNames()).toEqual(mixed);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    await mergeAndRead();
    expect((await downloaded()).widths).toEqual([21, 11, 12, 22]);
  }, 30_000);
});

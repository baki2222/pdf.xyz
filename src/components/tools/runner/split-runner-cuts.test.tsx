// @vitest-environment jsdom
// @native-canvas
/**
 * Audit split-pdf#3 (2026-11-06): every competitor's split is chosen on the
 * pages themselves — scissors between thumbnails — while ours took typed
 * ranges only, with a text list for a preview. A person who did not know the
 * page numbers by heart had to open the PDF somewhere else first.
 *
 * Split by ranges now draws the pages with a "Cut after page N" toggle on
 * each. The typed box stays the source of truth: a cut rewrites it, and typing
 * redraws the cuts. Judged on the files the person downloads: the ZIP is
 * caught where the browser receives it and every part is opened and its
 * pages named by their widths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import { cutAfterLabel } from "./page-picker";
import { SplitEditor } from "./split-runner";

let downloads: Blob[] = [];
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  downloads = [];
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    if (obj instanceof Blob) downloads.push(obj);
    return `blob:split-cuts/${downloads.length}`;
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  resetAnnouncer();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
});

/** Page n (1-based) is 100 + n points wide, so a width names its page. */
async function pagesPdf(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let n = 1; n <= count; n++) doc.addPage([100 + n, 200]);
  return doc.save();
}

function loaded(bytes: Uint8Array, pageCount: number) {
  return {
    file: new File([new Uint8Array(bytes)], "deck.pdf", {
      type: "application/pdf",
    }),
    bytes,
    pageCount,
    rotations: Array.from({ length: pageCount }, () => 0 as const),
    digitalSignatures: countDigitalSignatures(bytes),
  };
}

const rangeBox = () =>
  screen.getByRole("textbox", { name: /page ranges/i }) as HTMLInputElement;

/** A tile's corner badge: the file numbers, "1" or "1, 2". */
const BADGE = /^\d+(, \d+)*$/;

const cut = (page: number) =>
  screen.findByRole("button", { name: cutAfterLabel(page) });

describe("Split PDF · cut on the pages", () => {
  it("draws the typed ranges as cuts, and a cut rewrites the ranges", async () => {
    render(
      <SplitEditor pdf={loaded(await pagesPdf(5), 5)} onReset={() => {}} />,
    );
    // The opening ranges halve the file: 1-3, 4-5 — a cut after page 3.
    expect(rangeBox().value).toBe("1-3, 4-5");
    expect(await cut(3)).toHaveAttribute("aria-pressed", "true");
    expect(await cut(1)).toHaveAttribute("aria-pressed", "false");
    // The last page has nothing after it to cut.
    expect(screen.queryByRole("button", { name: cutAfterLabel(5) })).toBeNull();

    fireEvent.click(await cut(1));
    expect(rangeBox().value).toBe("1, 2-3, 4-5");
    fireEvent.click(await cut(3));
    expect(rangeBox().value).toBe("1, 2-5");

    // Typing redraws the cuts.
    fireEvent.change(rangeBox(), { target: { value: "1-4, 5" } });
    expect(await cut(4)).toHaveAttribute("aria-pressed", "true");
    expect(await cut(1)).toHaveAttribute("aria-pressed", "false");
  });

  it("a cut covers every page, as the note under the pages says", async () => {
    render(
      <SplitEditor pdf={loaded(await pagesPdf(5), 5)} onReset={() => {}} />,
    );
    fireEvent.change(rangeBox(), { target: { value: "1-2" } });
    expect(await cut(2)).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(await cut(3));
    expect(rangeBox().value).toBe("1-2, 3, 4-5");
    expect(screen.getByText(/cover every page/i)).toBeInTheDocument();
  });

  // Review of 7d46f446: with a typed gap before a range ("3-5"), the cut
  // after page 2 is drawn from the range's START — a branch nothing pressed.
  it("a range that starts after page 1 draws a cut before it, and the gap is dimmed and unbadged", async () => {
    render(
      <SplitEditor pdf={loaded(await pagesPdf(5), 5)} onReset={() => {}} />,
    );
    fireEvent.change(rangeBox(), { target: { value: "3-5" } });
    expect(await cut(2)).toHaveAttribute("aria-pressed", "true");
    expect(await cut(1)).toHaveAttribute("aria-pressed", "false");
    expect(await cut(4)).toHaveAttribute("aria-pressed", "false");
    // Pages 1–2 are in no range: no badge, and drawn dimmed.
    const grid = screen.getByRole("group", { name: /cut after a page/i });
    expect(
      within(grid)
        .getAllByText(BADGE)
        .map((el) => el.textContent),
    ).toEqual(["1", "1", "1"]);
    const dimmed = [...grid.querySelectorAll("[data-picker-page]")].map(
      (slot) => slot.firstElementChild!.classList.contains("opacity-40"),
    );
    expect(dimmed).toEqual([true, true, false, false, false]);
  });

  // Review of 7d46f446: "1-3, 2-4" puts pages 2 and 3 in BOTH files, yet the
  // badge named only the first — against "the badge on each page is the
  // file it lands in". A badge now names every file a page lands in.
  it("a page in two ranges is badged with both files", async () => {
    render(
      <SplitEditor pdf={loaded(await pagesPdf(5), 5)} onReset={() => {}} />,
    );
    fireEvent.change(rangeBox(), { target: { value: "1-3, 2-4" } });
    const grid = await screen.findByRole("group", {
      name: /cut after a page/i,
    });
    const badges = within(grid)
      .getAllByText(BADGE)
      .map((el) => el.textContent);
    // Pages 1–4 are badged; page 5 is in no range and carries none.
    expect(badges).toEqual(["1", "1, 2", "1, 2", "2"]);
  });

  // Review of 7d46f446 (blocker): with Merge ticked the cut picker still drew
  // per-file badges and scissors, though the run makes ONE file — and a cut
  // rewrote the ranges to cover every page, turning the run into a copy of
  // the whole document. With Merge on the pages are picked, not cut.
  it("with Merge ticked the pages are picked for the one file: no cuts, no badges", async () => {
    render(
      <SplitEditor pdf={loaded(await pagesPdf(5), 5)} onReset={() => {}} />,
    );
    // Positive control: unmerged, the grid carries scissors and badges.
    await cut(1);
    const cutGrid = screen.getByRole("group", { name: /cut after a page/i });
    expect(within(cutGrid).getAllByText(BADGE).length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("checkbox", { name: /merge selected ranges/i }),
    );
    const grid = await screen.findByRole("group", { name: /one file/i });
    expect(
      screen.queryByRole("button", { name: /cut after page/i }),
    ).toBeNull();
    expect(within(grid).queryAllByText(BADGE)).toEqual([]);
    expect(screen.queryByText(/badge/i)).toBeNull();
    expect(screen.getByText(/in page order/i)).toBeInTheDocument();
    const page = (n: number) =>
      within(grid).getByRole("button", { name: `Page ${n}` });
    // "1-3, 4-5" names every page, so every page is pressed.
    for (const n of [1, 2, 3, 4, 5]) {
      expect(page(n), `page ${n}`).toHaveAttribute("aria-pressed", "true");
    }
    fireEvent.click(page(2));
    expect(rangeBox().value).toBe("1, 3-5");
    expect(page(2)).toHaveAttribute("aria-pressed", "false");
    // Typing redraws the pressed pages.
    fireEvent.change(rangeBox(), { target: { value: "4, 1" } });
    expect(page(1)).toHaveAttribute("aria-pressed", "true");
    expect(page(3)).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(page(5));
    expect(rangeBox().value).toBe("1, 4-5");

    fireEvent.click(screen.getByRole("button", { name: /split into 1 file/i }));
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: /^download pdf$/i },
        { timeout: 10_000 },
      ),
    );
    await waitFor(() => expect(downloads.length).toBeGreaterThan(0), {
      timeout: 10_000,
    });
    const doc = await PDFDocument.load(
      await downloads[downloads.length - 1]!.arrayBuffer(),
    );
    expect(doc.getPages().map((p) => Math.round(p.getWidth()) - 100)).toEqual([
      1, 4, 5,
    ]);
  });

  it("the arrow keys move between the cuts; one tab stop for the grid", async () => {
    render(
      <SplitEditor pdf={loaded(await pagesPdf(4), 4)} onReset={() => {}} />,
    );
    const first = await cut(1);
    expect(first).toHaveAttribute("tabindex", "0");
    expect(await cut(2)).toHaveAttribute("tabindex", "-1");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(await cut(2));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(await cut(3));
    expect(await cut(3)).toHaveAttribute("tabindex", "0");
  });

  it("splits into the files the cuts drew", async () => {
    render(
      <SplitEditor pdf={loaded(await pagesPdf(5), 5)} onReset={() => {}} />,
    );
    fireEvent.click(await cut(1)); // 1 | 2-3 | 4-5
    fireEvent.click(await cut(3)); // 1 | 2-5
    fireEvent.click(
      screen.getByRole("button", { name: /split into 2 files/i }),
    );
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: /download zip/i },
        { timeout: 10_000 },
      ),
    );
    await waitFor(() => expect(downloads.length).toBeGreaterThan(0), {
      timeout: 10_000,
    });
    const zip = await JSZip.loadAsync(
      await downloads[downloads.length - 1]!.arrayBuffer(),
    );
    const names = Object.keys(zip.files).sort();
    const parts = await Promise.all(
      names.map(async (name) => {
        const doc = await PDFDocument.load(
          await zip.files[name]!.async("uint8array"),
        );
        return doc.getPages().map((p) => Math.round(p.getWidth()) - 100);
      }),
    );
    expect(parts).toEqual([[1], [2, 3, 4, 5]]);
  });
});

describe("Split PDF · the page says what the thumbnails do", () => {
  it("the step and the notes agree on cuts, overlaps and Merge", async () => {
    const { default: content } = await import("@/lib/tools/content/split-pdf");
    const { CUT_NOTE, MERGE_PICK_NOTE } = await import("./split-runner");
    const steps = content.steps.map((s) => s.body).join(" ");
    for (const claim of ["or the files where ranges overlap"]) {
      expect(steps).toContain(claim);
      expect(CUT_NOTE).toContain(claim);
    }
    expect(steps).toMatch(
      /with no scissors, and a press adds or drops a page, rewriting the field in page order/,
    );
    expect(MERGE_PICK_NOTE).toMatch(/in page order/);
    expect(MERGE_PICK_NOTE).not.toMatch(/badge|scissors/);
  });
});

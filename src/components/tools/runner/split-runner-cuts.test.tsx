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

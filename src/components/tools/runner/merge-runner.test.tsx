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
import { PDFDocument } from "pdf-lib";
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
});

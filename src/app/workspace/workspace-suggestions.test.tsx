// @vitest-environment jsdom
/**
 * The workspace carries files — read where a visitor reads it, and checked
 * against what the receiving tool page would claim.
 *
 *  - A suggestion is a real link (`<a href="/tools/merge-pdf">`) whose
 *    accessible name says what it carries ("Open Merge PDF with 2 files").
 *    An unmodified click stashes the files and opens the tool with them; a
 *    modifier-click is left to the browser, a plain link to the tool.
 *  - Each row shows the measured fact behind it and where the tool runs. A
 *    scan's OCR PDF row says which pages have no selectable text, and when
 *    the file would leave the device.
 *  - The page claims a hand-off addressed to the workspace, and says where
 *    the files came from.
 *  - A launch whose files could not be stored says so, and goes nowhere.
 *  - The lede no longer says files "clear the moment you close" the tab: a
 *    file handed to a tool waits in the browser until the tool opens it or
 *    the hand-off expires.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiveRegion, resetAnnouncer } from "@/components/a11y/live-region";
import { HANDOFF_LIFETIME } from "@/lib/browser-storage";
import {
  __setHandoffStoreForTests,
  claimHandoff,
  HandoffStore,
  MemoryHandoffBackend,
  readHandoffId,
  stashHandoff,
  type HandoffBackend,
} from "@/lib/handoff";
import { getPopularTools } from "@/lib/tools";
import { imageOnlyPdf, textPdf } from "@/tests/pdf-text-fixtures";
import { buildToolSummaries } from "./presenter";
import { WorkspaceClient } from "./workspace-client";

const tools = buildToolSummaries();
const popularSlugs = new Set(getPopularTools(6).map((t) => t.slug));
const popular = tools.filter((t) => popularSlugs.has(t.slug));

let pushed: string[];
const ROUTER = {
  push: (href: string) => void pushed.push(href),
  replace: () => {},
  prefetch: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
} as never;

const pdfFile = async (name: string, bytes: Promise<Uint8Array>) =>
  new File([(await bytes) as Uint8Array<ArrayBuffer>], name, {
    type: "application/pdf",
  });

function renderWorkspace(search = "") {
  window.history.replaceState(null, "", `/workspace${search}`);
  return render(
    <AppRouterContext.Provider value={ROUTER}>
      <WorkspaceClient tools={tools} popular={popular} />
      <LiveRegion />
    </AppRouterContext.Provider>,
  );
}

function stage(container: HTMLElement, files: File[]) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input");
  fireEvent.change(input, { target: { files } });
}

/** The first link to a tool whose accessible name matches. */
const rowFor = (name: RegExp) =>
  waitFor(() => screen.getAllByRole("link", { name })[0]!, { timeout: 5000 });

beforeEach(() => {
  pushed = [];
  __setHandoffStoreForTests(
    new HandoffStore({ backend: new MemoryHandoffBackend() }),
  );
});
afterEach(() => {
  cleanup();
  resetAnnouncer();
  __setHandoffStoreForTests(null);
  window.history.replaceState(null, "", "/");
});

describe("a suggestion is a link that carries the files", () => {
  it("two PDFs: 'Open Merge PDF with 2 files' opens Merge PDF with both", async () => {
    const { container } = renderWorkspace();
    stage(container, [
      await pdfFile("a.pdf", textPdf([60])),
      await pdfFile("b.pdf", textPdf([60, 60])),
    ]);
    const merge = await rowFor(/^open merge pdf with 2 files$/i);
    expect(merge.getAttribute("href")).toBe("/tools/merge-pdf");
    // Visible: the fact behind it, and where it runs.
    await waitFor(() => expect(merge.textContent).toMatch(/2 PDFs/));
    expect(within(merge).getByText(/in-browser/i)).toBeTruthy();
    await waitFor(() => expect(merge.textContent).toMatch(/3 pages/));

    fireEvent.click(merge);
    await waitFor(() => expect(pushed).toHaveLength(1));
    expect(pushed[0]).toMatch(/^\/tools\/merge-pdf\?handoff=h_/);
    const record = await claimHandoff(
      readHandoffId(new URL(pushed[0]!, "https://x.test").search)!,
    );
    expect(record?.files.map((f) => f.name)).toEqual(["a.pdf", "b.pdf"]);
    expect(record?.origin).toEqual({ kind: "workspace" });
  });

  it("a modifier-click is the browser's: no stash, no client navigation", async () => {
    const { container } = renderWorkspace();
    stage(container, [
      await pdfFile("a.pdf", textPdf([60])),
      await pdfFile("b.pdf", textPdf([60])),
    ]);
    const merge = await rowFor(/^open merge pdf with 2 files$/i);
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    merge.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(pushed).toEqual([]);
  });

  it("a scan: OCR PDF shows the pages with no selectable text, and when the file moves", async () => {
    const { container } = renderWorkspace();
    stage(container, [await pdfFile("scan.pdf", imageOnlyPdf(1))]);
    const ocr = await rowFor(/^open ocr pdf/i);
    await waitFor(
      () => expect(ocr.textContent).toMatch(/No selectable text on page 1/),
      { timeout: 5000 },
    );
    expect(ocr.textContent).toMatch(/uploads only when you start it/);
    // It cannot carry the file yet, and its name says so.
    expect(ocr.getAttribute("aria-label")).toMatch(/add the file there/i);
  });

  it("announces the suggestions once for the staged set", async () => {
    const { container } = renderWorkspace();
    stage(container, [
      await pdfFile("a.pdf", textPdf([60])),
      await pdfFile("b.pdf", textPdf([60])),
    ]);
    await waitFor(
      () =>
        expect(screen.getByText(/suggestions for your files/i)).toBeTruthy(),
      { timeout: 5000 },
    );
    expect(screen.getByText(/suggestions for your files/i).textContent).toMatch(
      /best match: merge pdf/i,
    );
  });

  it("a launch whose files cannot be stored says so, and goes nowhere", async () => {
    const broken: HandoffBackend = {
      put: () => Promise.reject(new Error("quota")),
      get: () => Promise.resolve(undefined),
      delete: () => Promise.resolve(),
      getAll: () => Promise.reject(new Error("quota")),
      clear: () => Promise.resolve(),
    };
    __setHandoffStoreForTests(new HandoffStore({ backend: broken }));
    const { container } = renderWorkspace();
    stage(container, [
      await pdfFile("a.pdf", textPdf([60])),
      await pdfFile("b.pdf", textPdf([60])),
    ]);
    fireEvent.click(await rowFor(/^open merge pdf with 2 files$/i));
    await waitFor(() =>
      expect(screen.getAllByRole("alert")[0]!.textContent).toMatch(
        /couldn.t carry your files to merge pdf/i,
      ),
    );
    expect(pushed).toEqual([]);
  });
});

describe("the workspace receives files", () => {
  it("claims a hand-off addressed to it, stages the files and says where they came from", async () => {
    const id = await stashHandoff(
      "workspace",
      [
        await pdfFile("a.pdf", textPdf([60])),
        new File(["notes"], "notes.txt", { type: "text/plain" }),
      ],
      { origin: { kind: "drop", surface: "home" } },
    );
    renderWorkspace(`?handoff=${id}`);
    const staged = await screen.findByRole("list", { name: /staged files/i });
    await waitFor(() => {
      expect(within(staged).getByText("a.pdf")).toBeTruthy();
      expect(within(staged).getByText("notes.txt")).toBeTruthy();
    });
    expect(screen.getByText(/loaded the 2 files you added/i)).toBeTruthy();
    expect(window.location.search).toBe("");
  });
});

describe("what the page says about keeping files", () => {
  it("no longer claims files clear the moment the tab closes, and states the hand-off lifetime", async () => {
    const { container } = renderWorkspace();
    await act(async () => {});
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/clear the moment you close/i);
    expect(text).toContain(HANDOFF_LIFETIME);
  });
});

// @vitest-environment jsdom
/**
 * The runner kit's half of "every ending is a fork", driven:
 *
 *  - a result goes BACK to its settings ("Back to adjust") with the run's
 *    trigger under the keyboard, or says it has none (`NO_ADJUST`);
 *  - an error with a known cause offers its fix, once — never two links to
 *    the same tool in one alert;
 *  - a run that counts its progress shows the count, as a progressbar,
 *    and speaks it by the quarter, not by the page;
 *  - the Run bar marks itself for the stylesheet and publishes its height;
 *  - unsaved edits are asked about before a link leaves the page, and the
 *    question goes away with the edits.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { LiveRegion, resetAnnouncer } from "@/components/a11y/live-region";
import { PdfEncryptedError, PdfEngineError } from "@/lib/pdf/engine";
import { UNLOCK_TOOL_HREF } from "@/lib/pdf/encryption";
import { causeOf } from "@/lib/pdf/remedies";
import { resetUnsavedForTests, unsavedLabels } from "@/lib/intent/unsaved";
import { getToolBySlug, tools } from "@/lib/tools";
import { continueTargetsFor } from "@/lib/intent/next-steps";
import { RunBar } from "./run-bar";
import {
  ErrorNote,
  NO_ADJUST,
  ResultPanel,
  RunButton,
  errorNoteLinksUnlock,
  outputFile,
} from "./runner-kit";
import { withAppRouter } from "@/tests/app-router";
import { ToolRunProvider } from "./tool-context";
import { useUnsavedGuard } from "./use-unsaved-guard";

afterEach(() => {
  cleanup();
  resetAnnouncer();
  resetUnsavedForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

/**
 * A tool page as a runner sees it: the job's context, and the App Router
 * (Continue with navigates with it). The router matters: a result draws its
 * ending as soon as the ending's chunk is in — at once, when another test in
 * the worker already loaded it (vitest `isolate: false`) — and an ending
 * with no router to navigate by is not a page that exists.
 */
function onToolPage(slug: string, ui: React.ReactNode) {
  const view = (inner: React.ReactNode) => {
    const tool = getToolBySlug(slug)!;
    return withAppRouter(
      <div data-tool-panel="">
        <ToolRunProvider
          tool={{ slug, name: tool.name, category: tool.category }}
          plan={continueTargetsFor(tool, tools)}
        >
          {inner}
        </ToolRunProvider>
      </div>,
    );
  };
  const rendered = render(view(ui));
  return {
    ...rendered,
    rerender: (inner: React.ReactNode) => rendered.rerender(view(inner)),
  };
}

/** A runner in the shape every one has: an editor, then its result. */
function Rotate({ adjust = true }: { adjust?: boolean }) {
  const [angle, setAngle] = useState(0);
  const [done, setDone] = useState(false);
  if (done)
    return (
      <ResultPanel
        title="PDF rotated"
        onReset={() => setDone(false)}
        output={outputFile(PDF, "rotated.pdf")}
        onAdjust={
          adjust ? () => setDone(false) : NO_ADJUST("nothing to set here")
        }
      >
        <button type="button">Download rotated PDF</button>
      </ResultPanel>
    );
  return (
    <div>
      <button type="button" onClick={() => setAngle((a) => a + 90)}>
        Right
      </button>
      <output>{angle}°</output>
      <RunBar>
        <RunButton onClick={() => setDone(true)}>Apply rotation</RunButton>
      </RunBar>
    </div>
  );
}

describe("Back to adjust", () => {
  it("returns to the settings as they were, with the Run trigger under the keyboard", async () => {
    onToolPage("rotate-pdf", <Rotate />);
    fireEvent.click(screen.getByRole("button", { name: "Right" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply rotation" }));
    const back = screen.getByRole("button", { name: "Back to adjust" });
    // One Tab from the outcome is still the download (merge-tool.spec).
    const panel = screen.getByRole("group", { name: "PDF rotated" });
    const buttons = within(panel).getAllByRole("button");
    expect(buttons[0]!.textContent).toBe("Download rotated PDF");
    expect(buttons[1]).toBe(back);
    await act(async () => {
      fireEvent.click(back);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(screen.getByText("90°")).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("Apply rotation");
  });

  it("is not offered where the result says there is nothing to adjust", () => {
    onToolPage("rotate-pdf", <Rotate adjust={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply rotation" }));
    expect(screen.queryByRole("button", { name: "Back to adjust" })).toBeNull();
    expect(screen.getByRole("button", { name: /start over/i })).toBeTruthy();
  });
});

describe("an error's remedy", () => {
  it("an encrypted file: ONE link to Unlock PDF, saying which password", () => {
    const err = new PdfEncryptedError("needs-password");
    onToolPage(
      "rotate-pdf",
      <ErrorNote message={err.message} cause={causeOf(err)} />,
    );
    const alert = screen.getByRole("alert");
    const links = within(alert).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      UNLOCK_TOOL_HREF,
    ]);
    expect(links[0]!.textContent).toBe("Open Unlock PDF");
    expect(alert.textContent).toMatch(/with the password that opens it\./);
    expect(alert.textContent).toMatch(
      /uploads to our secure server only when you start it/,
    );
    // The shared predicate gives the office-export panel the same answer.
    expect(errorNoteLinksUnlock(err.message)).toBe(true);
  });

  it("POSITIVE CONTROL: the same message with no cause still links Unlock PDF, once", () => {
    const err = new PdfEncryptedError("needs-password");
    onToolPage("rotate-pdf", <ErrorNote message={err.message} />);
    const links = within(screen.getByRole("alert")).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Open Unlock PDF"]);
  });

  it("an unreadable file: Repair PDF", () => {
    const err = new PdfEngineError("This file couldn't be read as a PDF.", {
      kind: "unreadable",
    });
    onToolPage(
      "rotate-pdf",
      <ErrorNote message={err.message} cause={causeOf(err)} />,
    );
    expect(
      within(screen.getByRole("alert")).getByRole("link", {
        name: "Try Repair PDF",
      }),
    ).toBeTruthy();
  });

  it("an error with no cause offers nothing", () => {
    onToolPage(
      "rotate-pdf",
      <ErrorNote message="Something went wrong." cause={{}} />,
    );
    expect(within(screen.getByRole("alert")).queryByRole("link")).toBeNull();
  });
});

describe("a run that counts its progress", () => {
  it("shows the count as a progressbar, and speaks it by the quarter", async () => {
    render(<LiveRegion />);
    const heard: string[] = [];
    const region = document.querySelector('[aria-live="polite"]')!;
    const observer = new MutationObserver(() => {
      if (region.textContent) heard.push(region.textContent);
    });
    observer.observe(region, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const view = (done: number) => (
      <RunButton
        onClick={() => {}}
        busy
        busyLabel="Converting pages…"
        progress={{ done, total: 8, unit: "pages" }}
      >
        Convert
      </RunButton>
    );
    const { rerender } = render(view(1));
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
    expect(bar.getAttribute("aria-valuetext")).toBe("1 of 8 pages");
    expect(bar.textContent).toContain("1 / 8 pages");
    // A page at a time, as a real run reports them — slower than the live
    // region's own settling (it clears, then speaks 50ms later).
    for (const done of [2, 3, 4, 5, 6, 7]) {
      rerender(view(done));
      await act(() => new Promise((r) => setTimeout(r, 80)));
    }
    observer.disconnect();
    expect(heard).toEqual([
      "25% — 2 of 8 pages",
      "50% — 4 of 8 pages",
      "75% — 6 of 8 pages",
    ]);
  });

  it("is drawn only while the run is busy", () => {
    render(
      <RunButton
        onClick={() => {}}
        progress={{ done: 3, total: 8, unit: "pages" }}
      >
        Convert
      </RunButton>,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

describe("the Run bar", () => {
  it("marks itself as the dock, and publishes its height for the scroll padding", () => {
    const observed: Element[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly cb: () => void) {}
        observe(el: Element) {
          observed.push(el);
          this.cb();
        }
        disconnect() {}
      },
    );
    const { unmount } = render(
      <RunBar>
        <RunButton onClick={() => {}}>Run</RunButton>
      </RunBar>,
    );
    const dock = document.querySelector("[data-run-dock]")!;
    expect(dock.contains(screen.getByRole("button", { name: "Run" }))).toBe(
      true,
    );
    expect(observed).toEqual([dock]);
    expect(
      document.documentElement.style.getPropertyValue("--sf-dock-h"),
    ).toMatch(/px$/);
    unmount();
    expect(document.documentElement.style.getPropertyValue("--sf-dock-h")).toBe(
      "",
    );
  });
});

/**
 * An editor with a link out. The link's own handler stands for the router
 * (Next's Link navigates from React's onClick): `followed` records that it
 * ran. It prevents jsdom's own navigation, so a guard's verdict is read from
 * whether the router was reached, never from `defaultPrevented`.
 */
const followed = vi.fn();
function Editor({ dirty }: { dirty: boolean }) {
  useUnsavedGuard(dirty, "your edits");
  return (
    // A plain anchor on purpose: the guard is the page's, for every link,
    // and Next's Link is one of them (its onClick stands in here).
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a
      href="/tools"
      onClick={(e) => {
        e.preventDefault();
        followed();
      }}
    >
      All tools
    </a>
  );
}

describe("unsaved edits", () => {
  it("are named with the page's tool, asked about before a link leaves, and kept on Stay", () => {
    const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
    onToolPage("edit-pdf", <Editor dirty />);
    expect(unsavedLabels()).toEqual(["your edits in Edit PDF"]);
    followed.mockClear();
    const link = screen.getByRole("link", { name: "All tools" });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(ask).toHaveBeenCalledWith(
      "You have unsaved changes: your edits in Edit PDF. Discard them?",
    );
    // "Stay": neither the router nor the browser moves.
    expect(followed).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    // Leaving any other way: the browser's own prompt.
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    // "Discard": the link goes where it goes — and a document unload it
    // starts is not asked about a second time by the browser.
    ask.mockReturnValue(true);
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(followed).toHaveBeenCalledTimes(1);
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("POSITIVE CONTROL: with nothing unsaved, nothing is asked and the link is followed", () => {
    const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
    followed.mockClear();
    onToolPage("edit-pdf", <Editor dirty={false} />);
    screen.getByRole("link", { name: "All tools" }).click();
    expect(ask).not.toHaveBeenCalled();
    expect(followed).toHaveBeenCalledTimes(1);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it("the question goes with the edits", () => {
    const { rerender } = onToolPage("edit-pdf", <Editor dirty />);
    expect(unsavedLabels()).toHaveLength(1);
    rerender(<Editor dirty={false} />);
    expect(unsavedLabels()).toEqual([]);
  });
});

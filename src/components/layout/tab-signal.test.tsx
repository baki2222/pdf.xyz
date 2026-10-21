// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportActivity, resetActivityForTests } from "@/lib/activity/bus";
import { TabSignal } from "./tab-signal";
import { TAB_SIGNAL_MIN_MS, startTabSignal } from "./tab-signal-engine";

/**
 * C.2 TabSignal: a run that ends while its tab is hidden says so in the tab —
 * its title and its icon — and only a run long enough that someone looked
 * away (3s). Visible again, both are put back exactly.
 */
let visibility: DocumentVisibilityState = "visible";
const ICON = "/icon.svg?abc";

beforeEach(() => {
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  document.head.innerHTML = `<link rel="icon" href="${ICON}" type="image/svg+xml" sizes="any">`;
  // After the head is replaced: its <title> went with it.
  document.title = "Merge PDF — pdf.xyz";
  document.documentElement.style.setProperty("--sf-accent", "rgb(7, 86, 122)");
});
let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
  cleanup();
  resetActivityForTests();
  vi.restoreAllMocks();
});

const icon = () =>
  document.head
    .querySelector<HTMLLinkElement>('link[type="image/svg+xml"]')!
    .getAttribute("href");

/** A run of `ms`, ended with `end`, while the tab is `during`. */
function run(ms: number, end: "done" | "failed", during = visibility) {
  const now = vi.spyOn(performance, "now");
  now.mockReturnValueOnce(1000).mockReturnValueOnce(1000 + ms);
  act(() => {
    reportActivity("busy");
    visibility = during;
    reportActivity(end);
  });
}

function show() {
  visibility = "visible";
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("TabSignal", () => {
  it("the component starts the signal: mounted, a hidden run's end is marked; unmounted, nothing is", async () => {
    const { unmount } = render(<TabSignal />);
    // The engine is fetched after mount; it is listening once a run's end
    // marks the title.
    await waitFor(() => {
      run(TAB_SIGNAL_MIN_MS, "done", "hidden");
      expect(document.title).toBe("Done · Merge PDF — pdf.xyz");
    });
    unmount();
    // Unmounting restores, and stops listening.
    expect(document.title).toBe("Merge PDF — pdf.xyz");
    run(TAB_SIGNAL_MIN_MS, "done", "hidden");
    expect(document.title).toBe("Merge PDF — pdf.xyz");
  });

  it("a long run that finishes in a hidden tab marks its title and icon, and visible restores both", () => {
    stop = startTabSignal();
    run(TAB_SIGNAL_MIN_MS + 500, "done", "hidden");
    expect(document.title).toBe("Done · Merge PDF — pdf.xyz");
    expect(icon()).toMatch(/^data:image\/svg\+xml,/);
    // The colour is the page's own accent, read at run time.
    expect(decodeURIComponent(icon()!)).toContain("rgb(7, 86, 122)");
    show();
    expect(document.title).toBe("Merge PDF — pdf.xyz");
    expect(icon()).toBe(ICON);
  });

  it("a failure says it needs attention", () => {
    stop = startTabSignal();
    run(TAB_SIGNAL_MIN_MS, "failed", "hidden");
    expect(document.title).toBe("Needs attention · Merge PDF — pdf.xyz");
  });

  it("a short run, or one that ends in view, changes nothing", () => {
    stop = startTabSignal();
    run(TAB_SIGNAL_MIN_MS - 1, "done", "hidden");
    expect(document.title).toBe("Merge PDF — pdf.xyz");
    expect(icon()).toBe(ICON);
    show();
    run(TAB_SIGNAL_MIN_MS + 5000, "done", "visible");
    expect(document.title).toBe("Merge PDF — pdf.xyz");
  });

  it("two finished runs before the reader comes back prefix the title once", () => {
    stop = startTabSignal();
    run(TAB_SIGNAL_MIN_MS, "failed", "hidden");
    run(TAB_SIGNAL_MIN_MS, "done", "hidden");
    expect(document.title).toBe("Done · Merge PDF — pdf.xyz");
    show();
    expect(document.title).toBe("Merge PDF — pdf.xyz");
  });
});

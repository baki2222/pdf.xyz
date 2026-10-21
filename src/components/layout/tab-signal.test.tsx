// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportActivity, resetActivityForTests } from "@/lib/activity/bus";
import { TAB_SIGNAL_MIN_MS, TabSignal } from "./tab-signal";

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
  document.title = "Merge PDF — pdf.xyz";
  document.head.innerHTML = `<link rel="icon" href="${ICON}" type="image/svg+xml" sizes="any">`;
  document.documentElement.style.setProperty("--sf-accent", "rgb(7, 86, 122)");
});
afterEach(() => {
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
  it("a long run that finishes in a hidden tab marks its title and icon, and visible restores both", () => {
    render(<TabSignal />);
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
    render(<TabSignal />);
    run(TAB_SIGNAL_MIN_MS, "failed", "hidden");
    expect(document.title).toBe("Needs attention · Merge PDF — pdf.xyz");
  });

  it("a short run, or one that ends in view, changes nothing", () => {
    render(<TabSignal />);
    run(TAB_SIGNAL_MIN_MS - 1, "done", "hidden");
    expect(document.title).toBe("Merge PDF — pdf.xyz");
    expect(icon()).toBe(ICON);
    show();
    run(TAB_SIGNAL_MIN_MS + 5000, "done", "visible");
    expect(document.title).toBe("Merge PDF — pdf.xyz");
  });

  it("two finished runs before the reader comes back prefix the title once", () => {
    render(<TabSignal />);
    run(TAB_SIGNAL_MIN_MS, "failed", "hidden");
    run(TAB_SIGNAL_MIN_MS, "done", "hidden");
    expect(document.title).toBe("Done · Merge PDF — pdf.xyz");
    show();
    expect(document.title).toBe("Merge PDF — pdf.xyz");
  });
});

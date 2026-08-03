// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { LiveRegion, announceOutcome, resetAnnouncer } from "./live-region";

/**
 * These tests are written to reject the specific broken implementation this
 * component replaces, not merely to confirm that some element ends up holding
 * some text.
 *
 * The region that already existed in `runner-kit.tsx` renders correctly and
 * announces nothing, because the runner mounts it inside the editor branch and
 * the completed run returns above it. Querying for a live region AFTER
 * announcing would pass against that implementation: a region that arrives with
 * its text already inside it looks identical in the DOM to one that was updated,
 * and only the second is spoken. So every assertion here captures the node
 * BEFORE the announcement and asserts on that same node.
 */

afterEach(() => {
  cleanup();
  resetAnnouncer();
  vi.useRealTimers();
});

describe("LiveRegion", () => {
  it("mounts empty, so its later text is a change rather than an arrival", () => {
    render(<LiveRegion />);
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("");
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("delivers into the node that was already on the page", async () => {
    render(<LiveRegion />);
    const region = screen.getByRole("status"); // captured BEFORE announcing

    announceOutcome("PDFs merged.");

    await waitFor(() => expect(region).toHaveTextContent("PDFs merged."));
  });

  it("speaks the same message twice", async () => {
    // Rotate → Start over → rotate produces the identical sentence. An unchanged
    // text node is not a mutation, so without the clear-then-set the user hears
    // the first run and silence after it. This is the assertion that catches it.
    render(<LiveRegion />);
    const region = screen.getByRole("status");

    announceOutcome("PDF rotated.");
    await waitFor(() => expect(region).toHaveTextContent("PDF rotated."));

    announceOutcome("PDF rotated.");
    await waitFor(() => expect(region).toHaveTextContent(""));
    await waitFor(() => expect(region).toHaveTextContent("PDF rotated."));
  });

  it("drops announcements when nothing is mounted instead of throwing", () => {
    // Server render, or a component unit-tested in isolation. The outcome is
    // always on screen too, so a dropped announcement is a missed courtesy, not
    // a missed result — and it must never break the tool.
    expect(() => announceOutcome("nobody is listening")).not.toThrow();
  });

  it("stops listening once unmounted", async () => {
    const { unmount } = render(<LiveRegion />);
    const region = screen.getByRole("status");
    unmount();

    announceOutcome("after unmount");
    // The detached node must not be written to — a leak here would mean a stale
    // region from a previous test file receiving this message, which `isolate:
    // false` makes a real possibility rather than a theoretical one.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(region).toHaveTextContent("");
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { LiveRegion, resetAnnouncer } from "@/components/a11y/live-region";
import { ErrorNote, ResultCard, ResultPanel, RunButton } from "./runner-kit";

/**
 * What a completed run owes a user who cannot see it.
 *
 * A failure has always been announced (`ErrorNote` carries `role="alert"`).
 * Success was announced nowhere and focus was moved nowhere — so the flow the
 * product exists for ended in silence. These assertions fail on the code that
 * shipped before them:
 *   - `getByRole("group", { name: … })` THROWS, because `ResultPanel` was a bare
 *     `<div>` with no role and no accessible name. It cannot be satisfied by
 *     sprinkling `aria-live` on that div; the name has to be real.
 *   - `toHaveFocus()` fails, because `.focus(` appeared zero times in the repo.
 *
 * `MiniRunner` reproduces the structure that actually breaks this — the
 * `if (result) return <ResultPanel>` early return every runner uses — rather
 * than mounting the panel directly, which would test a shape that never occurs.
 */

afterEach(() => {
  cleanup();
  resetAnnouncer();
});

function MiniRunner({ announcement }: { announcement?: string } = {}) {
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <ResultPanel
        title="PDFs merged"
        summary="3 files combined into one PDF · 12 pages"
        announcement={announcement}
        onReset={() => setDone(false)}
      >
        <button type="button">Download merged PDF</button>
      </ResultPanel>
    );
  }
  return (
    <button type="button" onClick={() => setDone(true)}>
      Merge PDFs
    </button>
  );
}

describe("a completed run", () => {
  it("takes focus and carries the outcome as its accessible name", async () => {
    render(<MiniRunner />);
    // Focus is on <body> here, which is the real state for a runner that swaps
    // its whole form out for the result: the element the user activated has been
    // unmounted, so there is nothing to return focus to.
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByRole("button", { name: "Merge PDFs" }));

    const panel = await screen.findByRole("group", {
      name: /PDFs merged.*12 pages/s,
    });
    await waitFor(() => expect(panel).toHaveFocus());
  });

  it("is not itself a live region, so nothing is read twice", async () => {
    render(<MiniRunner />);
    fireEvent.click(screen.getByRole("button", { name: "Merge PDFs" }));

    const panel = await screen.findByRole("group", { name: /PDFs merged/ });
    // Focus move and live region are mutually exclusive by design: with both,
    // some screen readers announce the outcome twice and no test would notice.
    expect(panel).not.toHaveAttribute("aria-live");
    expect(panel).not.toHaveAttribute("role", "status");
  });

  it("announces instead of stealing focus when the user has moved on", async () => {
    render(
      <>
        <LiveRegion />
        <input aria-label="Somewhere else" />
        <MiniRunner />
      </>,
    );
    const region = screen.getByRole("status");
    const elsewhere = screen.getByLabelText("Somewhere else");

    // Focus must already be somewhere real when the outcome appears — that is
    // the situation being tested. Moving it afterwards would test nothing,
    // because the decision has been made by then.
    elsewhere.focus();
    fireEvent.click(screen.getByRole("button", { name: "Merge PDFs" }));

    await waitFor(() => expect(region).toHaveTextContent("PDFs merged"));
    // Yanking focus away from someone mid-task is its own failure, not a fix.
    expect(elsewhere).toHaveFocus();
  });

  it("uses the announcement override when the title alone is thin", async () => {
    render(
      <>
        <LiveRegion />
        <input aria-label="Somewhere else" />
        <MiniRunner announcement="Merged 3 PDFs into one file." />
      </>,
    );
    const region = screen.getByRole("status");
    screen.getByLabelText("Somewhere else").focus();
    fireEvent.click(screen.getByRole("button", { name: "Merge PDFs" }));

    await waitFor(() =>
      expect(region).toHaveTextContent("Merged 3 PDFs into one file."),
    );
  });

  it("does not re-take focus on a re-render of the same outcome", async () => {
    // `pdf-to-image` keeps its result panel mounted while a `zipping` flag
    // toggles. Without the `handled` guard the panel would grab focus back out
    // of whatever the user had just tabbed to, on every unrelated state change.
    const { rerender } = render(<MiniRunner />);
    fireEvent.click(screen.getByRole("button", { name: "Merge PDFs" }));
    await screen.findByRole("group", { name: /PDFs merged/ });

    const download = screen.getByRole("button", { name: "Download merged PDF" });
    download.focus();
    rerender(<MiniRunner />);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(download).toHaveFocus();
  });

  it("announces again on a second run of the same tool", async () => {
    render(
      <>
        <LiveRegion />
        <input aria-label="Somewhere else" />
        <MiniRunner />
      </>,
    );
    const region = screen.getByRole("status");
    const elsewhere = screen.getByLabelText("Somewhere else");

    elsewhere.focus();
    fireEvent.click(screen.getByRole("button", { name: "Merge PDFs" }));
    await waitFor(() => expect(region).toHaveTextContent("PDFs merged"));

    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    elsewhere.focus();
    fireEvent.click(screen.getByRole("button", { name: "Merge PDFs" }));

    await waitFor(() => expect(region).toHaveTextContent(""));
    await waitFor(() => expect(region).toHaveTextContent("PDFs merged"));
  });
});

/**
 * The trigger itself, which used to be the first thing a run destroyed.
 *
 * `disabled={busy}` meant the browser blurred the button at t=0 — the user
 * pressed Enter and landed on `<body>` for the duration of the work. That is why
 * the suite above could open by asserting focus was on `<body>` and call it "the
 * real state": it was, on every tool, for every run.
 *
 * WHAT EACH ASSERTION IS WORTH, MEASURED
 * Run against the old component, exactly two of these fail:
 *   - `not.toBeDisabled()` — jest-dom reads the native attribute and ignores
 *     `aria-disabled`, so no amount of ARIA satisfies it. Load-bearing.
 *   - `.focus()` on a not-yet-ready button — jsdom refuses to focus a natively
 *     disabled control, so `toHaveFocus()` fails there. Load-bearing.
 * The `toHaveFocus()` inside the in-flight case does NOT discriminate: jsdom
 * does not blur an element when it becomes disabled, so that line was green on
 * the broken component. It stays as documentation of the intent, and the real
 * browser carries the proof — `e2e/rotate-tool.spec.ts` focuses a blocked run
 * trigger in Chromium and asserts it is still focused. Both states go through
 * the same `blocked` branch, so that proof and the unit tests above together
 * cover the mid-run case that cannot be caught deterministically end to end.
 */
describe("RunButton", () => {
  function BusyRunner({ onRun }: { onRun?: () => void } = {}) {
    const [busy, setBusy] = useState(false);
    return (
      <RunButton
        busy={busy}
        busyLabel="Merging…"
        onClick={() => {
          setBusy(true);
          onRun?.();
        }}
      >
        Merge PDFs
      </RunButton>
    );
  }

  it("still holds the keyboard once the run it started is in flight", () => {
    render(<BusyRunner />);
    const button = screen.getByRole("button", { name: "Merge PDFs" });
    button.focus();
    expect(button).toHaveFocus();

    fireEvent.click(button);

    // Same node, now mid-run: unavailable to activate, but not taken away.
    expect(button).toHaveFocus();
    expect(button).toHaveAccessibleName("Merging…");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
  });

  it("ignores an impatient second press instead of running twice", () => {
    const onRun = vi.fn();
    render(<BusyRunner onRun={onRun} />);
    const button = screen.getByRole("button", { name: "Merge PDFs" });

    fireEvent.click(button);
    expect(onRun).toHaveBeenCalledTimes(1);

    // In a real browser nothing swallows this one any more — the element is no
    // longer natively disabled, so only the guard stops it. (jsdom dispatches
    // clicks at disabled elements anyway, so this passed before the change too;
    // it exists to catch the guard being dropped, not to prove it was added.)
    fireEvent.click(button);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("stays reachable while it is not yet ready to run", () => {
    const onRun = vi.fn();
    render(
      <RunButton onClick={onRun} disabled>
        Apply rotation
      </RunButton>,
    );
    const button = screen.getByRole("button", { name: "Apply rotation" });

    // Rotating a page back to 0° flips this state under a keyboard user. If the
    // control left the tab order they would be dropped again, mid-edit.
    button.focus();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(button);
    expect(onRun).not.toHaveBeenCalled();
  });

  it("says nothing about availability when it is ready", () => {
    const onRun = vi.fn();
    render(<RunButton onClick={onRun}>Merge PDFs</RunButton>);
    const button = screen.getByRole("button", { name: "Merge PDFs" });

    // `aria-disabled="false"` is not a neutral value to leave lying around: it
    // is what a stale guard would read as "present, therefore blocked".
    expect(button).not.toHaveAttribute("aria-disabled");
    fireEvent.click(button);
    expect(onRun).toHaveBeenCalledTimes(1);
  });
});

describe("ResultCard", () => {
  it("names itself with the sentence it would speak", async () => {
    render(<ResultCard announce="Your PDF/A file is ready.">body</ResultCard>);
    const card = await screen.findByRole("group", {
      name: "Your PDF/A file is ready.",
    });
    await waitFor(() => expect(card).toHaveFocus());
  });
});

describe("a failed run", () => {
  it("is still an alert", () => {
    // Passes today. It is here so the sibling that already worked cannot quietly
    // regress while attention is on the success path.
    render(<ErrorNote message="The worker could not read this PDF." />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The worker could not read this PDF.",
    );
  });
});

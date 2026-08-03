// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { LiveRegion, resetAnnouncer } from "@/components/a11y/live-region";
import { ErrorNote, ResultCard, ResultPanel } from "./runner-kit";

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
    // Focus is on <body> here, which is exactly the real state: `RunButton` sets
    // `disabled` when work starts, and a disabled element cannot hold focus.
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

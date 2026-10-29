// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { UploadCloud } from "lucide-react";
import { LiveRegion, resetAnnouncer } from "@/components/a11y/live-region";
import { buttonVariants } from "@/components/ui/button";
import {
  ChipButton,
  ErrorNote,
  NO_ADJUST,
  ResultCard,
  ResultPanel,
  RunButton,
  WorkerRunButton,
  outputFile,
} from "./runner-kit";

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

const MERGED = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

function MiniRunner({ announcement }: { announcement?: string } = {}) {
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <ResultPanel
        title="PDFs merged"
        summary="3 files combined into one PDF · 12 pages"
        announcement={announcement}
        onReset={() => setDone(false)}
        output={outputFile(MERGED, "merged.pdf")}
        onAdjust={NO_ADJUST("a fixture with no settings")}
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

    const download = screen.getByRole("button", {
      name: "Download merged PDF",
    });
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

/**
 * The worker panels' trigger, which the `RunButton` fix above did not reach.
 *
 * #46 fixed one component and the site still had the bug fourteen times, because
 * every worker panel had pasted its own copy of the markup. `WorkerRunButton` is
 * that copy, extracted once; these assertions are the `RunButton` ones that
 * measurably discriminate — `not.toBeDisabled()` and focusing a not-yet-ready
 * control — re-applied to it. The stakes are higher here: a worker job runs for
 * seconds to minutes, not milliseconds.
 *
 * The panels themselves are guarded by source scan, in
 * `src/components/tools/run-trigger-focus.test.ts` — a component nobody uses
 * fixes nothing.
 */
describe("WorkerRunButton", () => {
  function Panel({ onRun }: { onRun?: () => void } = {}) {
    const [busy, setBusy] = useState(false);
    return (
      <WorkerRunButton
        busy={busy}
        busyLabel="Recognizing on the worker…"
        icon={UploadCloud}
        onClick={() => {
          setBusy(true);
          onRun?.();
        }}
      >
        Run OCR on the worker
      </WorkerRunButton>
    );
  }

  it("keeps the keyboard for the whole worker job it started", () => {
    render(<Panel />);
    const button = screen.getByRole("button", {
      name: "Run OCR on the worker",
    });
    button.focus();

    fireEvent.click(button);

    expect(button).toHaveAccessibleName("Recognizing on the worker…");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    // The load-bearing one: jest-dom reads the native attribute and ignores
    // `aria-disabled`, so this is what fails on every pre-fix panel.
    expect(button).not.toBeDisabled();
  });

  it("stays reachable before a file has been chosen", () => {
    const onRun = vi.fn();
    render(
      <WorkerRunButton
        onClick={onRun}
        disabled
        busyLabel="…"
        icon={UploadCloud}
      >
        Extract tables
      </WorkerRunButton>,
    );
    const button = screen.getByRole("button", { name: "Extract tables" });

    // Removing then re-adding the file flips this under a keyboard user.
    button.focus();
    expect(button).toHaveFocus();

    fireEvent.click(button);
    expect(onRun).not.toHaveBeenCalled();
  });

  it("ignores an impatient second press instead of queueing a second job", () => {
    const onRun = vi.fn();
    render(<Panel onRun={onRun} />);
    const button = screen.getByRole("button", {
      name: "Run OCR on the worker",
    });

    fireEvent.click(button);
    fireEvent.click(button);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("says nothing about availability when it is ready", () => {
    const onRun = vi.fn();
    render(
      <WorkerRunButton onClick={onRun} busyLabel="…" icon={UploadCloud}>
        Translate PDF
      </WorkerRunButton>,
    );
    const button = screen.getByRole("button", { name: "Translate PDF" });

    expect(button).not.toHaveAttribute("aria-disabled");
    fireEvent.click(button);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("dims itself while blocked, since it no longer looks disabled to the browser", () => {
    render(
      <WorkerRunButton
        onClick={vi.fn()}
        disabled
        busyLabel="…"
        icon={UploadCloud}
      >
        Summarize PDF
      </WorkerRunButton>,
    );
    // A control that keeps its place in the focus order must still LOOK
    // unavailable; `disabled:opacity-*` stops applying the moment the native
    // attribute goes away, and nothing else would notice. And it looks
    // unavailable the way every other button does: the dimming is read from
    // `buttonVariants()`, whose opacity `design-tokens.test.ts` holds to AA,
    // so the two cannot drift apart (both said 60, held only by a copy).
    const dim = /(?:^|\s)(aria-disabled:opacity-\d+)(?=\s|$)/.exec(
      buttonVariants(),
    )?.[1];
    expect(
      dim,
      "buttonVariants() carries no aria-disabled dimming",
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Summarize PDF" })
        .className.split(/\s+/),
    ).toContain(dim);
  });
});

describe("ResultCard", () => {
  it("names itself with the sentence it would speak", async () => {
    render(
      <ResultCard
        announce="Your PDF/A file is ready."
        output={outputFile(new Uint8Array([0x25]), "a.pdf")}
      >
        body
      </ResultCard>,
    );
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

describe("ChipButton — the controls beside the trigger", () => {
  /**
   * #46 fixed the trigger; these chips carried the same defect: option and
   * history controls that flip to `disabled` exactly when the user is
   * interacting nearby (a quality chip the moment a run starts, undo the
   * moment history empties). The discriminators are the two jsdom CAN model
   * (measured in #46): jest-dom's `toBeDisabled` reads the native attribute,
   * and jsdom refuses to focus a natively disabled element.
   */
  it("stays in the focus order while unavailable", () => {
    render(
      <ChipButton onClick={() => {}} disabled title="150 DPI">
        Balanced
      </ChipButton>,
    );
    const chip = screen.getByRole("button", { name: "Balanced" });
    expect(chip).not.toBeDisabled();
    expect(chip).toHaveAttribute("aria-disabled", "true");
    chip.focus();
    expect(chip).toHaveFocus();
  });

  it("refuses the click instead of removing itself", () => {
    const clicks = vi.fn();
    render(
      <ChipButton onClick={clicks} disabled>
        Balanced
      </ChipButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Balanced" }));
    expect(clicks).not.toHaveBeenCalled();
  });

  it("still works — and looks available — when enabled", () => {
    const clicks = vi.fn();
    render(
      <ChipButton onClick={clicks} active>
        Balanced
      </ChipButton>,
    );
    const chip = screen.getByRole("button", { name: "Balanced" });
    expect(chip).not.toHaveAttribute("aria-disabled");
    fireEvent.click(chip);
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps looking unavailable without the native attribute", () => {
    // `disabled:opacity-40` stops applying the moment the native attribute goes
    // away, and nothing else would notice — the same trap RunButton documented.
    render(
      <ChipButton onClick={() => {}} disabled>
        Balanced
      </ChipButton>,
    );
    expect(
      screen.getByRole("button", { name: "Balanced" }).className,
    ).toContain("aria-disabled:opacity-40");
  });
});

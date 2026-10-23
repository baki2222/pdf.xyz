// @vitest-environment jsdom
/**
 * The docket stamps only what the browser OBSERVED (spec D.7, E.10): a stage
 * a later stage proves is behind the job reads "passed" with no time, the
 * running stage is `aria-current="step"`, and Auto-delete is always
 * "scheduled" — never a tick, because nothing here sees it happen.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { workerPipelineStages } from "@/lib/jobs/capabilities";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { getToolBySlug } from "@/lib/tools";
import type { PhaseEvent } from "@/lib/workers/phases";
import { LiveStages, formatElapsed, stageRows } from "./live-stages";

const STAGES = workerPipelineStages(true, getToolBySlug("protect-pdf")!);
const ids = (events: PhaseEvent[]) =>
  stageRows(STAGES, events).map((r) => `${r.stage.id}:${r.state}`);

describe("stageRows", () => {
  it("health: five stages, scan first-class", () => {
    expect(STAGES.map((s) => s.id)).toEqual([
      "upload",
      "scan",
      "process",
      "download",
      "delete",
    ]);
  });

  it("before a run every stage waits, and delete is scheduled", () => {
    expect(ids([])).toEqual([
      "upload:pending",
      "scan:pending",
      "process:pending",
      "download:pending",
      "delete:scheduled",
    ]);
  });

  it("a scan the polling never saw reads passed once processing is seen", () => {
    expect(
      ids([
        { phase: "uploading", at: 0 },
        { phase: "uploaded", at: 400 },
        { phase: "queued", at: 450 },
        { phase: "processing", at: 900 },
      ]),
    ).toEqual([
      "upload:done",
      "scan:passed",
      "process:current",
      "download:pending",
      "delete:scheduled",
    ]);
  });

  it("times each observed stage from its first phase to the next one", () => {
    const rows = stageRows(STAGES, [
      { phase: "uploading", at: 0 },
      { phase: "uploaded", at: 1900 },
      { phase: "scanning", at: 2000 },
      { phase: "processing", at: 2800 },
      { phase: "downloading", at: 5000 },
      { phase: "done", at: 5300 },
    ]);
    expect(rows.map((r) => r.ms)).toEqual([2000, 800, 2200, 300, null]);
    expect(rows.at(-1)!.state).toBe("scheduled");
  });

  it("a failure marks the stage it stopped in, and never what came after", () => {
    expect(
      ids([
        { phase: "uploading", at: 0 },
        { phase: "processing", at: 10 },
        { phase: "failed", at: 20 },
      ]),
    ).toEqual([
      "upload:done",
      "scan:passed",
      "process:failed",
      "download:pending",
      "delete:scheduled",
    ]);
  });

  it("formats elapsed time as m:ss.s", () => {
    expect(formatElapsed(1900)).toBe("0:01.9");
    expect(formatElapsed(61_000)).toBe("1:01.0");
  });
});

describe("<LiveStages>", () => {
  it("marks the running stage as the current step, and says delete is scheduled", () => {
    render(
      <LiveStages
        stages={STAGES}
        events={[
          { phase: "uploading", at: 0 },
          { phase: "processing", at: 100 },
        ]}
      />,
    );
    const list = screen.getByRole("list");
    const current = within(list)
      .getAllByRole("listitem")
      .filter((li) => li.getAttribute("aria-current") === "step");
    expect(current.map((li) => li.textContent)).toEqual([
      expect.stringContaining(STAGES[2]!.title),
    ]);
    expect(list.textContent).toContain(
      `scheduled · outputs expire after ${DEFAULT_RETENTION.outputTtlMinutes} minutes`,
    );
    expect(list.textContent).toContain("passed");
  });

  it("keeps every stage's description on the page", () => {
    const { container } = render(<LiveStages stages={STAGES} events={[]} />);
    for (const stage of STAGES)
      expect(container.textContent).toContain(stage.description);
  });
  /*
   * Before a job there is nothing to stamp, and a list of five unticked
   * rows read as a form to fill in (owner, 2026-10-23: "a stage list shows
   * before anything has happened"). So before the first phase the docket
   * is not drawn: one press shows what will happen, every stage's title
   * and description in the markup either way. The docket appears with the
   * job's first phase.
   */
  it("before a job: no docket on screen, one press shows each stage, every word still in the markup", () => {
    const { container } = render(<LiveStages stages={STAGES} events={[]} />);
    expect(container.querySelector("[data-docket]")).toBeNull();
    const toggle = screen.getByRole("button", {
      name: "What happens to your file",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const region = container.querySelector(
      `#${CSS.escape(toggle.getAttribute("aria-controls")!)}`,
    ) as HTMLElement;
    expect(region.hidden).toBe(true);
    for (const stage of STAGES) {
      expect(region.textContent).toContain(stage.title);
      expect(region.textContent).toContain(stage.description);
    }
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(region.hidden).toBe(false);
  });

  it("the docket appears with the job's first phase", () => {
    const { container, rerender } = render(
      <LiveStages stages={STAGES} events={[]} />,
    );
    expect(container.querySelector("[data-docket]")).toBeNull();
    rerender(
      <LiveStages stages={STAGES} events={[{ phase: "uploading", at: 0 }]} />,
    );
    expect(container.querySelector("[data-docket]")).not.toBeNull();
    expect(container.querySelectorAll("[data-docket] li").length).toBe(
      STAGES.length,
    );
  });
});

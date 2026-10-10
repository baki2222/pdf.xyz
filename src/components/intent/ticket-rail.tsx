"use client";

import { Check } from "lucide-react";
import { useToolRun } from "@/components/tools/runner/tool-context";
import { getToolBySlug } from "@/lib/tools";

/**
 * The job's steps, on a row of their own under the panel's privacy line once
 * the files arrived from another tool's result: "Job · Merge PDF ✓ — Compress
 * PDF". Each step the files went through is ticked; this one is the current
 * step, and ticked too once its result is on screen.
 *
 * A SLOT THAT CANNOT MOVE THE RUNNER. The row (24 px, full width, so it is
 * its own line at every width) is held open from the commit that draws the
 * runner's "Bringing your files over…" (`useBringingFiles`) — before the
 * hand-off is read, so before anyone knows whether it carries a job — and the
 * steps are drawn INTO it when the claim reports them. It closes, if the
 * files came with no job (the home page's desk, the workspace), in the frame
 * the block gives way to the editor. So the row's every change lands in a
 * frame where the runner itself changes, and never alone.
 *
 * WAS: drawn when the claim reported its trail, beside the privacy line in a
 * `flex-wrap` row. On a phone the privacy sentence takes two lines, so the
 * steps wrapped to a third and pushed the runner down 32 px — measured at
 * 50b2a243, 390 px, Merge → Continue with Add Page Numbers: a layout shift of
 * its own, 234 ms BEFORE the editor's, because a single-PDF runner reads the
 * file before it draws the editor (WP-08 review, 2026-10-10). This comment
 * said the opposite then; `e2e/continue-chain.mobile.spec.ts` now measures it
 * frame by frame, and fails with the hold removed.
 *
 * A visit that did not arrive by hand-off never holds the row.
 *
 * Heard as a list of steps with the current one marked (`aria-current=
 * "step"`); a tick is drawn, and said as "done".
 */
export function TicketRail() {
  const run = useToolRun();
  if (!run || (run.trail.length === 0 && !run.bringing)) return null;
  const steps =
    run.trail.length === 0
      ? []
      : [
          ...run.trail.map((slug) => ({
            slug,
            name: getToolBySlug(slug)?.name ?? slug,
            current: false,
            done: true,
          })),
          { slug: run.slug, name: run.name, current: true, done: run.done },
        ];
  return (
    <div
      data-ticket-rail-slot=""
      className="flex h-6 w-full min-w-0 items-center"
    >
      {steps.length > 0 && (
        <nav
          aria-label="Job steps"
          data-ticket-rail=""
          data-motion-ui=""
          className="flex h-6 max-w-full min-w-0 [scrollbar-width:none] items-center gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden"
        >
          <span aria-hidden className="kicker text-faint shrink-0">
            Job
          </span>
          <ol className="flex items-center font-mono text-xs whitespace-nowrap">
            {steps.map((step, i) => (
              <li
                key={step.slug}
                aria-current={step.current ? "step" : undefined}
                className="flex items-center"
              >
                {i > 0 && (
                  <span
                    aria-hidden
                    className="bg-line mx-1.5 h-px w-3 shrink-0"
                  />
                )}
                <span
                  className={
                    step.current
                      ? "border-line-strong text-fg rounded-tag inline-flex items-center gap-1 border px-1.5 py-px"
                      : "text-muted inline-flex items-center gap-1"
                  }
                >
                  {step.name}
                  {step.done && (
                    <>
                      <Check className="text-ok size-3 shrink-0" aria-hidden />
                      <span className="sr-only"> (done)</span>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </nav>
      )}
    </div>
  );
}

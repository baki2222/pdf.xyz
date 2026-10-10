"use client";

import { Check } from "lucide-react";
import { useToolRun } from "@/components/tools/runner/tool-context";
import { getToolBySlug } from "@/lib/tools";

/**
 * The job's steps, drawn beside the panel's privacy line once the files
 * arrived from another tool's result: "Job · Merge PDF ✓ — Compress PDF".
 * Each step the files went through is ticked; this one is the current
 * step, and ticked too once its result is on screen.
 *
 * Nothing renders until there is a trail — a visit that did not continue
 * from a result has no job to show — so a plain page never reserves a row.
 * When it appears, it appears with the files (the same commit that swaps
 * the runner's "Bringing your files over…" for the editor), on one line
 * that scrolls sideways rather than wraps.
 *
 * Heard as a list of steps with the current one marked (`aria-current=
 * "step"`); a tick is drawn, and said as "done".
 */
export function TicketRail() {
  const run = useToolRun();
  if (!run || run.trail.length === 0) return null;
  const steps = [
    ...run.trail.map((slug) => ({
      slug,
      name: getToolBySlug(slug)?.name ?? slug,
      current: false,
      done: true,
    })),
    { slug: run.slug, name: run.name, current: true, done: run.done },
  ];
  return (
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
              <span aria-hidden className="bg-line mx-1.5 h-px w-3 shrink-0" />
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
  );
}

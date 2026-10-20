"use client";

import { useLayoutEffect, useState } from "react";
import { Check } from "lucide-react";
import { useToolRun } from "@/components/tools/runner/tool-context";
import { peekCarriedHandoff } from "@/lib/handoff/carry-key";
import { getToolBySlug } from "@/lib/tools";

/**
 * The job's steps, on a row of their own under the panel's privacy line once
 * the files arrived from another tool's result: "Job · Merge PDF ✓ — Compress
 * PDF". Each step the files went through is ticked; this one is the current
 * step, and ticked too once its result is on screen.
 *
 * THE ROW IS THERE FROM THE ARRIVING PAGE'S FIRST FRAME, AND STAYS. A page
 * reached by a hand-off finds its token carried to its path in this tab's
 * sessionStorage (`@/lib/handoff/carry-key`; until 2026-10-20 the token
 * rode in the address, `?handoff=`, which is still read). The launch
 * writes it before navigating, and the runner takes it in a PASSIVE
 * effect — after this commit's layout effects — so the row reads it in a
 * LAYOUT effect, whose update React applies before the browser paints,
 * and the row (24 px, full width, its
 * own line at every width) is in the arriving page's first painted frame,
 * before anyone knows whether the files carry a job. It is never closed
 * within the visit: the steps are drawn INTO it when the claim reports them, and a
 * hand-off with no job (a guide's desk, the home page's, the workspace)
 * leaves it empty. So the runner's stage starts where it stays.
 * `e2e/handoff-arrival.spec.ts` (and `.mobile`) read it as a visit pays
 * for it: counted layout shifts on a slowed line and on a guide drop, and
 * the stage at one position in every frame of the arriving page.
 *
 * WAS, twice. (1) Drawn when the claim reported its trail, beside the
 * privacy line in a `flex-wrap` row: on a phone the steps wrapped to a
 * third line and pushed the runner down 32 px, 234 ms before the editor
 * (WP-08 review, 2026-10-10). (2) Held from the commit that drew "Bringing
 * your files over…" (`useBringingFiles`) and closed, with no job, as the
 * editor came — "never alone", this comment said, because the runner
 * changed in the same frames. A layout shift is the runner's START moving,
 * whatever else changes with it: 401 -> 433 px at 1280, 408 -> 440 at 390,
 * and back, counted 0.0183-0.0303 on a guide drop and 0.0091-0.0148 on a
 * Continue hop with 400 ms of latency (PR #180 review, c7abb986). The
 * test that pinned (2) is inverted in `e2e/continue-chain.mobile.spec.ts`.
 *
 * Not covered: a FULL load of a page a token was carried to (or of a
 * `?handoff=` address), where the server's HTML (prerendered, so without
 * the row) paints before the page hydrates.
 * Every hand-off here navigates in-app (`launchWithFiles`). Not
 * `useSearchParams`: in a prerendered page it bails its boundary out of the
 * server render (`src/deploy/own-panel-first-load.test.ts`).
 *
 * A visit that did not arrive by hand-off never holds the row.
 *
 * Heard as a list of steps with the current one marked (`aria-current=
 * "step"`); a tick is drawn, and said as "done".
 */
/**
 * The address says a hand-off brought this visit: `readHandoffId`'s rule
 * (`@/lib/handoff/url`, a `handoff` parameter holding an `h_` token), read
 * here without that module — imported, it and the id module behind it rode
 * every tool page's first load (+0.4 KB gz, where the budget had none left:
 * PR #180 re-review). `result-ending.test.tsx` holds the two to one answer.
 */
export const arrivedByHandoff = (search: string): boolean =>
  /[?&]handoff=h_[^&]/.test(search);

/**
 * A token is carried to `pathname`: `takeCarriedHandoff`'s rule (an `h_`
 * token addressed to this path), read without consuming it and without the
 * id module, for the reason above. `result-ending.test.tsx` holds the two
 * to one answer.
 */
export const carriedHere = (pathname: string): boolean =>
  /^h_[\s\S]{1,78}$/.test(peekCarriedHandoff(pathname) ?? "");

export function TicketRail() {
  const run = useToolRun();
  // Latched: open from the first commit that knew of a hand-off, and for
  // the rest of the visit — the runner takes the token as it claims.
  const [held, setHeld] = useState(false);
  useLayoutEffect(() => {
    // Measured before the browser paints, and set before it does: the one
    // re-render this costs is the point (React's "measure before paint").
    const arrived =
      carriedHere(window.location.pathname) ||
      arrivedByHandoff(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    if (arrived) setHeld(true);
  }, []);
  const wanted = run !== null && (run.trail.length > 0 || run.bringing);
  if (wanted && !held) setHeld(true);
  if (!run || !(held || wanted)) return null;
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

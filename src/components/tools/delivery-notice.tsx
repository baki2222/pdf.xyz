"use client";

import { AlertTriangle } from "lucide-react";
import type { Job } from "@/lib/jobs/types";
import type { AiDeliveryMeta } from "@/lib/jobs/ai-results";

/**
 * The panel-side disclosure that a job delivered less than the document held.
 *
 * ── WHY THE ARTIFACT'S GAP WAS NOT ENOUGH ───────────────────────────────────
 *
 * The withheld pages are already marked inside `translation.md`, positioned
 * where those pages were, so a reader who opens the package meets them. But the
 * SCREEN said *"Your AI translation package is ready"* — true in the narrow
 * sense that the job finished, while the thing the user asked for was not
 * delivered and their daily allowance was spent on it.
 *
 * That is this product's signature defect in its usual clothes: a sentence true
 * in a narrow reading, sitting where a reader takes the broad one. **A surface
 * may not assert something the system contradicts.**
 *
 * ── IT NAMES THE BOUND, BECAUSE THE TWO NEED DIFFERENT ACTIONS ──────────────
 *
 * An exhausted reservation means "translate the rest as a separate document";
 * a page bound means "the document is not what was declared". A notice that
 * gave a count without the reason would leave a reader knowing something is
 * missing and with nothing to do about it.
 *
 * ── COMPUTED FROM THE JOB RECORD, NOT FROM THE MODEL'S WORDS ────────────────
 *
 * Same reason as `TruncationNotice`: the counts come from the record the worker
 * wrote, so this appears whether or not anything else cooperated. The record
 * carries the block ONLY when pages were withheld — there is no
 * `withheldPages: 0` state to guard against here, because `buildAiResultMeta`
 * drops it at the persistence boundary.
 */
export function DeliveryNotice({ job }: { job: Job | undefined }) {
  const delivery = job?.results?.ai?.delivery;
  if (!delivery || delivery.withheldPages < 1) return null;

  return (
    <p
      role="status"
      className="border-warn/40 bg-warn/10 text-warn flex items-start gap-2 rounded-[4px] border px-4 py-3 text-sm"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">{deliverySummary(delivery)}</strong>{" "}
        {deliveryConsequence(delivery)}
      </span>
    </p>
  );
}

/** "Translated 8 of 12 pages." — the count, first, because it is the fact. */
export function deliverySummary(delivery: AiDeliveryMeta): string {
  const total = delivery.deliveredPages + delivery.withheldPages;
  return `Translated ${delivery.deliveredPages.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} pages.`;
}

/** What the bound was, and what to do about it. */
export function deliveryConsequence(delivery: AiDeliveryMeta): string {
  return delivery.boundBy === "characters"
    ? "The remaining pages held more text than this job's free daily allowance reserved for it, so they were left untranslated rather than cut short. They are marked in place in the package. Translate them as a separate document."
    : "The document held more pages of text than were declared for it, so the remainder was left untranslated. They are marked in place in the package. Upload it again to translate the rest.";
}

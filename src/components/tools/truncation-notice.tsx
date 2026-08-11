"use client";

import { AlertTriangle } from "lucide-react";
import type { Job } from "@/lib/jobs/types";
import { userTruncationNotice } from "@/lib/workers/ai/truncation";

/**
 * The panel-side disclosure that an AI tool only read part of the document.
 *
 * WHY IT RENDERS FROM `job.results.ai`, NOT FROM THE MODEL'S WORDS
 * The prompt now tells the model its window is short and instructs it to say so.
 * That is worth doing and is not sufficient: a model can decline, forget, or
 * bury it, and the one output where it matters most — a confident "the document
 * does not state this" — is exactly the output a model produces when it believes
 * it saw everything. This notice is computed from the job record's counts, so it
 * appears whether or not the model cooperated.
 *
 * The sentence itself comes from `userTruncationNotice`, the same function the
 * packaged manifest uses, so the panel and the downloaded file cannot disagree
 * about how far the reading reached.
 */
export function TruncationNotice({
  job,
  consequence,
}: {
  /** The completed job, whose `results.ai` block carries the window. */
  job: Job | undefined;
  /** The one sentence that says what this tool's truncation means for the output. */
  consequence: string;
}) {
  const window = job?.results?.ai?.truncation;
  if (!window || !window.truncated) return null;

  const sentence = userTruncationNotice(window);
  if (!sentence) return null;

  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">{sentence}</strong> {consequence}
      </span>
    </p>
  );
}

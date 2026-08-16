"use client";

import { Wrench } from "lucide-react";
import type { Job } from "@/lib/jobs/types";

/**
 * What qpdf had to fix, shown beside a completed repair.
 *
 * A repair tool that hands back a file and says nothing has told the user the
 * least useful true thing it knows. qpdf reports a recovered document with exit
 * status 3 and a list of what it reconstructed; the worker used to treat that
 * status as a failure and discard both the file and the explanation.
 *
 * Renders from `job.results.repair`, not from anything the panel infers: the
 * distinction between "nothing was wrong" and "we could not tell you what was
 * wrong" is exactly the one a repair tool must not blur, so `recoveredWithWarnings`
 * is read directly rather than derived from whether the list is empty.
 */
export function RepairWarnings({ job }: { job: Job | undefined }) {
  const repair = job?.results?.repair;
  if (!repair || !repair.recoveredWithWarnings) return null;

  return (
    <div
      role="status"
      className="border-warn/40 bg-warn/10 text-warn flex flex-col gap-2 rounded-[4px] border px-4 py-3 text-sm"
    >
      <p className="flex items-start gap-2">
        <Wrench className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold">
            This PDF was damaged and has been rebuilt.
          </strong>{" "}
          The repair succeeded; what follows is what had to be reconstructed, so
          you can check those parts against the original.
        </span>
      </p>
      {repair.warnings.length > 0 ? (
        <ul className="text-warn ml-6 flex list-disc flex-col gap-1">
          {repair.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : (
        // The engine reported a recovery but nothing survived sanitizing. Say
        // that, rather than showing an empty list that reads as "nothing wrong".
        <p className="text-warn ml-6">The details could not be shown safely.</p>
      )}
    </div>
  );
}

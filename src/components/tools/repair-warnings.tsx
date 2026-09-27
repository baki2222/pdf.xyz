"use client";

import { Wrench } from "lucide-react";
import type { Job } from "@/lib/jobs/types";

/**
 * The sentence a finished repair ends on — shown AND announced, from the same
 * function, so the eye and the screen reader cannot be told different things.
 *
 * It says what qpdf reported and no more. Until 2026-09-27 every success said
 * "Your repaired PDF is ready.", including a run where qpdf exited 0 — nothing
 * to repair — so a user whose file "won't open" for a reason a structural
 * rewrite cannot see (damage inside the page content) was told it had been
 * repaired and handed an identical file. (Not a password: the worker gives
 * qpdf none, so a file that needs one never reaches exit 0.) Exit 0 means qpdf issued no
 * warnings; it does not prove the file is undamaged, hence "found no
 * structural damage", not "the file is fine".
 *
 * No `repair` block means the worker did not report (its image deploys by hand
 * and can be older than this page), so the sentence claims neither outcome.
 */
export function repairDoneSentence(job: Job | undefined): string {
  const recovered = job?.results?.repair?.recoveredWithWarnings;
  if (recovered === true) return "Your repaired PDF is ready.";
  if (recovered === false)
    return "qpdf found no structural damage and rewrote the file cleanly.";
  return "Your PDF is ready.";
}

/**
 * Everything a finished repair shows above its download: what qpdf rebuilt
 * when it rebuilt something, the outcome sentence, and — on a clean run —
 * what a clean result does and does not rule out.
 *
 * The clean line must hold on the branch it sits on. It renders only when
 * qpdf exited 0, and the worker passes qpdf no password (`repairArgs`), so
 * qpdf has just opened the file without one. Until 2026-09-27 this line said
 * the file "may be password-protected — try Unlock PDF": impossible here, the
 * same wrong route `requiresPasswordArgs` rejects `--is-encrypted` for. What
 * survives a clean open is only that the damage may be inside the page
 * content, which a structural rewrite does not rebuild. It links nowhere: no
 * tool has been shown to help a file qpdf opened cleanly, and a link here is a
 * claim that one can (pdf-structure-worker-panel.test.tsx pins the absence).
 */
export function RepairOutcome({ job }: { job: Job | undefined }) {
  const clean = job?.results?.repair?.recoveredWithWarnings === false;
  return (
    <>
      <RepairWarnings job={job} />
      <p className="text-ok text-sm">{repairDoneSentence(job)}</p>
      {clean && (
        <p className="text-muted text-sm leading-relaxed">
          If it still won&apos;t open, the problem may be in the page content,
          which a structural repair cannot rebuild.
        </p>
      )}
    </>
  );
}

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

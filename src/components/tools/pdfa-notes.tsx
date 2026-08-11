"use client";

import { Scissors } from "lucide-react";
import type { Job } from "@/lib/jobs/types";

/**
 * What the PDF/A conversion had to remove, shown beside the finished file.
 *
 * PDF/A cannot represent everything a PDF can, and Ghostscript's answer is to
 * delete the offending content and exit 0. Measured on production (gs 10.00.0,
 * production argv): a document came back valid, converted, and two lines lighter
 * in metadata, with the only record of that on a stream nobody read.
 *
 * The framing is deliberate and it is NOT the framing of `RepairWarnings`. A
 * repair that emitted warnings means the input was broken. A conversion that
 * removed something means the FORMAT could not hold it — the file is correct,
 * the user asked for exactly this, and the removal is inherent. So this reads as
 * a receipt, not an alarm.
 *
 * AND IT IS THE COMMON CASE, WHICH THE FIRST WORDING DID NOT ACCOUNT FOR.
 * Measured on production 2026-08-11: essentially every PDF that has been through
 * a producer carries `/Producer` or `/Creator` text, and Ghostscript discards
 * DOCINFO for all of them — an empty string is still a text string, so even
 * clearing every field does not silence it. A block headed "The converter
 * changed or removed some content" and closing with "compare the result against
 * your original" therefore fired on nearly every conversion, at a volume the
 * situation does not earn. **A notice that appears every time is one users learn
 * to skip, and that is how the unusual one gets missed later.**
 *
 * So the heading states the category rather than raising an alarm, and the
 * closing line says the routine case is routine. The LIST is untouched: it is
 * the informative part, and an unusually long or unfamiliar one still stands out
 * precisely because the surrounding text is calm.
 *
 * The lines are Ghostscript's own prose, unparsed. They change between versions,
 * and a classifier that quietly stopped matching after an upgrade would render
 * an empty list — "nothing was removed" — while meaning "I no longer understand".
 */
export function PdfANotes({ job }: { job: Job | undefined }) {
  const pdfa = job?.results?.pdfa;
  if (!pdfa || !pdfa.hadNotes) return null;

  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-2xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100"
    >
      <p className="flex items-start gap-2">
        <Scissors className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold">What PDF/A could not keep:</strong>{" "}
          The format cannot store everything a PDF can, so the converter drops
          what does not fit. This is what it reported:
        </span>
      </p>
      {pdfa.notes.length > 0 ? (
        <ul className="ml-6 flex list-disc flex-col gap-1 text-sky-100/90">
          {pdfa.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : (
        // It reported something and none of it survived sanitizing. Say that,
        // rather than showing an empty list that reads as "nothing was removed".
        <p className="ml-6 text-sky-100/90">
          The details could not be shown safely.
        </p>
      )}
      <p className="ml-6 text-xs text-sky-100/70">
        Document metadata is the usual casualty and this is routine. Read the
        list if any of it matters to your archive.
      </p>
    </div>
  );
}

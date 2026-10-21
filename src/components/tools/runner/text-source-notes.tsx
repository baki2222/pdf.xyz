"use client";

import { Info, TriangleAlert } from "lucide-react";
import { describeReplacementCharacters } from "@/lib/text/decode-text-file";

/**
 * What the user needs to know about the text in the editor before they press
 * Create PDF — shown beside the editor, where they can check it.
 *
 * Two notes, from two independent sources:
 *
 *  - `readNote` says how a picked FILE was decoded when that was a guess
 *    (Windows-1252, UTF-16 without a mark) or when control characters were
 *    removed. It comes from the decoder, which knows what it assumed.
 *  - the replacement-character warning is computed from the TEXT itself, on
 *    every render, so it also covers a paste of already-damaged text and any
 *    future read path that forgets the decoder.
 *
 * Neither is an error: both are `role="status"`, never `ErrorNote`'s
 * `role="alert"`. The file was read and the text is in the box; the user is
 * being told what to check, not that something failed.
 */
export function TextSourceNotes({
  readNote,
  text,
}: {
  readNote?: string | null;
  text: string;
}) {
  const damaged = describeReplacementCharacters(text);
  if (!readNote && !damaged) return null;
  return (
    <div className="flex flex-col gap-2">
      {readNote && (
        <p
          role="status"
          className="border-line bg-wash text-muted rounded-panel flex items-start gap-2 border px-4 py-3 text-sm"
        >
          <Info className="text-accent mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{readNote}</span>
        </p>
      )}
      {damaged && (
        <p
          role="status"
          className="border-warn/40 bg-warn/10 text-warn rounded-panel flex items-start gap-2 border px-4 py-3 text-sm"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{damaged}</span>
        </p>
      )}
    </div>
  );
}

"use client";

import { useId, useState } from "react";
import type { WorkerStatus } from "@/lib/workers/status";
import { PDF_TO_WORD_OCR_LANGUAGE_CODES } from "@/lib/jobs/ocr";
import { OcrLanguagePicker, useOcrLanguageChoice } from "./ocr-language-picker";

/**
 * "Recognise text in scans (OCR)" and what sits under it: OCR PDF's language
 * picker and three of its page choices. One component for every panel that
 * runs OCR first in the same job — PDF to Word since 2026-10-24; PDF to
 * Excel, PDF to PowerPoint and Extract Tables since 2026-11-08 (audit
 * pdf-to-excel#2, pdf-to-powerpoint#4, extract-tables#3) — so the worker's
 * one OCR-first step (`workers/processor/ocr-first.ts`) has one switch.
 */

/** What a panel sends when the switch is on: the job's `ocr` input. */
export interface OcrFirstRequest {
  languages: readonly string[];
  rotatePages: boolean;
  deskew: boolean;
  redoOcr: boolean;
}

export function useOcrFirstChoice(status: WorkerStatus | null | undefined) {
  const [on, setOn] = useState(false);
  // Right-to-left scripts are left out: their words come out of a
  // conversion out of order (`PDF_TO_WORD_OCR_LANGUAGE_CODES`).
  const languageChoice = useOcrLanguageChoice(
    status,
    PDF_TO_WORD_OCR_LANGUAGE_CODES,
  );
  // OCR PDF's page choices (audit pdf-to-word#3, 2026-11-08). Straighten and
  // Redo turn each other off, as on OCR PDF; parseOcrOptions refuses the
  // pair on the server as well.
  const [rotatePages, setRotatePages] = useState(false);
  const [deskew, setDeskew] = useState(false);
  const [redoOcr, setRedoOcr] = useState(false);
  const available = status?.ocr.available === true;
  const request: OcrFirstRequest | undefined = on
    ? { languages: languageChoice.selected, rotatePages, deskew, redoOcr }
    : undefined;
  return {
    on,
    setOn,
    languageChoice,
    rotatePages,
    setRotatePages,
    deskew,
    setDeskew,
    redoOcr,
    setRedoOcr,
    available,
    /** On, but this worker cannot run OCR: Run must wait. */
    blocked: on && !available,
    /** The job's `ocr` input, or undefined when the switch is off. */
    request,
    detail: status?.ocr.detail,
  };
}
export type OcrFirstChoice = ReturnType<typeof useOcrFirstChoice>;

export function OcrFirstSwitch({
  choice,
  busy,
  hint,
}: {
  choice: OcrFirstChoice;
  busy: boolean;
  hint: string;
}) {
  const deskewId = useId();
  const { on, rotatePages, deskew, redoOcr } = choice;
  return (
    <div className="border-line rounded-panel flex flex-col gap-3 border p-3">
      <label className="text-muted flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={on}
          // Guarded, never `disabled`: focus stays put mid-run (#46).
          onChange={(event) => {
            if (!busy) choice.setOn(event.target.checked);
          }}
          aria-disabled={busy || undefined}
          className="border-line-strong bg-wash accent-accent rounded-ctl mt-0.5 size-4"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-fg font-medium">
            Recognise text in scans (OCR)
          </span>
          <span className="text-muted text-xs leading-relaxed">{hint}</span>
        </span>
      </label>
      {on &&
        (choice.available ? (
          <>
            <OcrLanguagePicker choice={choice.languageChoice} />
            <label className="text-muted flex min-h-11 items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={rotatePages}
                // Guarded, never `disabled`, as above.
                onChange={(event) => {
                  if (!busy) choice.setRotatePages(event.target.checked);
                }}
                aria-disabled={busy || undefined}
                className="border-line-strong bg-wash accent-accent rounded-ctl mt-0.5 size-4"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-fg font-medium">Turn pages upright</span>
                <span className="text-muted text-xs leading-relaxed">
                  Sideways or upside-down scanned pages without text.
                </span>
              </span>
            </label>
            <label className="text-muted flex min-h-11 items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={deskew}
                // Off while Redo is on: OCRmyPDF refuses the pair.
                onChange={(event) => {
                  if (!busy && !redoOcr) choice.setDeskew(event.target.checked);
                }}
                aria-disabled={busy || redoOcr || undefined}
                // Named by its label alone: the hint names the other box,
                // and a name containing it would answer for both.
                aria-labelledby={`${deskewId}-name`}
                aria-describedby={`${deskewId}-hint`}
                className="border-line-strong bg-wash accent-accent rounded-ctl mt-0.5 size-4 aria-disabled:opacity-50"
              />
              <span className="flex flex-col gap-0.5">
                <span id={`${deskewId}-name`} className="text-fg font-medium">
                  Straighten crooked pages
                </span>
                <span
                  id={`${deskewId}-hint`}
                  className="text-muted text-xs leading-relaxed"
                >
                  For scanned pages without text; each one it levels is redrawn
                  as a new image. Not with Redo existing OCR.
                </span>
              </span>
            </label>
            <label className="text-muted flex min-h-11 items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={redoOcr}
                // Off while Straighten is on, as above.
                onChange={(event) => {
                  if (!busy && !deskew) choice.setRedoOcr(event.target.checked);
                }}
                aria-disabled={busy || deskew || undefined}
                className="border-line-strong bg-wash accent-accent rounded-ctl mt-0.5 size-4 aria-disabled:opacity-50"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-fg font-medium">Redo existing OCR</span>
                <span className="text-muted text-xs leading-relaxed">
                  For a PDF whose earlier OCR text is poor: that text is removed
                  and those pages are recognised again. Text typed into the
                  document is kept.
                </span>
              </span>
            </label>
          </>
        ) : (
          <p className="text-warn text-xs leading-relaxed">
            {choice.detail ??
              "OCR isn't available on this server, so this option can't run here."}{" "}
            Turn it off to convert the selectable text alone.
          </p>
        ))}
    </div>
  );
}

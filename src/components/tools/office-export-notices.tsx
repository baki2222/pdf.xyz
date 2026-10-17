"use client";

import Link from "next/link";
import { UNLOCK_TOOL_HREF } from "@/lib/pdf/encryption";
import { errorNoteLinksUnlock } from "./runner/runner-kit";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";

type OfficeExportErrorCode =
  (typeof OFFICE_EXPORT_ERROR_CODES)[keyof typeof OFFICE_EXPORT_ERROR_CODES];

/**
 * The tool that fixes each document-level failure. Typed as a total record
 * over the shared codes, so adding a code without a next step does not compile.
 */
export const OFFICE_EXPORT_NEXT_STEPS: Record<
  OfficeExportErrorCode,
  { href: string; label: string }
> = {
  [OFFICE_EXPORT_ERROR_CODES.noText]: {
    href: "/tools/ocr-pdf",
    label: "Open OCR PDF",
  },
  [OFFICE_EXPORT_ERROR_CODES.passwordProtected]: {
    href: UNLOCK_TOOL_HREF,
    label: "Open Unlock PDF",
  },
  [OFFICE_EXPORT_ERROR_CODES.unreadable]: {
    href: "/tools/repair-pdf",
    label: "Open Repair PDF",
  },
};

function nextStepFor(code: string | undefined) {
  return code && Object.hasOwn(OFFICE_EXPORT_NEXT_STEPS, code)
    ? OFFICE_EXPORT_NEXT_STEPS[code as OfficeExportErrorCode]
    : undefined;
}

/**
 * The tool that fixes a failed export, linked by error CODE. The messages say
 * the same thing in words, but a link keyed on message text breaks silently the
 * first time someone edits the sentence.
 */
export function OfficeExportNextStep({
  code,
  from,
  message,
}: {
  code: string | undefined;
  /**
   * The failure's sentence, when the panel shows it in an {@link ErrorNote}.
   * That note links Unlock PDF by itself whenever the sentence names it
   * (`errorNoteLinksUnlock`), so the same link here would be the second one
   * on screen. Found at the merge of wave-1 L03 with the integration branch
   * (2026-09-28): each side added one of the two links.
   */
  message?: string;
  /**
   * The slug of the tool the user is on. A next step that is this tool is not
   * a next step: Repair PDF failing with "unreadable" must not say "Open
   * Repair PDF".
   */
  from?: string;
}) {
  const step = nextStepFor(code);
  if (!step || (from && step.href === `/tools/${from}`)) return null;
  if (
    step.href === UNLOCK_TOOL_HREF &&
    message !== undefined &&
    errorNoteLinksUnlock(message)
  )
    return null;
  return (
    <Link
      href={step.href}
      className="text-fg self-start text-sm font-medium underline underline-offset-4"
    >
      {step.label}
    </Link>
  );
}

/*
 * The pages an export did not carry (`OfficeExportCoverageNotice`) are in
 * `./office-export-coverage`, not here (2026-10-17). This module is imported
 * by every worker panel that links a next step — Summarize, PDF structure,
 * table extraction — and webpack keeps a module whole: with the coverage
 * notice beside the link, every one of those pages carried PowerPoint's
 * coverage copy and its icons in its first load (+1.4 KB gz on
 * summarize-pdf at #179's merge into design batch C, which took the AI row
 * past what the redesign still has to add: `src/deploy/bundle-budget.test.ts`).
 */

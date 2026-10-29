/**
 * Preflight hints (redesign E.9): what a tool says about a file the moment
 * it opens, when the file is plainly better served first — or instead — by
 * another tool. At most one per file, and only from a fact the probe read.
 *
 *  - pdf-to-text, pdf-to-markdown, compare-pdf: every sampled page is
 *    image-only ("No selectable text on pages 1–3") → OCR PDF;
 *  - sign-pdf, edit-pdf, annotate-pdf: the file has AcroForm fields → Fill
 *    Forms, which keeps them fillable.
 *
 * Every doubt is silence: a page the probe could not classify, a locked file
 * (its facts were not read), a probe that did not finish. A hint that is
 * wrong costs a reader a detour; one that is missing costs nothing that the
 * tool did not already cost them.
 *
 * Copy lives here; `hints.test.ts` holds each sentence and each row, both
 * ways, to the spec's table. Every number printed is a field of the probe.
 */
import { imageOnlyRange, type PdfProbe } from "@/lib/pdf/probe-result";
import { getToolEntry } from "@/lib/tools/directory";
import { renderEvidence } from "./evidence";
import { HINT_TOOLS, hintNeedFor, type HintReason } from "./hint-tools";

export { HINT_TOOLS, hintNeedFor, type HintReason };

/** The tool each condition sends the file to. */
const TARGET: Record<HintReason, string> = {
  "image-only": "ocr-pdf",
  "form-fields": "fill-forms",
};

export interface PreflightHintSpec {
  readonly reason: HintReason;
  /** The tool the sentence names, and the action opens. */
  readonly toolSlug: string;
  readonly toolName: string;
  readonly text: string;
}

/** The one hint a file gets in `slug`, or null. */
export function hintFor(
  slug: string,
  probe: PdfProbe | null | undefined,
): PreflightHintSpec | null {
  const reason = hintNeedFor(slug);
  if (!reason || !probe || probe.read !== "ok" || probe.lock !== "none")
    return null;
  const toolSlug = TARGET[reason];
  const toolName = getToolEntry(toolSlug)?.name;
  if (!toolName) return null;
  if (reason === "image-only") {
    const range = imageOnlyRange(probe);
    if (!range) return null;
    const fact = renderEvidence({ kind: "no-text", name: null, ...range });
    return {
      reason,
      toolSlug,
      toolName,
      text: `${fact} — ${toolName} makes it searchable first`,
    };
  }
  const fields = probe.formFields ?? 0;
  if (fields <= 0) return null;
  const one = fields === 1;
  return {
    reason,
    toolSlug,
    toolName,
    text: `This PDF has ${fields} fillable field${one ? "" : "s"} — ${toolName} keeps ${one ? "it" : "them"} fillable`,
  };
}

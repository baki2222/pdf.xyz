import { MAX_PDF_BYTES } from "@/lib/pdf/files";
import { MAX_IMAGE_BYTES, MAX_SOURCE_BYTES } from "@/lib/tools/limits";
import { workerFileCeilingBytes } from "@/lib/workers/engine-file-ceilings";
import {
  EXCEL_TO_PDF_TOOL,
  POWERPOINT_TO_PDF_TOOL,
  WORD_TO_PDF_TOOL,
} from "@/lib/workers/office-conversion/tools";

/**
 * ONE list behind BOTH halves of a drop zone: what the file picker admits, and
 * what the caption above it tells a person we accept.
 *
 * They used to be two independent defaults four lines apart in `UploadZone`'s
 * parameter list — `accept = "application/pdf"` and a hint reading "PDF,
 * images, Word, and more". Nothing bound them, so the homepage shipped a picker
 * that filtered to PDFs under a sentence promising images and Word documents. A
 * visitor who clicked "browse" for a .docx simply could not see their file, and
 * no test could fail, because neither string is wrong on its own — it is the
 * RELATIONSHIP between them that was false.
 *
 * The size half was wrong in the same shape and cost more: the caption named a
 * single "Max 100 MB per file" taken from the worker's job limit, while the
 * caps that actually refuse the work are 25 MB per image and 2 MB of source
 * text. It overstated by 4x for an image and 50x for a .txt — always in the
 * direction that lets a person start work they cannot finish.
 *
 * So a kind carries its own ceiling, and the caption is GENERATED from the same
 * array the `accept` attribute is generated from. Adding a kind here changes
 * both; it cannot change one.
 *
 * The Office kinds repeated the mistake one tier over until 2026-09-27: they
 * read `JOB_LIMITS.maxFileBytes`, the worker's GLOBAL cap, and the caption
 * promised "Word, Excel, PowerPoint up to 100 MB" while LibreOffice — the only
 * engine that takes those files — refuses above 50. They now read the ceiling
 * of the tool that converts them, and `tools/worker-engine-ceilings.test.ts`
 * renders this caption and checks every kind against every tool that takes it.
 */
export type AcceptedKind = {
  /** What the caption calls this kind, in a person's words. */
  readonly label: string;
  /** File-picker tokens: MIME types and/or extensions, as `accept` wants them. */
  readonly accept: readonly string[];
  /** The ceiling that actually refuses the file, not the largest one nearby. */
  readonly maxBytes: number;
};

export const ACCEPTED_KINDS: readonly AcceptedKind[] = [
  {
    label: "PDF",
    accept: ["application/pdf", ".pdf"],
    maxBytes: MAX_PDF_BYTES,
  },
  {
    label: "images",
    accept: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      ".png",
      ".jpg",
      ".jpeg",
      ".webp",
      ".gif",
    ],
    maxBytes: MAX_IMAGE_BYTES,
  },
  {
    label: "Word",
    accept: [".doc", ".docx"],
    maxBytes: workerFileCeilingBytes(WORD_TO_PDF_TOOL),
  },
  {
    label: "Excel",
    accept: [".xls", ".xlsx"],
    maxBytes: workerFileCeilingBytes(EXCEL_TO_PDF_TOOL),
  },
  {
    label: "PowerPoint",
    accept: [".ppt", ".pptx"],
    maxBytes: workerFileCeilingBytes(POWERPOINT_TO_PDF_TOOL),
  },
  {
    label: "text",
    accept: ["text/plain", ".txt", ".md", ".csv"],
    maxBytes: MAX_SOURCE_BYTES,
  },
] as const;

/** The `accept` attribute for a file input that admits every listed kind. */
export function acceptAttribute(
  kinds: readonly AcceptedKind[] = ACCEPTED_KINDS,
): string {
  return kinds.flatMap((kind) => kind.accept).join(",");
}

function mb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/**
 * The caption, derived from the same list.
 *
 * Kinds that share a ceiling are named together, so the sentence stays short
 * without any group being written down twice — the grouping is computed, and a
 * kind whose cap changes moves between groups on its own.
 */
export function acceptHint(
  kinds: readonly AcceptedKind[] = ACCEPTED_KINDS,
): string {
  const byCap = new Map<number, string[]>();
  for (const kind of kinds) {
    const group = byCap.get(kind.maxBytes);
    if (group) group.push(kind.label);
    else byCap.set(kind.maxBytes, [kind.label]);
  }
  return [...byCap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([bytes, labels]) => `${labels.join(", ")} up to ${mb(bytes)} MB`)
    .join(" · ");
}

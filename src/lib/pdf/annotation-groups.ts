/**
 * The annotation kinds Remove Annotations offers, as ONE table: the panel's
 * checkboxes, their defaults, the line under each saying what removing it
 * does, the engine's sorting of a PDF's annotations, and the tool page's
 * prose are all read from here (`remove-annotations.ts`,
 * `remove-annotations-editor.tsx`, `content/remove-annotations.ts`). A kind
 * added here is offered, sorted, defaulted and described in one change.
 *
 * Subtypes are the PDF names of ISO 32000-2 §12.5.6. A Popup is never a
 * group of its own: it is the window another annotation opens, and goes
 * with that annotation. A Widget is a form field's box: it is sorted into
 * `form-fields`, except a signature field's, which no group ever removes.
 *
 * No pdf-lib, no DOM. Its own module so the panel can draw the
 * checkboxes before the engine (which needs pdf-lib) has loaded.
 */

import { outputName } from "./files";
import {
  ANNOTATION_GROUP_IDS,
  ANNOTATION_GROUP_LABEL,
  type AnnotationGroupKind,
} from "./offered-kinds";

export type AnnotationGroupId = AnnotationGroupKind;

export interface AnnotationGroup {
  readonly id: AnnotationGroupId;
  /** The checkbox label (`ANNOTATION_GROUP_LABEL`). */
  readonly label: string;
  /** The PDF /Subtype names sorted into this group. */
  readonly subtypes: readonly string[];
  /** Ticked when the panel opens. */
  readonly defaultOn: boolean;
  /** What removing this group does to the copy, in a sentence. */
  readonly consequence: string;
}

type Row = Omit<AnnotationGroup, "id" | "label">;

const ROWS: Record<AnnotationGroupId, Row> = {
  comments: {
    subtypes: ["Text", "FreeText", "Caret"],
    defaultOn: true,
    consequence:
      "Sticky notes, typed text boxes and insertion marks are deleted, with their pop-up windows and any replies to them.",
  },
  "text-markup": {
    subtypes: ["Highlight", "Underline", "StrikeOut", "Squiggly"],
    defaultOn: true,
    consequence:
      "Highlights, underlines and strike-throughs are deleted. The text under them stays on the page.",
  },
  drawings: {
    subtypes: ["Ink", "Square", "Circle", "Line", "Polygon", "PolyLine"],
    defaultOn: true,
    consequence:
      "Freehand ink, boxes, circles, lines and arrows drawn as annotations are deleted.",
  },
  stamps: {
    subtypes: ["Stamp"],
    defaultOn: true,
    consequence:
      "Stamp annotations such as Approved or Draft, and image stamps, are deleted.",
  },
  attachments: {
    subtypes: ["FileAttachment", "Sound"],
    defaultOn: true,
    consequence:
      "Attachment pins and sound clips are deleted. A file attached only through a removed pin is deleted from the PDF with it.",
  },
  links: {
    subtypes: ["Link"],
    defaultOn: false,
    consequence:
      "Clickable links and table-of-contents jumps stop working. The link text printed on the page stays.",
  },
  "form-fields": {
    subtypes: ["Widget"],
    defaultOn: false,
    consequence:
      "Fillable fields are deleted with their values, so the form can no longer be filled in, and nothing they showed is drawn onto the page. To keep the answers as page content, use Flatten PDF instead. Signature fields are always kept.",
  },
  "redaction-marks": {
    subtypes: ["Redact"],
    defaultOn: false,
    consequence:
      "Pending redaction marks are discarded. Nothing under them was ever removed; use Redact PDF to remove content.",
  },
  other: {
    subtypes: [
      "Watermark",
      "Movie",
      "Screen",
      "RichMedia",
      "3D",
      "PrinterMark",
      "TrapNet",
      "Projection",
    ],
    defaultOn: false,
    consequence:
      "Media players, 3D models, printer's marks, watermark annotations and any kind not listed above are deleted.",
  },
};

/** The table, in the panel's order (`ANNOTATION_GROUP_IDS`). */
export const ANNOTATION_GROUPS: readonly AnnotationGroup[] =
  ANNOTATION_GROUP_IDS.map((id) => ({
    id,
    label: ANNOTATION_GROUP_LABEL[id],
    ...ROWS[id],
  }));

/** The groups ticked when the panel opens. */
export const DEFAULT_GROUPS: ReadonlySet<AnnotationGroupId> = new Set(
  ANNOTATION_GROUPS.filter((g) => g.defaultOn).map((g) => g.id),
);

const BY_SUBTYPE = new Map<string, AnnotationGroupId>(
  ANNOTATION_GROUPS.flatMap((g) => g.subtypes.map((s) => [s, g.id] as const)),
);

/**
 * The group an annotation of this /Subtype belongs to. `null` for a Popup
 * (it goes with its parent); any subtype the table does not name, including
 * a missing one, is `other`.
 */
export function groupOfSubtype(
  subtype: string | undefined,
): AnnotationGroupId | null {
  if (subtype === "Popup") return null;
  return (subtype && BY_SUBTYPE.get(subtype)) || "other";
}

/** The table row for a group id. */
export function annotationGroup(id: AnnotationGroupId): AnnotationGroup {
  return ANNOTATION_GROUPS.find((g) => g.id === id)!;
}

/** "1 annotation", "3 annotations". */
export function annotationCount(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "annotation" : "annotations"}`;
}

/** The run button's label for `n` annotations to remove. */
export function removeRunLabel(n: number): string {
  return `Remove ${annotationCount(n)}`;
}

/** The download name: `<base>-annotations-removed.pdf`. */
export function removedOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "annotations-removed");
}

/** Said, and thrown, when a PDF has nothing a group can remove. */
export const NO_ANNOTATIONS_MESSAGE =
  "This PDF has no annotations to remove: no comments, highlights, drawings, stamps, attachments, links or form fields.";

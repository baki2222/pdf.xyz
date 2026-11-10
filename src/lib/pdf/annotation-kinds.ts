/**
 * Remove Annotations — the kinds of annotation its panel lists, in panel
 * order, and the label each checkbox shows. `annotation-groups.ts` builds
 * its table (subtypes, defaults, consequences) over these ids, so a kind
 * cannot be offered without a row, and the tool page counts this array.
 *
 * Its own module, imported by no first-load page. It sat in
 * `offered-kinds.ts` until 2026-11-10, and that module is in the shared
 * first-load chunk of seven other tool pages (sign, annotate, edit,
 * create-forms, grayscale, split, compress): webpack keeps a module's
 * exports per module, not per page, so this table shipped on all of them
 * (+156 to +170 B gzip each). Re-exporting the ids from `offered-kinds.ts`
 * did NOT help: webpack then kept this whole module in that chunk (measured
 * in a clean build the same day). So nothing in `offered-kinds.ts` names
 * it; `counted-facts.test.ts` lists this leaf beside `offered-kinds` as a
 * legal source of a counted list, and `bundle-budget.test.ts` holds these
 * labels out of every first-load chunk but the tool's own.
 */

export const ANNOTATION_GROUP_IDS = [
  "comments",
  "text-markup",
  "drawings",
  "stamps",
  "attachments",
  "links",
  "form-fields",
  "redaction-marks",
  "other",
] as const;
export type AnnotationGroupKind = (typeof ANNOTATION_GROUP_IDS)[number];
export const ANNOTATION_GROUP_LABEL: Record<AnnotationGroupKind, string> = {
  comments: "Comments and notes",
  "text-markup": "Highlights and text markup",
  drawings: "Drawings and shapes",
  stamps: "Stamps",
  attachments: "File attachments",
  links: "Links",
  "form-fields": "Form fields",
  "redaction-marks": "Unapplied redaction marks",
  other: "Other annotations",
};

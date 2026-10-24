/**
 * The kinds of thing a runner OFFERS — defined once, for the runner that offers
 * them, the engine that types them, and the tool page that counts them.
 *
 * Two tool pages shipped a count nobody could have checked. Edit PDF said "Eight
 * element types, including text, boxes, lines, images, and filled shapes" over an
 * editor with four (`text | rect | line | image`, a filled box being an option on
 * the box); Annotate PDF said "Six annotation kinds" over one with four. Both
 * numbers were typed into `tool-facts.ts` by hand, beside a header promising
 * every figure there is "derived from the constants that govern behavior — never
 * hand-written per page". Sign PDF's "Five ways to make a signature" counted the
 * typed signature twice — once per font style — and invented a "print-and-scan"
 * style that the runner renders as a plain printed name.
 *
 * Now each list lives here as the ids the runner iterates, the labels its buttons
 * show, and the phrases the fact names them by. The union types are DERIVED from
 * the id arrays, so adding a kind without a label or a fact phrase is a type
 * error, and `counted-facts.test.ts` holds every spelled count on every tool page
 * to the length of the array it counts.
 *
 * A leaf: no imports. `tool-facts.ts` is read by every tool page, and must not
 * drag pdf-lib or a client runner along with the sentence.
 */

/** Edit PDF — the kinds of new content the editor can flatten onto a page. */
export const EDIT_OP_TYPES = ["text", "rect", "line", "image"] as const;
export type EditOpType = (typeof EDIT_OP_TYPES)[number];
/** The editor's button labels. */
export const EDIT_OP_LABEL: Record<EditOpType, string> = {
  text: "Text",
  rect: "Box",
  line: "Line",
  image: "Image",
};
/** How the tool page names each kind, variants included (`filled?`, `arrow?`). */
export const EDIT_OP_FACT: Record<EditOpType, string> = {
  text: "text",
  rect: "boxes (filled or outlined)",
  line: "lines or arrows",
  image: "PNG or JPG images",
};

/** Annotate PDF — the markup shapes the tool can flatten onto a page. */
export const ANNOTATION_TYPES = ["highlight", "rect", "note", "line"] as const;
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];
export const ANNOTATION_LABEL: Record<AnnotationType, string> = {
  highlight: "Highlight",
  rect: "Box",
  note: "Note",
  line: "Line",
};
export const ANNOTATION_FACT: Record<AnnotationType, string> = {
  highlight: "highlights",
  rect: "boxes",
  note: "notes",
  line: "lines or arrows",
};

/** Create Forms — the field kinds the builder can create, in the order it offers them. */
export const NEW_FIELD_TYPES = [
  "text",
  "checkbox",
  "dropdown",
  "radio",
  "optionlist",
] as const;
export type NewFieldType = (typeof NEW_FIELD_TYPES)[number];
/** The engine's human-facing name for each field kind. */
export const FIELD_TYPE_LABELS: Record<NewFieldType, string> = {
  text: "Text field",
  checkbox: "Checkbox",
  dropdown: "Dropdown",
  radio: "Radio group",
  optionlist: "Option list",
};
/** The builder's (shorter) button labels. */
export const FIELD_TYPE_BUTTON: Record<NewFieldType, string> = {
  text: "Text",
  checkbox: "Checkbox",
  dropdown: "Dropdown",
  radio: "Radio",
  optionlist: "List",
};
export const FIELD_TYPE_FACT: Record<NewFieldType, string> = {
  text: "text fields",
  checkbox: "checkboxes",
  dropdown: "dropdowns",
  radio: "radio groups",
  optionlist: "option lists",
};

/** Split PDF — the ways the runner can divide a document. */
export const SPLIT_MODES = [
  "ranges",
  "everyN",
  "perPage",
  "size",
  "bookmarks",
] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];
export const SPLIT_MODE_LABEL: Record<SplitMode, string> = {
  ranges: "Custom ranges",
  everyN: "Every N pages",
  perPage: "Each page",
  size: "By file size",
  bookmarks: "By bookmarks",
};
export const SPLIT_MODE_FACT: Record<SplitMode, string> = {
  ranges: "custom page ranges",
  everyN: "every N pages",
  perPage: "one file per page",
  size: "a maximum file size per part",
  bookmarks: "top-level bookmarks",
};

/** Sign PDF — the typed signature's font styles. */
export const SIGNATURE_STYLES = ["signature", "print"] as const;
export type SignatureStyle = (typeof SIGNATURE_STYLES)[number];
export const SIGNATURE_STYLE_LABEL: Record<SignatureStyle, string> = {
  signature: "Script",
  print: "Print",
};

/** Sign PDF — where the signature mark comes from. */
export const SIGNATURE_SOURCES = ["draw", "type", "upload"] as const;
export type SignatureSource = (typeof SIGNATURE_SOURCES)[number];
export const SIGNATURE_SOURCE_LABEL: Record<SignatureSource, string> = {
  draw: "Draw",
  type: "Type",
  upload: "Upload",
};
export const SIGNATURE_SOURCE_FACT: Record<SignatureSource, string> = {
  draw: "draw it",
  // The styles are options on ONE source, not sources of their own — counting
  // them separately is how the page reached "five".
  type: `type it (${SIGNATURE_STYLES.map((s) => SIGNATURE_STYLE_LABEL[s].toLowerCase()).join(" or ")} style)`,
  // "pick", not "upload": the image never leaves the device (in-browser tool).
  upload: "pick a PNG or JPG image",
};

/*
 * The presets and modes below were private to their engine or runner until the
 * tool pages started answering questions about them ("What resolution…?",
 * "What size is the overlay?"). An answer that names them has to read THESE
 * arrays — the ones the runner renders — or it is a second copy that drifts.
 */

/** Overlay / Stamp — how the overlay page is sized onto each base page. */
export type OverlayFit = "fit" | "stretch" | "actual";

export interface OverlayFitOption {
  id: OverlayFit;
  label: string;
  hint: string;
}

/** The scale modes offered in the UI, in a sensible reading order. */
export const OVERLAY_FITS: readonly OverlayFitOption[] = [
  {
    id: "fit",
    label: "Fit page",
    hint: "Scale to fit, keeping the overlay's proportions (centered).",
  },
  {
    id: "stretch",
    label: "Stretch",
    hint: "Stretch the overlay to exactly cover each page.",
  },
  {
    id: "actual",
    label: "Actual size",
    hint: "Place the overlay at its original size, centered.",
  },
] as const;

/** Grayscale PDF — the rasterization presets the runner offers. */
export const GRAYSCALE_DPI_PRESETS = [
  { id: "screen", label: "Screen", dpi: 96 },
  { id: "print", label: "Print", dpi: 150 },
] as const;

/**
 * Compress PDF — the image resolutions the optional secure-worker step offers,
 * sent as `targetDpi` (the worker's Ghostscript downsamples every image to it).
 */
export const DEEP_COMPRESSION_PRESETS = [
  // 72 DPI is also the worker's floor (`MIN_DPI` in compression/engine.ts).
  { dpi: 72, label: "Extreme" },
  { dpi: 96, label: "Smaller" },
  { dpi: 150, label: "Balanced" },
  { dpi: 300, label: "High quality" },
] as const;

/**
 * Compress PDF — what the secure-worker step's Grayscale switch does, said by
 * the panel and the FAQ from this one sentence. Ghostscript is run with
 * `-sColorConversionStrategy=Gray`, which converts every colour on the page,
 * and the engine re-reads the output's images (`compression/image-colour.ts`)
 * and refuses the run if one still has more than one colour component.
 */
export const DEEP_COMPRESSION_GRAYSCALE_HINT =
  "Turns every colour on the pages — pictures, text and drawings — into shades of gray. The worker checks the result and refuses it if a picture is still in colour.";

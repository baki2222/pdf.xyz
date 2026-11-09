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

/**
 * Edit PDF — the kinds of item the WYSIWYG editor places, in toolbar order.
 * `editor/model.ts` derives its object list from this one and fails to
 * compile if the two disagree, and the tool page counts this array.
 *
 * Phase 3 (2026-10-24) added check marks, links and form fields. Links and
 * fields are written as interactive annotations, not page content.
 *
 * HISTORY. Until 2026-10-24 the tool page counted {@link EDIT_OP_TYPES}, the
 * four ops of the coordinate form that was then the editor. The form is gone
 * from the page; its engine (`edit.ts`, `editPdf`) is still in the tree and
 * still typed by that list, but it no longer describes what a reader can do.
 */
export const EDITOR_KINDS = [
  "text",
  "textedit",
  "image",
  "signature",
  "mark",
  "link",
  "field",
  "shape",
  "line",
  "whiteout",
  "redact",
  "highlight",
  "ink",
  "note",
] as const;
export type EditorKind = (typeof EDITOR_KINDS)[number];
/** How the tool page names each kind, variants included. */
export const EDITOR_KIND_FACT: Record<EditorKind, string> = {
  text: "text boxes",
  textedit: "changes to the PDF's own text",
  image: "PNG or JPG pictures",
  signature: "signatures (drawn, typed or from a picture)",
  mark: "check marks and crosses",
  link: "links to a web address, an email address, a phone number or another page",
  field:
    "fillable form fields (text, checkbox, dropdown, radio group and signature)",
  shape: "rectangles and ellipses",
  line: "lines and arrows",
  whiteout: "whiteout boxes",
  redact: "redaction boxes that remove the text and picture pixels under them",
  // Variants included: Underline and Strikethrough place a highlight object
  // with another `markup`, and Squiggly is its fourth Style (2026-11-08).
  highlight: "highlights, underlines, strikethroughs and squiggly underlines",
  ink: "freehand drawing and highlighter strokes",
  note: "notes",
};

/**
 * The editor's Mark-up group, in toolbar order — what Annotate PDF opens on
 * (since 2026-10-24 that page mounts the same editor, Highlight active) and
 * the list its page counts.
 */
export const MARKUP_KINDS = [
  "whiteout",
  "redact",
  "highlight",
  "ink",
  "note",
] as const satisfies readonly EditorKind[];

/**
 * The kinds "Save markups as comments" writes as real PDF annotations
 * (`editor/comments.ts`) — and so the only kinds the editor places on a
 * restricted PDF whose author allows comments. Whiteout and Redact are left
 * out on purpose: a comment can be deleted by whoever opens the file, so a
 * cover saved as one would hide nothing.
 */
export const COMMENT_KINDS = [
  "shape",
  "line",
  "highlight",
  "ink",
  "note",
] as const satisfies readonly EditorKind[];
export type CommentKind = (typeof COMMENT_KINDS)[number];

/**
 * The coordinate-op engine's kinds (`edit.ts`). Not what the Edit PDF page
 * offers any more — see {@link EDITOR_KINDS}.
 */
export const EDIT_OP_TYPES = ["text", "rect", "line", "image"] as const;
export type EditOpType = (typeof EDIT_OP_TYPES)[number];
// EDIT_OP_LABEL and EDIT_OP_FACT (the form's button labels and the tool
// page's phrases for these four) were removed with the form on 2026-10-24.

/**
 * The Annotate PDF form's markup kinds, which `annotate.ts` (its engine)
 * still types. Not what the Annotate PDF page offers since 2026-10-24 — it
 * opens the shared editor, and its page counts {@link MARKUP_KINDS}. The
 * form's button labels and the page's phrases for these four
 * (ANNOTATION_LABEL, ANNOTATION_FACT) were removed with it.
 */
export const ANNOTATION_TYPES = ["highlight", "rect", "note", "line"] as const;
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];

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
/**
 * The builder's (shorter) button labels. Named `…_LABELS` so the prose-to-UI
 * label guards (src/tests/ui-labels.ts) read it as labels; until 2026-10-31 it
 * was `FIELD_TYPE_BUTTON`, and "Pick … Radio or List" was checked by nothing.
 */
export const FIELD_TYPE_BUTTON_LABELS: Record<NewFieldType, string> = {
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
  "text",
  "oddEven",
] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];
export const SPLIT_MODE_LABEL: Record<SplitMode, string> = {
  ranges: "Custom ranges",
  everyN: "Every N pages",
  perPage: "Each page",
  size: "By file size",
  bookmarks: "By bookmarks",
  text: "By text",
  oddEven: "Odd and even pages",
};
export const SPLIT_MODE_FACT: Record<SplitMode, string> = {
  ranges: "custom page ranges",
  everyN: "every N pages",
  perPage: "one file per page",
  size: "a maximum file size per part",
  bookmarks: "top-level bookmarks",
  text: "every page that contains a word or phrase you type",
  oddEven: "the odd pages into one file and the even pages into another",
};

/**
 * Sign PDF — the typed signature's HANDWRITING styles (audit sign-pdf#1,
 * 2026-11-09). Each is a real handwriting face shipped from our own origin
 * (`handwriting.ts` holds the files, `handwriting-coverage.generated.ts` the
 * letters each one has) and embedded in the PDF. Until then a typed name came
 * only in Times Italic or Helvetica, while every competitor's Type tab looked
 * handwritten. Latin-only faces: a name with a letter a face does not have is
 * set as Script sets it (`handwritingFor` in `handwriting.ts`), and the panel
 * says so.
 */
export const HANDWRITING_STYLES = [
  "dancing-script",
  "alex-brush",
  "mr-dafoe",
  "homemade-apple",
] as const;
export type HandwritingStyle = (typeof HANDWRITING_STYLES)[number];

/**
 * Sign PDF — the typed signature's font styles: the handwriting faces, then
 * the two standard faces every document since 2026-08 was signed in (kept
 * exactly as they were: saved signatures and placed boxes name them).
 */
export const SIGNATURE_STYLES = [
  ...HANDWRITING_STYLES,
  "signature",
  "print",
] as const;
export type SignatureStyle = (typeof SIGNATURE_STYLES)[number];
export const SIGNATURE_STYLE_LABEL: Record<SignatureStyle, string> = {
  "dancing-script": "Dancing Script",
  "alex-brush": "Alex Brush",
  "mr-dafoe": "Mr Dafoe",
  "homemade-apple": "Homemade Apple",
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
/**
 * "type it (in one of N styles: …)", from the list and the labels. A function
 * called with a PURE mark, so a page that never reads the fact (every tool
 * page loads this leaf) does not keep the list-formatting call, and with it
 * every label, alive in its first-load chunk.
 */
function typedStylesFact(): string {
  const styles = new Intl.ListFormat("en", { type: "disjunction" }).format(
    SIGNATURE_STYLES.map((s) => SIGNATURE_STYLE_LABEL[s]),
  );
  return `type it (in one of ${SIGNATURE_STYLES.length} styles: ${styles})`;
}

export const SIGNATURE_SOURCE_FACT: Record<SignatureSource, string> = {
  draw: "draw it",
  // The styles are options on ONE source, not sources of their own — counting
  // them separately is how the page reached "five".
  type: /* @__PURE__ */ typedStylesFact(),
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

/** Overlay PDF — which overlay page is used for each base page. */
export type OverlayPaging = "repeat" | "cycle" | "last" | "once";

export interface OverlayPagingOption {
  id: OverlayPaging;
  label: string;
  hint: string;
}

/**
 * The paging modes offered for a multi-page overlay, in the order the runner
 * shows them; `repeat` is the default. The labels and hints are what the
 * control renders, and the tool page reads them from here.
 */
export const OVERLAY_PAGINGS: readonly OverlayPagingOption[] = [
  {
    id: "repeat",
    label: "First page on all",
    hint: "Use only the overlay's first page, on every page.",
  },
  {
    id: "cycle",
    label: "Cycle pages",
    hint: "Overlay page 1 on page 1, page 2 on page 2, and so on, starting again from overlay page 1 when the overlay runs out.",
  },
  {
    id: "last",
    label: "Repeat last page",
    hint: "Match pages in order, then keep using the overlay's last page: a cover letterhead on page 1 and a continuation sheet on every page after it.",
  },
  {
    id: "once",
    label: "Once, then stop",
    hint: "Match pages in order and stop when the overlay runs out: pages past its last page are left unchanged.",
  },
] as const;

/**
 * Edit PDF — the toolbar group holding the form-field tools, which other tool
 * pages (Create Fillable Forms) send readers to. `create-forms-runner.test.tsx`
 * holds the editor's TOOL_GROUPS to a group of this name with a signature
 * field in it.
 */
export const EDITOR_FORMS_GROUP = "Forms";

/** Overlay PDF — which base pages get the overlay; `all` is the default. */
export const OVERLAY_PAGE_SCOPES = [
  { id: "all", label: "All pages" },
  { id: "some", label: "Selected pages" },
] as const;

export type OverlayPageScope = (typeof OVERLAY_PAGE_SCOPES)[number]["id"];

/**
 * Grayscale PDF — the rasterization presets the runner offers. "fine" (300
 * DPI, the usual print standard) arrived 2026-11-07 (audit grayscale-pdf#4):
 * until then the sharpest was Print at 150. Print stays the default.
 */
export const GRAYSCALE_DPI_PRESETS = [
  { id: "screen", label: "Screen", dpi: 96 },
  { id: "print", label: "Print", dpi: 150 },
  { id: "fine", label: "Fine print", dpi: 300 },
] as const;

/**
 * Compress PDF — the image resolutions the optional secure-worker step offers,
 * sent as `targetDpi` (the worker's Ghostscript downsamples colour and gray
 * images to it; black-and-white images stop at {@link DEEP_MONO_MIN_DPI}).
 */
export const DEEP_COMPRESSION_PRESETS = [
  // 72 DPI is also the worker's floor (`MIN_DPI` in compression/engine.ts).
  { dpi: 72, label: "Extreme" },
  { dpi: 96, label: "Smaller" },
  { dpi: 150, label: "Balanced" },
  { dpi: 300, label: "High quality" },
] as const;

/**
 * Compress PDF's deep step never takes black-and-white (1-bit) images below
 * this resolution, whatever the Quality or Target size (audit compress-pdf#3).
 * Scanned text breaks up under 300 DPI while bilevel images are already
 * small, and Ghostscript's own /screen and /ebook presets keep mono at 300.
 * `nativeArgs` (compression/native.ts) sends `max(targetDpi, this)`.
 */
export const DEEP_MONO_MIN_DPI = 300;

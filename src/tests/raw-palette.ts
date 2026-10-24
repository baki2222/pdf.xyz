/**
 * The raw-palette rule's two halves, shared by the test that reads the SOURCE
 * (`src/components/raw-palette.test.ts`) and the one that reads the
 * stylesheet the build SHIPS (`src/deploy/shipped-css.test.ts`). A plain
 * module, not a test file: under `isolate: false` one test file importing
 * another empties the imported file's suite (see `transmission-claims.ts`).
 *
 * The allowance's classes are real call sites, so spelling them here makes
 * Tailwind generate nothing it would not generate anyway.
 */

const PREFIX =
  "bg|text|border(?:-[trblxyse])?|divide|ring-offset|ring|outline|decoration|shadow|from|via|to|fill|stroke|caret|accent";
const PALETTE =
  "white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

/** A palette colour utility, any variants and opacity included. */
const RAW_UTILITY = new RegExp(
  String.raw`(?<![\w/-])(?:[\w-]+:)*!?(?:${PREFIX})-(?:${PALETTE})(?:-\d{2,3})?(?:\/\d{1,3})?(?![\w-])`,
  "g",
);
/** A raw colour inside an arbitrary value: `shadow-[0_2px_4px_rgba(…)]`. */
const RAW_ARBITRARY =
  /(?<![\w-])(?:[\w-]+:)*!?[a-z][\w-]*-\[[^\]\s]*(?:#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\()[^\]\s]*\]/g;

/** Every raw colour class in a class string, variants stripped. */
export function rawColours(classes: string): string[] {
  return [
    ...classes.matchAll(RAW_UTILITY),
    ...classes.matchAll(RAW_ARBITRARY),
  ].map((m) => m[0].replace(/^(?:[\w-]+:)*!?/, ""));
}

/**
 * Colours that ARE the subject, by file and class. Each reason says what the
 * colour depicts; a class not listed here is reported even in a listed file.
 */
const PAPER = "a PDF page is white paper in both schemes; this draws one";
const ON_PAPER = "ink drawn on the white page, so it is set against paper";
export const RAW_COLOUR_ALLOWANCE: Record<string, Record<string, string>> = {
  "src/components/tools/runner/page-tile.tsx": {
    "bg-white": PAPER,
    "from-white/95": PAPER,
    "to-slate-200/85": `${PAPER} (the sheet's shading)`,
    "ring-black/5": `${PAPER} (its edge)`,
    "shadow-black/40": `${PAPER} (its cast shadow)`,
    "bg-slate-500/50": `${ON_PAPER} (the skeleton's text lines)`,
    "bg-slate-400/40": `${ON_PAPER} (the skeleton's text lines)`,
  },
  "src/components/tools/runner/sign-runner.tsx": {
    "bg-white": PAPER,
    "text-slate-900": `${ON_PAPER} (the signature preview)`,
    "text-slate-600": `${ON_PAPER} (the signature preview's caption)`,
  },
  "src/components/tools/runner/signature-pad.tsx": {
    "bg-white": `${PAPER} (the pad is signed like the page)`,
    "bg-slate-300": `${ON_PAPER} (the pad's baseline)`,
  },
  "src/components/tools/runner/redact-runner.tsx": {
    "bg-white": PAPER,
    "ring-black/10": `${PAPER} (its edge)`,
    "border-slate-400": `${ON_PAPER} (a pending redaction's outline)`,
    "bg-slate-900": `${ON_PAPER} (the redaction box is black, as it will print)`,
  },
  // Was edit-runner.tsx's schematic page until 2026-10-24; the editor that
  // replaced it draws the real page, here and in its thumbnails.
  "src/components/tools/runner/editor/wysiwyg-editor.tsx": {
    "bg-white": PAPER,
    "ring-black/10": `${PAPER} (its edge)`,
  },
  "src/components/tools/runner/editor/thumbnail-rail.tsx": {
    "bg-white": PAPER,
    "ring-black/10": `${PAPER} (its edge)`,
  },
  "src/components/tools/runner/annotate-runner.tsx": {
    "bg-white": PAPER,
    "ring-black/10": `${PAPER} (its edge)`,
  },
  "src/components/tools/runner/crop-runner.tsx": {
    "bg-white/90": PAPER,
    "ring-black/10": `${PAPER} (its edge)`,
  },
  "src/components/tools/request-signatures-worker-panel.tsx": {
    "bg-white": PAPER,
    "ring-black/10": `${PAPER} (its edge)`,
  },
};

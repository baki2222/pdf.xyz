/**
 * What people MEAN, as data: the words they use for a tool, the jobs they
 * come to do, and the formats they bring that nothing here opens.
 *
 * Data only — no catalogue import, no logic — so the search
 * (`@/lib/intent/search`) can read it from any chunk without pulling the
 * catalogue in. Every slug here resolves to a catalogue tool,
 * every synonym group is exercised by a row of the search corpus that fails
 * without it, and every corpus row filed as a synonym row fails without the
 * groups (`tools.test.ts`, both directions). A group nothing exercises is
 * decoration and does not belong here.
 *
 * No trailing comments: this file is walked by the copy guards, which strip
 * only full-line comments.
 */
import type { Format, UnsupportedFormat } from "@/lib/intent/formats";

/**
 * Words that mean the same job. The FIRST word of each group is its head: a
 * word in the target tool's own name, which a multi-word entry ("remove
 * password", "black and white") collapses to before matching.
 */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  [
    "compress",
    "shrink",
    "smaller",
    "reduce",
    "lighter",
    "minify",
    "optimise",
    "optimize",
    "size",
  ],
  ["merge", "join", "combine", "append", "concatenate"],
  ["split", "separate", "divide", "burst"],
  ["rotate", "turn", "flip"],
  ["sign", "signature", "esign", "esignature"],
  ["ocr", "scan", "scanned", "searchable", "recognise", "recognize"],
  ["unlock", "decrypt", "unprotect", "remove password"],
  ["protect", "password", "encrypt", "lock"],
  ["word", "docx", "doc"],
  ["excel", "xlsx", "xls", "spreadsheet"],
  ["powerpoint", "pptx", "ppt", "slides", "presentation"],
  ["jpg", "jpeg", "photo", "picture", "image"],
  ["redact", "blackout", "black out", "censor"],
  ["organize", "reorder", "rearrange", "arrange", "sort"],
  ["summarize", "summarise", "summary", "tldr", "recap"],
  ["chat", "ask", "question", "chatbot"],
  ["webpage", "website", "url", "link", "web page"],
  ["grayscale", "greyscale", "black and white", "monochrome"],
  ["crop", "trim", "margins", "border"],
  ["repair", "fix", "corrupt", "broken", "damaged", "restore"],
  ["pdfa", "archive", "archival"],
  ["number", "numbering", "paginate", "pagination"],
  ["delete", "remove", "erase"],
  ["translate", "translation", "translator"],
  ["annotate", "highlight", "markup", "comment"],
  ["edit", "editor", "modify"],
];

/** A job someone comes to do, in their words, and the tool that does it. */
export interface Task {
  readonly label: string;
  readonly slug: string;
}

/**
 * The glyph a hero task is drawn with. Named here so the task and its
 * picture travel together; `TaskGlyph` (src/components/intent/task-glyph.tsx)
 * draws each one, in the home desk's task list.
 */
export type TaskGlyphName =
  "compress" | "merge" | "sign" | "photos" | "to-word" | "ocr";

export interface HeroTask extends Task {
  readonly glyph: TaskGlyphName;
}

/** Six jobs to offer before a file arrives, each with its glyph. */
export const HERO_TASKS: readonly HeroTask[] = [
  { label: "Make a PDF smaller", slug: "compress-pdf", glyph: "compress" },
  { label: "Combine PDFs", slug: "merge-pdf", glyph: "merge" },
  { label: "Sign a PDF", slug: "sign-pdf", glyph: "sign" },
  { label: "Photos to PDF", slug: "jpg-to-pdf", glyph: "photos" },
  { label: "PDF to Word", slug: "pdf-to-word", glyph: "to-word" },
  { label: "Make a scan searchable", slug: "ocr-pdf", glyph: "ocr" },
];

/**
 * Jobs in a person's words. The search reads each as an alias of its tool,
 * so what the home page says a tool does is also what finds it.
 */
export const TASKS: readonly Task[] = [
  ...HERO_TASKS.map(({ label, slug }) => ({ label, slug })),
  { label: "Split a PDF into parts", slug: "split-pdf" },
  { label: "Delete a page", slug: "remove-pages" },
  { label: "Pull out some pages", slug: "extract-pages" },
  { label: "Turn pages the right way up", slug: "rotate-pdf" },
  { label: "Put pages in order", slug: "organize-pages" },
  { label: "Fill in a form", slug: "fill-forms" },
  { label: "Make a form fillable", slug: "create-forms" },
  { label: "Add a password", slug: "protect-pdf" },
  { label: "Remove a password", slug: "unlock-pdf" },
  { label: "Black out private text", slug: "redact-pdf" },
  { label: "Number the pages", slug: "page-numbers" },
  { label: "Stamp a watermark", slug: "watermark-pdf" },
  { label: "Fix a broken PDF", slug: "repair-pdf" },
  { label: "Copy the text out of a PDF", slug: "pdf-to-text" },
  { label: "Save pages as pictures", slug: "pdf-to-jpg" },
  { label: "Save a web page as a PDF", slug: "webpage-to-pdf" },
  { label: "Summarize a long PDF", slug: "summarize-pdf" },
  { label: "Ask a PDF questions", slug: "chat-with-pdf" },
  { label: "Get tables into a spreadsheet", slug: "extract-tables" },
  { label: "Pull data out of invoices", slug: "ai-extract" },
  { label: "Print in black and white", slug: "grayscale-pdf" },
  { label: "Trim the margins", slug: "crop-pdf" },
  { label: "Highlight a PDF", slug: "annotate-pdf" },
  { label: "Add text to a PDF", slug: "edit-pdf" },
  { label: "Compare versions of a PDF", slug: "compare-pdf" },
  { label: "Keep a PDF for the long term", slug: "pdf-to-pdfa" },
  { label: "Add a letterhead", slug: "overlay-pdf" },
  { label: "Add a header or footer", slug: "header-footer" },
  { label: "Flatten a filled form", slug: "flatten-pdf" },
  { label: "Prepare a PDF for others to sign", slug: "request-signatures" },
];

/**
 * What to say about a format nothing here opens. `becomes` is the format to
 * save a copy as, which names the tool to use instead (derived from the
 * catalogue when the answer is rendered, never written here); `how` is the
 * instruction, as an instruction — never a claim about other software. A
 * format with no honest way in has `becomes: null` and no instruction.
 */
export interface UnsupportedAnswerData {
  readonly noun: string;
  readonly becomes: Format | null;
  readonly how: string | null;
}

export const UNSUPPORTED_ANSWERS: Readonly<
  Record<UnsupportedFormat, UnsupportedAnswerData>
> = {
  HEIC: { noun: "HEIC photos", becomes: "JPG", how: "Save a JPG copy first." },
  HEIF: { noun: "HEIF images", becomes: "JPG", how: "Save a JPG copy first." },
  WEBP: { noun: "WebP images", becomes: "PNG", how: "Save a PNG copy first." },
  GIF: { noun: "GIF images", becomes: "PNG", how: "Save a PNG copy first." },
  TIFF: { noun: "TIFF images", becomes: "PNG", how: "Save a PNG copy first." },
  BMP: { noun: "BMP images", becomes: "PNG", how: "Save a PNG copy first." },
  SVG: {
    noun: "SVG graphics",
    becomes: "PNG",
    how: "Export a PNG copy first.",
  },
  AVIF: { noun: "AVIF images", becomes: "JPG", how: "Save a JPG copy first." },
  ODT: {
    noun: "OpenDocument text files",
    becomes: "DOCX",
    how: "Save a .docx copy first.",
  },
  ODS: {
    noun: "OpenDocument spreadsheets",
    becomes: "XLSX",
    how: "Save an .xlsx copy first.",
  },
  ODP: {
    noun: "OpenDocument presentations",
    becomes: "PPTX",
    how: "Save a .pptx copy first.",
  },
  RTF: {
    noun: "RTF documents",
    becomes: "DOCX",
    how: "Save a .docx copy first.",
  },
  EPUB: { noun: "EPUB e-books", becomes: null, how: null },
  ZIP: {
    noun: "ZIP archives",
    becomes: "PDF",
    how: "Unzip it first and add the files inside.",
  },
};

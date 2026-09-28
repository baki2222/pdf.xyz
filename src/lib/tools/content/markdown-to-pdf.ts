import type { ToolContent } from "./types";
import { MAX_SOURCE_MB } from "@/lib/tools/limits";
import {
  FONT_PACKS,
  SUPPORTED_SCRIPTS,
  UNSUPPORTED_SCRIPTS,
} from "@/lib/pdf/font-packs";
import { markdownPdfOutputName } from "@/lib/pdf/markdown-to-pdf";
import { LANGUAGE_NAMES, TRANSLATE_LANGUAGES } from "@/lib/jobs/translate-pdf";
import { formatBytes } from "@/lib/utils";

/**
 * Every claim below was read off the implementation, not the marketing:
 *  - parser and renderer: src/lib/pdf/markdown-to-pdf.ts (block kinds are
 *    heading, paragraph, list-item, quote, code — no table, image or rule;
 *    heading sizes are one for H1, one for H2, one shared by H3–H6);
 *  - controls and labels: src/components/tools/runner/markdown-to-pdf-runner.tsx
 *    and runner-kit.tsx (Dropzone "Drop a Markdown file here, or" + "browse",
 *    "Markdown content", "Create PDF" / "Creating PDF…", "PDF created",
 *    "Download PDF");
 *  - font routing and refusals: src/lib/pdf/unicode-font.ts + font-packs.ts.
 * The download names come from `markdownPdfOutputName`, the function the
 * runner itself calls, so a rename moves this copy with it.
 *
 * Checked by RUNNING `markdownToPdf` against the shipped Noto TTFs
 * (2026-09-27, via `setFontByteSource`), not only by reading:
 *  - ASCII input embeds Helvetica, Helvetica-Bold, Helvetica-Oblique and
 *    Courier; adding one "→" or one Bengali word leaves exactly ONE font in
 *    the file (a Noto Regular), so bold/italic/mono all collapse;
 *  - a Chinese file name alone moves an English body onto Noto Sans SC;
 *  - Chinese + Bengali is refused ("This text mixes Bengali and Chinese");
 *    emoji and Arabic are refused with the characters and reason named;
 *  - a 330-character Chinese paragraph with no spaces draws as ONE text line
 *    (wrapText breaks only at whitespace), and a 300-character URL is not
 *    split — both run off the right edge;
 *  - parseMarkdownBlocks turns `snake_case_name` into "snakecasename",
 *    "2 * 3 * 4" into "2  3  4", a ~~~ fence into "~js … ~", and a setext
 *    "Title\n=====" into the paragraph "Title =====".
 *
 * Re-checked by an adversarial pass (2026-09-27, same harness):
 *  - "→" and "✓" route to Noto Sans JP, "ż" and Cyrillic to Noto Sans; each
 *    file still carries exactly one font;
 *  - ✅ ❌ ❤ ⭐ 🚀 are refused, but ✓ ☀ ➡ are drawn — so "one emoji stops it"
 *    is only true of colour emoji, and the copy names examples of both;
 *  - inside a ~~~ fence or four-space indented code, a line starting with
 *    "# " becomes a heading and "- " a bullet — NOT body text;
 *  - backtick code loses paired underscores too (`my_var_x` → "myvarx");
 *  - `- [x] done` prints "[x] done", so task boxes print as [ ] or [x];
 *  - a badge `[![b](img)](link)` prints "b (img) (link)";
 *  - a translation.md-shaped Chinese and Japanese sample both convert;
 *  - embedDrawingFont walks its candidate packs in order, so a second face
 *    is fetched when the first shapes a character to .notdef — "one font
 *    file" is the usual case, not a bound.
 *
 * Deliberately NOT mentioned: the result panel's "Start over" link. Its
 * `onReset` clears the source text but never calls `useAsyncRun().reset()`, so
 * the "PDF created" panel stays on screen; a step promising it clears the way
 * for the next document would be false until the runner is fixed.
 *
 * relatedGuides is empty: no guide in `src/lib/guides/catalog.ts` covers
 * Markdown to PDF (the translate guide only produces the .md this tool reads).
 */

/** "a, b and c" — the scripts list is derived, so its grammar has to be too. */
function listOf(items: readonly string[], conjunction = "and"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
}

const SCRIPTS = listOf(SUPPORTED_SCRIPTS);

/** What a first Unicode document costs to fetch, smallest face to largest. */
const PACKS_BY_SIZE = [...FONT_PACKS].sort((a, b) => a.bytes - b.bytes);
const SMALLEST_PACK = PACKS_BY_SIZE[0]!;
const LARGEST_PACK = PACKS_BY_SIZE[PACKS_BY_SIZE.length - 1]!;
const FONT_SIZE_RANGE = `${formatBytes(SMALLEST_PACK.bytes)} for ${SMALLEST_PACK.label} to ${formatBytes(LARGEST_PACK.bytes)} for ${LARGEST_PACK.label}`;

/**
 * Translate PDF target languages whose script this tool refuses outright —
 * the join of the translator's language list and the refusal table, so a new
 * font pack or a new target language moves this sentence by itself.
 */
const REFUSED_TRANSLATIONS = TRANSLATE_LANGUAGES.map(
  (code) => LANGUAGE_NAMES[code],
).filter((name) => UNSUPPORTED_SCRIPTS.some((entry) => entry.name === name));
const REFUSED_TRANSLATIONS_SENTENCE =
  REFUSED_TRANSLATIONS.length > 0
    ? ` A translation into ${listOf(REFUSED_TRANSLATIONS, "or")} is refused here, because this tool cannot draw ${REFUSED_TRANSLATIONS.length > 1 ? "those scripts" : "that script"}.`
    : "";

/** The runner's default source name when nothing was loaded from disk. */
const PASTED_DOWNLOAD = markdownPdfOutputName("document.md");
const README_SOURCE = "README.md";
const README_DOWNLOAD = markdownPdfOutputName(README_SOURCE);

const content: ToolContent = {
  slug: "markdown-to-pdf",

  seoTitle: "Markdown to PDF — Convert .md Files, No Upload",

  metaDescription:
    "Turn a .md file or pasted Markdown into a clean PDF with headings, lists, quotes and code blocks — typeset in your browser, never uploaded.",

  intro: [
    "Paste Markdown into the editor or drop in a .md, .markdown or .mdown file, and pdf.xyz typesets it as a US Letter PDF with real, selectable text. For Western European text, # headings are bold, with level 1 largest, level 2 next and levels 3 to 6 sharing one size; list items are indented; each > quote line is italic with an accent bar beside its first line; and fenced code is set in a monospaced face under its language tag. The foot of each page shows its number and the total page count, and the file name without its extension appears small at the top of page one and becomes the PDF's document title.",
    `The whole conversion runs in your browser tab, so there is no upload: the Markdown never leaves your device. Sources can be up to ${MAX_SOURCE_MB} MB, counted in UTF-8 bytes, which means Chinese, Japanese or Korean text reaches the cap in fewer characters than English.`,
    "This is a clean document renderer, not a GitHub-style web page engine. Inline bold, italics and backtick code are flattened into plain body text. A link prints as its label followed by the address in parentheses and is not clickable. Images are not embedded; the alt text and URL, or the URL alone when there is no alt text, stand in their place. Tables and YAML front matter are not recognised, so their lines are parsed like any other Markdown and mostly print as plain paragraphs, and a --- rule prints as three hyphens rather than a line.",
  ],

  useCases: [
    {
      title: "Hand a README to someone who does not read Markdown",
      body: `Drop a repository's ${README_SOURCE} and download ${README_DOWNLOAD}: install steps and fenced code samples on printable pages, ready to attach to an email or ticket. A badge prints as its alt text followed by the image and link addresses, a screenshot with no alt text as its bare address, and any HTML in the README as literal tags. READMEs often carry emoji, and one colour emoji stops the conversion, so strip those first.`,
    },
    {
      title: "Typeset an AI chat answer",
      body: "Many chat assistants format replies in Markdown. Paste one into the editor and the pound signs, list markers and triple backticks become headings, bullets and code blocks instead of stray symbols. Delete colour emoji such as ✅ or 🚀 first, since one stops the conversion, and expect a table in the reply to collapse into a single paragraph.",
    },
    {
      title: "Print notes in Bengali or Korean",
      body: "Both write with spaces between words, so lines wrap normally, and the characters are drawn with an embedded Noto font chosen for the script rather than turned into question marks or empty boxes. Chinese and Japanese draw correctly too, but read the question on long lines before converting paragraphs that have no spaces.",
    },
    {
      title: "Give a translation a finished layout",
      body: `Translate PDF delivers a ZIP containing translation.md. Unzip it and drop that file here: its “Translation —” heading naming the language, quoted provenance note and whatever headings and lists the model kept come back as a PDF.${REFUSED_TRANSLATIONS_SENTENCE} A Chinese or Japanese translation converts, but its paragraphs do not wrap.`,
    },
  ],

  steps: [
    {
      title: "Add your Markdown",
      body: "Use the drop area at the top to load one .md, .markdown or .mdown file, or paste straight into the Markdown content box. A loaded file replaces the box's text and stays editable there.",
    },
    {
      title: "Check the size",
      body: `The figure on the Markdown content heading row reads “chars” followed by the size; the ${MAX_SOURCE_MB} MB limit is measured in bytes, not characters, and a file over it is turned away as it loads.`,
    },
    {
      title: "Click Create PDF",
      body: "While the button reads “Creating PDF…” the pages are laid out in your browser, after fetching a Noto font first if the text needs one. An empty box, text over the limit, characters no bundled font can draw, or two scripts no single bundled font draws together stop it with a message saying which.",
    },
    {
      title: "Download PDF",
      body: `The “PDF created” panel shows the file's size. The download is named after the loaded file, so ${README_SOURCE} saves as ${README_DOWNLOAD}; text pasted before any file was loaded saves as ${PASTED_DOWNLOAD}. Once a file has been loaded, its name stays attached even if you replace the text in the box.`,
    },
  ],

  faqs: [
    {
      q: "Is my Markdown uploaded to a server?",
      a: `No. Parsing, layout and PDF writing all happen in your browser. Besides the tool's own code, the only other thing it may fetch is Noto font data from pdf.xyz's own server, when your text or file name goes beyond the Western European set: usually one file, from ${FONT_SIZE_RANGE}, and a second only if the first cannot shape every character. Those requests name a font and carry none of your document.`,
    },
    {
      q: "Does it support tables, images and GitHub-flavored Markdown?",
      a: "Partly. # headings, - * + and numbered lists, > quotes, ``` fences and paragraphs are laid out properly. A table's rows run together into one paragraph with the pipes left in, strikethrough markers are removed without drawing a line, raw HTML prints literally, and task-list boxes print as [ ] or [x]. Underlined === headings, four-space indented code and ~~~ fences are not recognised: their lines are read as ordinary Markdown, so they mostly merge into body text, and a line inside them that starts with # or - turns into a heading or a bullet. Paired underscores or asterisks outside ``` fences are read as emphasis and deleted, inside backticks too, so snake_case_name prints as snakecasename. Nested items sit at their parent's indent, and numbered lists keep the numbers you typed.",
    },
    {
      q: "Why was my Markdown refused with an emoji or script error?",
      a: "Colour emoji such as ✅, ⭐ or 😀 are pictures, not letters, and no emoji font is bundled, so a document containing one is refused rather than converted with gaps. A few symbols that also exist as plain characters, such as ✓ and ☀, are drawn in black from a Noto face instead. The same refusal applies to a script pdf.xyz has no font for, right-to-left scripts it would otherwise draw backwards, and text mixing two scripts no single bundled font covers, such as Chinese with Bengali. The message names the characters or scripts involved; remove them and click Create PDF again.",
    },
    {
      q: "Which alphabets can it draw?",
      a: `The bundled fonts cover ${SCRIPTS}. Western European text uses the PDF's built-in fonts, with bold, oblique and monospaced faces. One character outside that set anywhere in the text or the file name, even a Polish ż or an arrow such as →, moves the whole document to a single regular-weight Noto face: headings then differ by size only, quotes are upright and code is no longer monospaced.`,
    },
    {
      q: "Is the text searchable, and can a long line overflow?",
      a: "The output is real PDF text, so you can select, copy and search it. Lines break only at spaces. A long unbroken string, such as a URL or a minified line of code, is not split and can run off the right edge of the page. Chinese and Japanese are usually written without spaces, so a paragraph in either stays on one line and most of it falls off the page; put line breaks or spaces into long passages before converting.",
    },
    {
      q: "Can I change the page size, fonts or margins?",
      a: "No. Every document uses US Letter pages with fixed margins and type styles, and there is no title field. The title and the small header on page one come from the loaded file's name, so rename the file before loading it to change them; text pasted before any file was loaded is titled “document”.",
    },
  ],

  relatedGuides: [],
};

export default content;

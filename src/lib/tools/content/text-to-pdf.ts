import type { ToolContent } from "./types";
import { MAX_SOURCE_MB } from "@/lib/tools/limits";
import {
  FONT_PACKS,
  SUPPORTED_SCRIPTS,
  UNSUPPORTED_SCRIPTS,
} from "@/lib/pdf/font-packs";

/**
 * Facts this copy leans on, each read from the code that makes it true:
 *
 *  - MAX_SOURCE_MB (owned by `@/lib/tools/limits`, re-exported through
 *    `tool-facts` to the runner) is enforced twice: the runner compares the
 *    picked file's size on disk (`file.size`) against MAX_SOURCE_BYTES before
 *    reading it, and `validatePlainTextInput` compares the text's UTF-8 byte
 *    length when Create PDF is pressed. The copy names both checks rather than
 *    claiming "UTF-8 bytes" for a gate that reads raw file bytes.
 *  - The scripts named are SUPPORTED_SCRIPTS, the list `embedDrawingFont`
 *    quotes in its own refusal, and the face count and labels are FONT_PACKS,
 *    so adding or dropping a font pack updates this page.
 *  - The right-to-left scripts are the UNSUPPORTED_SCRIPTS rows whose stated
 *    reason is right-to-left layout, and the emoji sentence exists only while
 *    an "emoji" row does, so the day either capability lands and its rows go,
 *    the sentence naming it goes with them (see `rtlSentence`, `emojiSentence`).
 *  - Output name: `textPdfOutputName` -> `outputName(name, "pdf", "pdf")`, and
 *    the runner's source name defaults to "text.txt", so notes.txt saves as
 *    notes-pdf.pdf and pasted text as text-pdf.pdf.
 *  - Font bytes are cached in the module-level `packBytes` map of
 *    `unicode-font.ts`: once per loaded tab (a client-side navigation away and
 *    back keeps it; a reload does not), and a failed fetch is not cached.
 *
 * Layout facts (US Letter, Courier for WinAnsi text, file name as a running
 * heading and as the PDF Title, "page / total" footer, tabs to a fixed run of
 * spaces, over-long words broken, whitespace-led wrapping) are from
 * `src/lib/pdf/text-to-pdf.ts`; none of its internal numbers is exported, so
 * none is stated here.
 *
 * Behaviours checked by running `textToPdf` against the shipped Noto TTFs in
 * `public/fonts` (re-run 2026-09-27 by the reviewer, not only read):
 *  - the file name is part of the body font's corpus (`[text, title]`), so a
 *    Chinese file name moved an English body off Courier onto Noto Sans SC;
 *  - Chinese + Bengali is refused ("This text mixes Chinese and Bengali");
 *    English + Bengali and Polish + Bengali both convert (Bengali face);
 *  - Arabic, Hebrew, Thai and an emoji are each refused with the characters
 *    shown and the UNSUPPORTED_SCRIPTS reason;
 *  - bytes of a Windows-1252 file decoded by `Blob.text()` become U+FFFD,
 *    which the Latin Noto pack covers, so the PDF is produced with replacement
 *    marks and no warning; a UTF-16LE file with BOM likewise converts, garbled.
 *    The "mono" face collapses to proportional Noto Sans on that path, which
 *    is why column alignment is only promised for Courier.
 *
 * Deliberately NOT mentioned: the result panel's "Start over" link. Its
 * `onReset` clears the source text but never calls `useAsyncRun().reset()`, so
 * the result panel stays on screen and the editor does not come back; a step
 * telling a reader to use it would be false until the runner is fixed. The
 * FAQ on several files therefore tells the reader to reload the page, which is
 * true whether or not that link is fixed.
 *
 * relatedGuides is empty because no guide in `src/lib/guides/catalog.ts`
 * covers plain text.
 */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const scripts = listOf(SUPPORTED_SCRIPTS);

const faceLabels = FONT_PACKS.map((pack) => pack.label).join("; ");

const rtlScripts = UNSUPPORTED_SCRIPTS.filter((entry) =>
  /right to left/i.test(entry.reason),
).map((entry) => entry.name);

const rtlSentence =
  rtlScripts.length > 0
    ? ` ${listOf(rtlScripts)} ${rtlScripts.length > 1 ? "stop" : "stops"} the conversion with an explanation: this tool places each line from the left margin rightward, so a right-to-left line would read in reverse.`
    : "";

const emojiSentence = UNSUPPORTED_SCRIPTS.some(
  (entry) => entry.name === "emoji",
)
  ? " Emoji stop it too, because colour emoji are not embedded, so delete them before converting."
  : "";

const content: ToolContent = {
  slug: "text-to-pdf",

  seoTitle: "Text to PDF Converter: TXT to PDF in Your Browser",

  metaDescription: `Turn a .txt file or pasted text into a paginated PDF with page numbers. Converted in your browser, nothing uploaded, sources up to ${MAX_SOURCE_MB} MB.`,

  intro: [
    `Paste text into the box or drop in a .txt file, press Create PDF, and you get a US Letter document with a page-of-total counter in the footer and a small heading on every page: the loaded file's name minus the extension, or "text" for pasted text. Long lines wrap at spaces, a word too long for one line is broken, tabs become spaces, Windows and old Mac line endings are normalised, and blank lines and leading indentation are kept.`,
    `Everything happens inside this browser tab, and your text is not uploaded anywhere. The cap is ${MAX_SOURCE_MB} MB: a file is checked by its size when you load it, and the text is checked again, in UTF-8 bytes, when you convert. Files are always decoded as UTF-8.`,
    `Western European text is set in Courier, one of the standard fonts PDF readers supply themselves, so no font is downloaded or embedded, and columns aligned with spaces stay aligned as long as each line fits the page width. A character beyond that set, from Polish letters to Cyrillic, and even one in the file name, switches the body text to a Noto typeface fetched from pdf.xyz's own server and embedded with only the characters you used. That face is not fixed-width, so space-aligned columns stop lining up.`,
  ],

  useCases: [
    {
      title: "Keep a log or terminal session as a document",
      body: "Server logs, build output and command transcripts in Western European characters keep their space-aligned columns in Courier, ready to attach to a ticket. Two things can still break a column: a line wider than the page wraps onto the next line, and a tab becomes a fixed run of spaces rather than a jump to a tab stop.",
    },
    {
      title: "Print or share notes from a plain-text app",
      body: "Notes exported from a phone app, a Notepad file or a text-only journal become numbered US Letter pages, each headed with the note's file name.",
    },
    {
      title: "Submit text where only PDF is accepted",
      body: "When a form or portal takes PDF and nothing else, convert the text first. Every page is headed with the file name, so give the file a different name before you load it if reviewers should see another title.",
    },
    {
      title: "Typeset text beyond the Western European alphabet",
      body: `The characters are drawn from one of ${FONT_PACKS.length} bundled Noto faces (${faceLabels}), picked to match the script, and the conversion halts with an explanation naming any character none of them can draw.`,
    },
  ],

  steps: [
    {
      title: "Add your text",
      body: 'Drop a .txt file on the area marked "Drop a TXT file here, or browse", click browse to pick one, or paste straight into the Text content box. Loading a file replaces whatever is in the box.',
    },
    {
      title: "Check and edit it",
      body: 'Edit in the box if needed; the figure beside the Text content heading shows the character count and size as you type. The PDF heading is the loaded file\'s name even after you edit the text, or "text" if you only pasted.',
    },
    {
      title: "Convert the text",
      body: 'Click Create PDF. Its label switches to "Creating PDF…" until the document is ready; when the text or file name needs a Noto face, that font file is fetched first, and it is reused for later conversions until you reload or close the tab.',
    },
    {
      title: "Download the paginated file",
      body: 'The "PDF created" panel lists the PDF\'s size and how many characters went in; press Download PDF. A file called notes.txt is saved as notes-pdf.pdf, and pasted text as text-pdf.pdf.',
    },
  ],

  faqs: [
    {
      q: "Is my text uploaded to a server?",
      a: "It is not: this tab assembles the PDF and the text stays on your device. Apart from the page's own code, the only thing it may request from pdf.xyz is a Noto font file, when your text needs a script beyond Western European. That request asks for a face by its file name, so it reveals which kind of face was needed, but none of your words.",
    },
    {
      q: "How large a text file can I convert?",
      a: `Up to ${MAX_SOURCE_MB} MB, whether you pick a file or paste. A file larger than that on disk is turned away when you load it, and the text is measured again in UTF-8 bytes when you press Create PDF; anything over is refused with a message rather than half-converted. A Chinese or Bengali character takes several bytes in UTF-8, so such text reaches the cap at far fewer characters than English. Empty or whitespace-only text is refused too.`,
    },
    {
      q: "Which languages and scripts come out correctly?",
      a: `Beyond Western European characters, text in ${scripts} gets a Noto face embedded in the file.${rtlSentence}${emojiSentence} Any other script without a bundled font is refused with the offending characters shown; the converter never swaps a character it cannot draw for a placeholder. One document cannot mix scripts that need different fonts, and the file name counts as part of the document here, so put, say, Chinese and Bengali passages in separate files.`,
    },
    {
      q: "Is there a setting for A4, another font or wider margins?",
      a: "There is none: every PDF is US Letter with fixed margins and text size, and the page heading doubles as the document's Title property. For headings, lists or code blocks, write Markdown and use Markdown to PDF.",
    },
    {
      q: "My file is .log, .csv or saved in another encoding. What do I do?",
      a: "A dropped file is accepted when its name ends in .txt or .text or your system labels it plain text, and the browse dialog is filtered to .txt and plain-text files; for anything else, paste the contents into the box or rename the file to .txt. Files are read as UTF-8 with no encoding detection, so an older ANSI (Windows-1252) or Latin-1 text converts without any warning but shows replacement marks (�) where its accented letters were, and UTF-16 text comes out garbled the same way. Re-save it as UTF-8 first.",
    },
    {
      q: "Can I turn several text files into one PDF?",
      a: "Not in one step: this tool converts one file or one pasted text at a time, and a multi-file drop loads just the first file. Either paste all the texts into the box one after another and convert once, or convert each file separately, reloading the page before the next one, then combine the results in order with Merge PDF.",
    },
  ],

  relatedGuides: [],
};

export default content;

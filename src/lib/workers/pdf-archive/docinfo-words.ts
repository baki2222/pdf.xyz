/**
 * Which document properties PDF to PDF/A carries into its copy (audit
 * pdf-to-pdfa#3), as a LEAF with no imports, so the browser's notes block
 * and the tool's pages can name them without loading pdf-lib, which the
 * worker-side reader (`./docinfo`) needs. That reader iterates this list, so
 * the copy and the code name one set.
 */

/** The Info fields carried, in the order the pdfmark lists them. */
export const CARRIED_DOCINFO_FIELDS = [
  "Title",
  "Author",
  "Subject",
  "Keywords",
] as const;

/** A field longer than this is not carried. */
export const MAX_CARRIED_FIELD_CHARS = 2000;

/** "title, author, subject and keywords": the carried fields, for copy. */
export const CARRIED_DOCINFO_WORDS = (() => {
  const words = CARRIED_DOCINFO_FIELDS.map((field) => field.toLowerCase());
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
})();

/**
 * The condition under which a field is carried, as ONE sentence every
 * surface uses (page intro, FAQ, notes block, tool facts, guide), so none of
 * them can say "carried" without it. Review 2026-11-08: two sentences said
 * the fields were carried with no condition, and were false for a curly
 * apostrophe, any accented letter, any other script and any encrypted file.
 *
 * What it states is what `carriedValue` in `./docinfo` keeps, and that is
 * what MEASUREMENT says survives: on the production worker image
 * (gs 10.00.0, 2026-11-07), a DOCINFO value with a round bracket, a
 * backslash or any byte above 0x7E was dropped from both the Info
 * dictionary and the XMP, whether written escaped, balanced, as hex, as
 * octal Latin-1 or as UTF-16; plain ASCII ("Smith's report & co: 50% -
 * ok?") arrived in both. The verdicts are a fixture in `./docinfo.test.ts`.
 */
export const CARRIED_DOCINFO_RULE = `A field is carried only when it is plain ASCII text with no round brackets or backslash, at most ${MAX_CARRIED_FIELD_CHARS.toLocaleString("en-US")} characters long, from a PDF that is not encrypted; one with an accented letter, a curly quote, an en dash or another script is left out rather than altered, because Ghostscript drops such text from a PDF/A file.`;

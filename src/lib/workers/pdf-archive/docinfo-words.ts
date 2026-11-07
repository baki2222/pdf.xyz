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

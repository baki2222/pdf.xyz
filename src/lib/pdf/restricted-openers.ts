// A leaf: it imports nothing, so the suggestion ranking on the home desk
// (src/lib/intent) can read the list without loading encryption.ts.
/**
 * The tools that OPEN a restricted PDF (`openProtected`): they save what the
 * author allows — a filled form, comments — under the author's own
 * encryption, and unlock every tool with the owner password typed in the
 * page (`@/lib/pdf/security/protected-pdf`). Named as the catalogue names
 * them, and exactly the runners that opt in — both checked in
 * `encryption-verdict.test.ts`, which also holds the sentence below to name
 * every one of them.
 *
 * HISTORY. Until 2026-10-30 this was RESTRICTED_FORM_TOOLS, Edit PDF and Fill
 * Forms only, and the sentence said they "can still fill its form" — while
 * Annotate PDF, the same editor, refused the file with this very message.
 */
export const RESTRICTED_OPENERS = [
  { name: "Edit PDF", href: "/tools/edit-pdf" },
  { name: "Annotate PDF", href: "/tools/annotate-pdf" },
  { name: "Fill Forms", href: "/tools/fill-forms" },
] as const;

// A leaf: it imports nothing, so the suggestion ranking on the home desk
// (src/lib/intent) can read the list without loading encryption.ts.
/**
 * The editors whose abilities on a restricted PDF the refusal's sentence
 * names (`RESTRICTED_OPENERS_SENTENCE` in `./encryption`): they open the file
 * (`openProtected`), save what the author allows — a filled form, comments —
 * under the author's own encryption, and unlock every tool with the owner
 * password typed in the page (`@/lib/pdf/security/protected-pdf`). Named as
 * the catalogue names them.
 *
 * Not every runner that opens a restricted file is here. One that asks a
 * single grant (`restricted-grant.tsx`: Rotate PDF, Extract Images) is not an
 * editor. An editor whose own job needs the owner password (Sign PDF) is left
 * out, and the list of those, with the reason, is
 * `src/tests/restricted-openers-left-out.ts`. `encryption-verdict.test.ts`
 * and `encryption-claims.test.ts` both hold this list to be exactly the
 * editors that open such a file minus that list, and the sentence to name
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

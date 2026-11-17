/**
 * The editors that OPEN a restricted PDF (`openProtected`) but that
 * `RESTRICTED_OPENERS_SENTENCE` leaves out, each with the reason.
 *
 * That sentence (in the refusal every pdf-lib tool shows) says what such a
 * file still allows WITHOUT the owner password, and sends people to the tools
 * that do it. An editor that opens the file but whose own job needs the owner
 * password does not belong in it. Both encryption guards read this list:
 * `src/lib/pdf/encryption-verdict.test.ts` (the runners discovered on disk)
 * and `src/lib/tools/encryption-claims.test.ts` (the runners the catalogue
 * mounts) — so the exclusion, its reason and the guards share one source.
 */
export const RESTRICTED_EDITORS_LEFT_OUT = [
  {
    slug: "sign-pdf",
    name: "Sign PDF",
    runner: "sign-runner.tsx",
    // audit sign-pdf#3, 2026-11-08
    why: "a signature is drawn into the page, not added as a comment, so it needs the owner password",
  },
] as const;

/**
 * Why a runner that REFUSES a restricted PDF does not yet carry the
 * owner-password field (`src/components/tools/runner/owner-password.tsx`).
 */
const NOT_YET =
  "writes a new PDF in the browser, so only the owner password could open a restricted file for it; the owner-password field has not been added to this runner yet, and its refusal still names Unlock PDF";

/**
 * The tool pages whose runner refuses a restricted PDF (one that opens
 * without a password but carries its author's restrictions) and does NOT
 * offer the owner-password field, each with the reason.
 *
 * Competitor-audit backlog #11 (2026-11-17) gave the field to Merge PDF,
 * Extract Pages, Delete Pages, Rotate PDF and Extract Images; Grayscale PDF
 * had its own since 2026-11-08 (`grayscale-password.tsx`, the same form).
 * `src/lib/tools/encryption-claims.test.ts` DERIVES the refusing runners
 * from the catalogue and the runner each page mounts, and holds every one
 * of them to: the field, or a row here. A new refusing tool turns it red
 * until it does one or the other; a row whose tool gains the field, or
 * stops refusing, turns it red too.
 */
export const OWNER_PASSWORD_LEFT_OUT: readonly { slug: string; why: string }[] =
  [
    "booklet-pdf",
    "create-forms",
    "crop-pdf",
    "edit-pdf-bookmarks",
    "edit-pdf-metadata",
    "flatten-pdf",
    "header-footer",
    "n-up-pdf",
    "organize-pages",
    "overlay-pdf",
    "page-numbers",
    "redact-pdf",
    "remove-annotations",
    "resize-pdf",
    "split-pdf",
    "split-pdf-pages-in-half",
    "watermark-pdf",
  ].map((slug) => ({ slug, why: NOT_YET }));

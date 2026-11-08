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

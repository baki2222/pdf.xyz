import type { EditorObject } from "./model";
import type { PageRef } from "./pages";

/**
 * Which edits of a certificate-signed PDF may be APPENDED to it, and which
 * must rewrite it (audit sign-pdf#5 review, 2026-11-08).
 *
 * An appended update keeps the original bytes as an untouched prefix —
 * that is what keeps an earlier signature verifying. It also keeps
 * everything the edit took OUT: cut the file at its first `%%EOF`, or open
 * the earlier revision in any viewer, and the redacted words, the retyped
 * line and the deleted page are all still there. So an edit that removes
 * something is written as a whole-file rewrite, where it really is gone,
 * and the signature is honestly reported as no longer verifying.
 *
 * Pure and feature-scoped: only the shared editor's session imports it.
 */
export type Removal = "redact" | "textedit" | "pages" | "links";

/** Each removal, as a noun phrase the editor's notices list. */
export const REMOVAL_LABEL: Record<Removal, string> = {
  redact: "a redaction",
  textedit: "a change to the page's own text (Edit text or Find & replace)",
  pages: "a deleted page",
  links: "a deleted link",
};

/** Every removal, in the order the notices name them. */
export const REMOVALS = Object.keys(REMOVAL_LABEL) as Removal[];

export interface SignedEdit {
  objects: readonly EditorObject[];
  /** The page list as displayed (`pages.ts`). */
  pages: readonly PageRef[];
  /** The file's own links the edit deletes (`editor-state.ts` removedLinks). */
  removedLinks: readonly string[];
}

/**
 * What this edit takes out of a file of `pageCount` pages. Empty: it only
 * adds or changes, and can be appended.
 */
export function removalsIn(edit: SignedEdit, pageCount: number): Removal[] {
  const kept = new Set(edit.pages.map((p) => p.source));
  const found: Record<Removal, boolean> = {
    redact: edit.objects.some((o) => o.kind === "redact"),
    textedit: edit.objects.some((o) => o.kind === "textedit"),
    pages: Array.from({ length: pageCount }, (_, i) => i).some(
      (i) => !kept.has(i),
    ),
    links: edit.removedLinks.length > 0,
  };
  return REMOVALS.filter((r) => found[r]);
}

/** "a, b or c" — the labels of `removals`, joined for a sentence. */
export function listRemovals(
  removals: readonly Removal[],
  type: "conjunction" | "disjunction",
): string {
  return new Intl.ListFormat("en", { type }).format(
    removals.map((r) => REMOVAL_LABEL[r]),
  );
}

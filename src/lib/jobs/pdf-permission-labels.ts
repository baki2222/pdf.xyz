/**
 * Protect PDF's permission switches as WORDS — the list the panel draws and
 * the tool page names, in the order drawn. The data (keys, /P bits) is
 * `./pdf-permissions`; every key there has exactly one entry here
 * (`pdf-permission-labels.test.ts`).
 *
 * A leaf (one type import) so the lazy panel and the server-rendered page can
 * read it without the job contract carrying these sentences into every
 * bundle that imports it.
 */
import type { PdfPermissionKey, PdfPermissions } from "./pdf-permissions";

/** One switch as a reader sees it. */
export interface PdfPermissionInfo {
  key: PdfPermissionKey;
  label: string;
  /**
   * When set, this switch cannot be turned off, and this says why. Drawn
   * beside the (checked, inert) box; the validator refuses `false`.
   */
  alwaysAllowed?: string;
}

/**
 * Why accessibility cannot be switched off. qpdf ignores
 * `--accessibility=n` for every AES encryption format (it warns "ignored for
 * modern encryption formats"), and Protect PDF offers only AES; PDF 2.0 also
 * tells readers to allow it regardless. So the box is shown, checked and
 * inert, rather than offered and quietly not applied.
 */
export const ACCESSIBILITY_ALWAYS_ALLOWED =
  "Always allowed: AES encryption, the only kind Protect PDF uses, cannot block screen readers from extracting text.";

/**
 * Why filling forms follows comments. The PDF format's "annotate" bit (6)
 * also grants filling in form fields, so a file that allows comments allows
 * form filling whatever bit 9 says. The validator refuses that combination
 * instead of writing a restriction readers will not apply.
 */
export const FORMS_FOLLOW_ANNOTATE =
  "Allowed while comments are allowed: the PDF format lets anyone who may comment also fill in forms.";

/**
 * The honest limit of every switch, said by the panel and the tool page from
 * this one sentence.
 */
export const PERMISSIONS_ARE_FLAGS =
  "These are permission flags in the encrypted file. PDF readers that follow the standard honour them, but some software ignores them, and anyone with the owner password can remove them.";

export const PDF_PERMISSIONS: readonly PdfPermissionInfo[] = [
  { key: "print", label: "Printing" },
  { key: "copy", label: "Copying text and images" },
  { key: "modify", label: "Changing the document" },
  { key: "annotate", label: "Adding comments and annotations" },
  { key: "fillForms", label: "Filling in forms" },
  {
    key: "accessibility",
    label: "Text extraction for accessibility",
    alwaysAllowed: ACCESSIBILITY_ALWAYS_ALLOWED,
  },
  { key: "assemble", label: "Inserting, rotating or deleting pages" },
] as const;

/** The labels of the switches that are off, in list order. */
export function restrictedLabels(permissions: PdfPermissions): string[] {
  return PDF_PERMISSIONS.filter((p) => !permissions[p.key]).map((p) => p.label);
}

/**
 * Protect PDF's permission switches — the one list the panel draws, the job
 * validator accepts, qpdf is given, and the output's /P bits are read against.
 *
 * A leaf (no imports) so a client component can draw the list and a worker can
 * check bits without pulling either side's dependencies.
 *
 * WHAT A PERMISSION IS, honestly. These are flags in the PDF's encryption
 * dictionary (ISO 32000-1 Table 22, the /P entry). A conforming reader honours
 * them; they are not access control. Anyone who knows the OWNER password can
 * lift them, which is why a restriction needs an owner password that differs
 * from the open password (with one password, opening the file IS owner
 * access in most readers, and the flags would bind nobody). Software that
 * ignores the flags can still print or copy — the page says so.
 */

/** One switch: its option key, the bit(s) it controls, and its words. */
export interface PdfPermissionInfo {
  key: PdfPermissionKey;
  /** 1-based bit positions in /P (ISO 32000-1 Table 22). */
  bits: readonly number[];
  label: string;
  /**
   * When set, this switch cannot be turned off, and this says why. Drawn
   * beside the (checked, inert) box; the validator refuses `false`.
   */
  alwaysAllowed?: string;
}

export const PDF_PERMISSION_KEYS = [
  "print",
  "copy",
  "modify",
  "annotate",
  "fillForms",
  "accessibility",
  "assemble",
] as const;
export type PdfPermissionKey = (typeof PDF_PERMISSION_KEYS)[number];

/** `true` = allowed. Every key present. */
export type PdfPermissions = Record<PdfPermissionKey, boolean>;

/** Today's behaviour, and the default: everything allowed. */
export const ALL_PERMISSIONS_ALLOWED: PdfPermissions = {
  print: true,
  copy: true,
  modify: true,
  annotate: true,
  fillForms: true,
  accessibility: true,
  assemble: true,
};

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
  // Bit 3 is printing; bit 12 is high-quality printing. Both or neither.
  { key: "print", bits: [3, 12], label: "Printing" },
  { key: "copy", bits: [5], label: "Copying text and images" },
  { key: "modify", bits: [4], label: "Changing the document" },
  { key: "annotate", bits: [6], label: "Adding comments and annotations" },
  { key: "fillForms", bits: [9], label: "Filling in forms" },
  {
    key: "accessibility",
    bits: [10],
    label: "Text extraction for accessibility",
    alwaysAllowed: ACCESSIBILITY_ALWAYS_ALLOWED,
  },
  {
    key: "assemble",
    bits: [11],
    label: "Inserting, rotating or deleting pages",
  },
] as const;

/** True when at least one switch is off. */
export function hasRestrictions(permissions: PdfPermissions): boolean {
  return PDF_PERMISSION_KEYS.some((key) => !permissions[key]);
}

/** The labels of the switches that are off, in list order. */
export function restrictedLabels(permissions: PdfPermissions): string[] {
  return PDF_PERMISSIONS.filter((p) => !permissions[p.key]).map((p) => p.label);
}

/**
 * What a /P value grants, per switch. A switch with two bits (print) is
 * allowed only when both are set. `p` is the signed 32-bit integer the file
 * stores.
 */
export function permissionsFromP(p: number): PdfPermissions {
  const bit = (n: number) => ((p >>> (n - 1)) & 1) === 1;
  const out = { ...ALL_PERMISSIONS_ALLOWED };
  for (const info of PDF_PERMISSIONS) out[info.key] = info.bits.every(bit);
  return out;
}

/** Keys whose granted value in `p` differs from `wanted`; empty = match. */
export function permissionMismatches(
  p: number,
  wanted: PdfPermissions,
): PdfPermissionKey[] {
  const got = permissionsFromP(p);
  return PDF_PERMISSION_KEYS.filter((key) => got[key] !== wanted[key]);
}

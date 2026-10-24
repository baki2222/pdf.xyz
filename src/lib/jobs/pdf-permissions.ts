/**
 * Protect PDF's permission switches as DATA — the keys the job validator
 * accepts, the /P bits qpdf writes for each, and the read-back of those bits.
 * The words for them (labels, why two cannot be turned off) live in
 * `./pdf-permission-labels`, so this module, which the job contract imports
 * and the tool-facts bundle therefore carries, stays a few hundred bytes.
 *
 * WHAT A PERMISSION IS, honestly. These are flags in the PDF's encryption
 * dictionary (ISO 32000-1 Table 22, the /P entry). A conforming reader honours
 * them; they are not access control. Anyone who knows the OWNER password can
 * lift them, which is why a restriction needs an owner password that differs
 * from the open password (with one password, opening the file IS owner
 * access in most readers, and the flags would bind nobody).
 */

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
 * The 1-based /P bit(s) each switch controls (ISO 32000-1 Table 22). Bit 3 is
 * printing and bit 12 high-quality printing: both or neither. Bit 6
 * (annotate) also grants form filling, and bit 10 (accessibility) cannot be
 * cleared under AES — the two rules the validator enforces.
 */
export const PDF_PERMISSION_BITS: Readonly<
  Record<PdfPermissionKey, readonly number[]>
> = {
  print: [3, 12],
  copy: [5],
  modify: [4],
  annotate: [6],
  fillForms: [9],
  accessibility: [10],
  assemble: [11],
};

/** True when at least one switch is off. */
export function hasRestrictions(permissions: PdfPermissions): boolean {
  return PDF_PERMISSION_KEYS.some((key) => !permissions[key]);
}

/**
 * What a /P value grants, per switch. A switch with two bits (print) is
 * allowed only when both are set. `p` is the signed 32-bit integer the file
 * stores.
 */
export function permissionsFromP(p: number): PdfPermissions {
  const bit = (n: number) => ((p >>> (n - 1)) & 1) === 1;
  const out = { ...ALL_PERMISSIONS_ALLOWED };
  for (const key of PDF_PERMISSION_KEYS)
    out[key] = PDF_PERMISSION_BITS[key].every(bit);
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

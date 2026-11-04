/**
 * Does an Office upload's CONTENT agree with its name — for the formats whose
 * bytes can say so?
 *
 * LibreOffice converts by content, not by name: a spreadsheet renamed
 * `essay.odt` is laid out as a spreadsheet and handed back as a PDF from Word
 * to PDF. For the Office Open XML and legacy formats that is the long-standing
 * behaviour and deliberate (a .doc that is really RTF, as Word itself once
 * saved them, still converts; `errors.ts` relies on it for a .doc renamed
 * .docx), because their first bytes cannot tell them apart: every .docx,
 * .xlsx and .pptx is the same ZIP signature, every .doc, .xls and .ppt the
 * same compound file.
 *
 * OpenDocument and RTF are different: an .odt, .ods or .odp stores its exact
 * type, uncompressed, as the first entry of its ZIP, and RTF begins `{\rtf`.
 * Those names are checkable, so they are checked — with the SAME recogniser
 * the site uses to say what a file is (`sniffFormat`), asked without the
 * name, so the bytes alone must name the format.
 *
 * Which extensions are checked is not typed from memory: `input-content.test.ts`
 * walks every extension the engine accepts, builds real leading bytes for it,
 * and holds that the checked set is EXACTLY the extensions whose bytes name
 * their format without help from the name.
 */
import { sniffFormat } from "@/lib/intent/sniff";
import type { FileFormat } from "@/lib/intent/formats";

/** The checked extensions, the format their bytes must name, and its noun. */
export const SIGNED_OFFICE_INPUTS: Readonly<
  Record<string, { readonly format: FileFormat; readonly noun: string }>
> = {
  odt: { format: "ODT", noun: "an OpenDocument text document" },
  ods: { format: "ODS", noun: "an OpenDocument spreadsheet" },
  odp: { format: "ODP", noun: "an OpenDocument presentation" },
  rtf: { format: "RTF", noun: "an RTF document" },
};

/** Enough leading bytes for every signature `sniffFormat` reads. */
const HEAD_BYTES = 4096;

/**
 * Null when the content may go to LibreOffice; otherwise the refusal to show.
 * `ext` is the lower-cased extension, without the dot.
 */
export function officeContentRefusal(
  ext: string,
  bytes: Uint8Array,
): string | null {
  const signed = SIGNED_OFFICE_INPUTS[ext];
  if (!signed) return null;
  if (sniffFormat(bytes.subarray(0, HEAD_BYTES)) === signed.format) return null;
  return `This file ends in .${ext}, but its contents are not ${signed.noun}. Open it in the program that made it, save it again as .${ext}, and try again.`;
}

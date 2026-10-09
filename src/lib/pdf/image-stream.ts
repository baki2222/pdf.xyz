import type { PDFRawStream } from "pdf-lib";
import type { PdfLibModule } from "./pdf-lib";

/**
 * What an XObject IS, asked of its dictionary — one definition for the two
 * readers that need it: Compress's image census (`analyze.ts`) and the file
 * probe behind a suggestion (`probe.ts`).
 *
 * A leaf on purpose. The probe ships in the chunk that reads a dropped file,
 * and `analyze.ts` imports the editing engine; sharing the predicate through
 * it would have carried that engine into every surface that only reads.
 * Type-only imports, so pdf-lib itself still loads behind `loadPdfLib`.
 */

function subtypeOf(lib: PdfLibModule, obj: unknown): string | null {
  if (!(obj instanceof lib.PDFRawStream)) return null;
  const subtype = obj.dict.get(lib.PDFName.of("Subtype"));
  return subtype instanceof lib.PDFName ? subtype.asString() : null;
}

/** An image XObject: a stream whose `/Subtype` is `/Image`. */
export function isImageStream(
  lib: PdfLibModule,
  obj: unknown,
): obj is PDFRawStream {
  return subtypeOf(lib, obj) === "/Image";
}

/** A Form XObject: a stream whose `/Subtype` is `/Form` — content of its own. */
export function isFormStream(
  lib: PdfLibModule,
  obj: unknown,
): obj is PDFRawStream {
  return subtypeOf(lib, obj) === "/Form";
}

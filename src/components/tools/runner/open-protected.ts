import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import { openProtectedPdf } from "@/lib/pdf/security/protected-pdf";
import {
  readPageBoard,
  type LoadedPdf,
  type PdfReader,
} from "./use-single-pdf";

/**
 * An encrypted PDF opened as a viewer opens it: with the empty password,
 * decrypted in the browser (`@/lib/pdf/security`). Null when the empty
 * password does not open it (it needs its open password) or its encryption
 * is one the handler does not read — the caller then refuses it as before,
 * in the probe's words.
 *
 * Its own chunk, fetched by `useSinglePdf` only for such a file, so no tool
 * page carries the handler, or this, in its first load.
 */
export async function openProtectedCopy(
  file: File,
  bytes: Uint8Array,
  reader: PdfReader,
  prepare?: () => Promise<void>,
): Promise<LoadedPdf | null> {
  try {
    const result = await openProtectedPdf(bytes);
    if (result.kind !== "opened") return null;
    const plain = result.pdf.plain;
    const [{ pageCount, rotations }] = await Promise.all([
      readPageBoard(plain, reader),
      prepare?.().catch(() => {}),
    ]);
    return {
      file,
      bytes: plain,
      pageCount,
      rotations,
      digitalSignatures: countDigitalSignatures(plain),
      protection: result.pdf,
    };
  } catch {
    return null;
  }
}

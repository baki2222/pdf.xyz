import { openHandler } from "@/lib/pdf/security/document";

/**
 * Does this encrypted PDF open with the EMPTY password — a viewer's
 * question, asked of the file's own encryption dictionary (the in-house
 * standard security handler, `@/lib/pdf/security`). Only the dictionary and
 * the key check are read: nothing is decrypted, written or lifted.
 *
 * Asked by the OCR runner only after OCRmyPDF refused the file as encrypted
 * (exit 8), to tell its author's restrictions from a password it needs
 * (audit ocr-pdf#4). `null`: not asked successfully — not encrypted after
 * all, damaged, or an encryption the handler does not read.
 */
export async function opensWithoutPassword(
  bytes: Uint8Array,
): Promise<boolean | null> {
  try {
    const { handler } = await openHandler(bytes, "");
    return handler !== null;
  } catch {
    return null;
  }
}

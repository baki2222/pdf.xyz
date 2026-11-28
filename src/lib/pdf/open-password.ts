/**
 * Does a typed password open this encrypted PDF? Asked in the browser by
 * Unlock PDF before it uploads anything (audit unlock-pdf#1), so a typo is
 * caught without the file or the password leaving the page.
 *
 * The check is our own Standard security handler (`./security/document`,
 * the reader `classifyPdfAccess`'s facts and the in-browser restricted-file
 * tools already use), which accepts the open password or the owner
 * password, as qpdf's `--decrypt` does. It only reads the /Encrypt
 * dictionary and derives the key; nothing is decrypted or kept.
 *
 * WHEN IT MAY SAY "WRONG". Only when the handler refused the password AND
 * the password is plain printable ASCII. For those characters every
 * encoding a PDF password can be read in (PDFDocEncoding, Latin-1, UTF-8,
 * and SASLprep for AES-256) gives the same bytes, so our handler and qpdf
 * must agree. For any other character qpdf tries more than one encoding and
 * ours may not, so a refusal there is "unknown" and the server decides: a
 * browser check that blocked a password qpdf accepts would stop someone
 * unlocking their own file. An encryption the handler does not read, or a
 * file it cannot parse, is "unknown" too. `open-password.test.ts` holds
 * each answer to a real encrypted fixture.
 */
export type OpenPasswordVerdict = "opens" | "wrong" | "unknown";

/** Printable ASCII only (space to tilde), and at least one character. */
export function isPlainAsciiPassword(password: string): boolean {
  return /^[\x20-\x7e]+$/.test(password);
}

export async function checkOpenPassword(
  bytes: Uint8Array,
  password: string,
): Promise<OpenPasswordVerdict> {
  try {
    const { openHandler } = await import("./security/document");
    const { handler } = await openHandler(bytes, password);
    if (handler) return "opens";
    return isPlainAsciiPassword(password) ? "wrong" : "unknown";
  } catch {
    return "unknown";
  }
}

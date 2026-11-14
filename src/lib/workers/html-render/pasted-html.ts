/**
 * Pasted HTML becomes a file, and this is the one place its bytes are made:
 * the paste box on the HTML to PDF page builds the upload with it, and
 * `zip-site.chromium.test.ts` renders exactly these bytes through a real
 * Chromium. A LEAF with no imports.
 *
 * WHY A BYTE-ORDER MARK. Pasted text is a JavaScript string, so its bytes
 * are UTF-8 by construction — but the HTML inside may still say otherwise
 * (`<meta charset="windows-1252">`, copied from an old page). The worker
 * leaves a file that declares its own charset to that declaration
 * (`htmlDocumentContentType`), which for pasted text would turn "বাংলা" or
 * "café" into mojibake. A UTF-8 BOM outranks every declaration, the HTTP
 * header included (WHATWG Encoding, "BOM sniff"), so the page reads as the
 * UTF-8 it is whatever it declares. The three bytes count toward the size
 * ceiling like any other: they are part of what is uploaded.
 */

/** The name a pasted page is uploaded under; its PDF is `pasted.pdf`. */
export const PASTED_HTML_FILENAME = "pasted.html";

const BOM = [0xef, 0xbb, 0xbf] as const;

/** The upload's size in bytes for `text`: the BOM plus its UTF-8, counted without encoding it. */
export function pastedHtmlByteLength(text: string): number {
  let bytes = BOM.length;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      i + 1 < text.length &&
      (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00
    ) {
      // A surrogate pair: one code point, four bytes.
      bytes += 4;
      i += 1;
    } else bytes += 3; // a lone surrogate encodes as U+FFFD, three bytes
  }
  return bytes;
}

/** The bytes uploaded for pasted `text`: a UTF-8 BOM, then the text as UTF-8. */
export function pastedHtmlBytes(text: string): Uint8Array {
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(BOM.length + body.length);
  out.set(BOM, 0);
  out.set(body, BOM.length);
  return out;
}

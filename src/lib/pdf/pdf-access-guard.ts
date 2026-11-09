import type { PdfAccess } from "./encryption";
import { PdfEngineError } from "./engine-errors";
import { awaitPdfjsDocument } from "./pdfjs";
import { preflightPdfjsOpen } from "./pdfjs-guard";
import { prescanXref } from "./xref-prescan";

/**
 * The checks around {@link classifyPdfAccess}'s pdf.js open (lane l02 of the
 * hostile-input matrix), in their own chunk: `./encryption` ships in the first
 * load of every tool page, and none of this is needed until a file is
 * classified. `./encryption` reaches it by `import()`, beside `./pdfjs`.
 *
 * pdf.js is the reader whose verdict a person sees, so it stays the judge of
 * "what opens". These checks only stop it being asked a question it cannot
 * answer in bounded time, and stop four unchecked values from being read as a
 * verdict:
 *  - a hostile structure it would loop on (zero-width xref rows) or a key
 *    length it would spend minutes on (SIB-03, SIB-06): refused before it is
 *    asked, and every open has a deadline besides;
 *  - a page count that is not a positive integer (SIB-08);
 *  - a trailer /Encrypt pdf.js could not resolve, read as "no encryption"
 *    (SIB-09);
 *  - a structural failure pdf.js reports as a password refusal (SIB-15).
 */

export { awaitPdfjsDocument, preflightPdfjsOpen };

/**
 * Did the stream preflight refuse the file? Its refusals are typed
 * (`PdfEngineError`: an xref pdf.js would walk past every bound, a stream that
 * inflates past the memory bounds, content nested or worked past the `q`
 * bounds). Anything else it throws is a failure of the scan itself (a
 * missing `DecompressionStream`, say), not a fact about the file, and the
 * probe then asks pdf.js as it did before lane res1.
 */
export function isPreflightRefusal(err: unknown): boolean {
  return err instanceof PdfEngineError;
}

/**
 * How long a viewer-style open may take before the probe says "unreadable".
 * Real files open in well under a second (the legit corpus: 14 to 160 ms
 * each in Node); 30 s covers a 100 MB upload whose xref pdf.js must rebuild
 * by scanning, on a slow phone, with a wide margin, and still ends a
 * hostile file's spinner. In the browser pdf.js runs in a Web Worker, so the
 * timer fires even while it loops; under Node's fake worker a synchronous
 * loop blocks the timer, which is why the structural checks below come first.
 */
export const ACCESS_DEADLINE_MS = 30_000;

/**
 * The deadline passed. Its message is for logs only: {@link refusedVerdict}
 * turns it into "unreadable", and no reader is shown it.
 */
export class AccessDeadlineError extends Error {
  constructor(ms: number) {
    super(`deadline ${ms} ms`);
    this.name = "AccessDeadlineError";
  }
}

/** `work`, or a rejection once `ms` have passed. */
export async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AccessDeadlineError(ms)), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** What the file says about itself before pdf.js is asked. */
export interface AccessFacts {
  /** A structure no reader can open in bounded time: answer "unreadable". */
  readonly refuse: boolean;
  /** The trailer (table or xref-stream dictionary) carries an /Encrypt key. */
  readonly namesEncrypt: boolean;
  /**
   * Our own Standard handler opens the file with the empty password: true,
   * false, or `null` when it could not tell (a handler it does not read, a
   * cross-reference it could not follow).
   */
  readonly emptyPasswordOpens: boolean | null;
}

/**
 * Read the facts. Never throws. Our own reader (`./security/document`, its
 * own chunk) is loaded only for a file whose trailer names /Encrypt.
 */
export async function readAccessFacts(bytes: Uint8Array): Promise<AccessFacts> {
  // SIB-03: rows zero bytes wide read nothing, so pdf.js walks the /Index
  // count (2^31 in the hostile file) and runs out of memory. SIB-09: the
  // trailer pdf.js decrypts with, not every `trailer` in the file (an
  // attachment stored unfiltered may hold another PDF's). `./xref-prescan`
  // reads both the way pdf.js does.
  const { unbounded: zeroWidth, namesEncrypt } = prescanXref(bytes);
  if (zeroWidth || !namesEncrypt)
    return { refuse: zeroWidth, namesEncrypt, emptyPasswordOpens: null };
  try {
    const { openHandler } = await import("./security/document");
    const { handler, params } = await openHandler(bytes, "");
    // SIB-06: pdf.js derives a key of /Length / 8 bytes and hashes it 50
    // times, so /Length 1e9 costs it minutes. The Standard handler's largest
    // key is 256 bits (ISO 32000-2 §7.6.4); pdf.js already refuses below 40.
    if (params.lengthBits > 256)
      return { refuse: true, namesEncrypt, emptyPasswordOpens: null };
    return {
      refuse: false,
      namesEncrypt,
      emptyPasswordOpens: handler !== null,
    };
  } catch {
    return { refuse: false, namesEncrypt, emptyPasswordOpens: null };
  }
}

/** The verdict for a file pdf.js opened. */
export function openedVerdict(
  numPages: number,
  encryptFilter: unknown,
  facts: AccessFacts,
): PdfAccess {
  const decrypting = encryptFilter !== null && encryptFilter !== undefined;
  // SIB-09: the trailer names /Encrypt and pdf.js is not decrypting — it
  // dropped an /Encrypt it could not resolve, and reads ciphertext as content.
  if (!decrypting && facts.namesEncrypt) return { kind: "unreadable" };
  const counted = Number.isInteger(numPages) && numPages >= 1;
  if (!decrypting) return { kind: "unencrypted", pageCount: numPages };
  // SIB-08: /Count -1 or 0 is not a page count a person can be shown.
  return counted
    ? { kind: "restricted", pageCount: numPages }
    : { kind: "unreadable" };
}

/**
 * Did the open fail for want of a password? Asked of the ENGINE's error:
 * `awaitPdfjsDocument` turns pdf.js's `PasswordException` into the engine's
 * encrypted error with a `needs-password` verdict. The raw name is still
 * recognised, for a pdf.js error that reaches here untranslated.
 */
function isPasswordRefusal(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { name, verdict } = err as { name?: unknown; verdict?: unknown };
  return name === "PasswordException" || verdict === "needs-password";
}

/** The verdict for a file pdf.js refused (or that ran out of time). */
export function refusedVerdict(err: unknown, facts: AccessFacts): PdfAccess {
  if (!isPasswordRefusal(err)) return { kind: "unreadable" };
  // SIB-15: pdf.js raises a PasswordException when a damaged object stream
  // hides the catalog; the empty password opening the file says otherwise.
  return facts.emptyPasswordOpens === true
    ? { kind: "unreadable" }
    : { kind: "password-required" };
}

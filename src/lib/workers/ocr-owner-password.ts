import { openHandler } from "@/lib/pdf/security/document";
import type {
  CryptMethod,
  EncryptParams,
} from "@/lib/pdf/security/standard-handler";
import {
  QPDF_GRANT_KEYS,
  qpdfGrantFromP,
  type QpdfGrant,
} from "./pdf-security/permission-bits";

/**
 * OCR PDF on a restricted PDF, with its owner password (competitor-audit
 * backlog #11, 2026-11-17): the two questions the worker asks the file's OWN
 * encryption dictionary, before and after, with the in-house standard
 * security handler (`@/lib/pdf/security/standard-handler`, the one the
 * browser's owner-password field asks, and `./ocr-encryption-probe` asks
 * after OCRmyPDF's exit 8). Node-free; nothing here decrypts a page.
 *
 * THE RULE (owner decision, the browser's `openForCopy`): only the OWNER
 * password lifts the author's restrictions, and here it does not even lift
 * them — the searchable copy carries them again. A password that is not the
 * owner's, an empty one, or a file that needs a password to open, never
 * reaches the decrypt. qpdf decrypts a restricted file with NO password at
 * all, so this check, not qpdf, is what holds the rule; the runner calls it
 * before qpdf is started (`./ocr-native`).
 *
 * BEFORE ({@link checkOwnerPassword}): opens with no password, AND the typed
 * password authenticates as the owner — and what the author grants.
 *
 * AFTER ({@link restrictedLike}): what qpdf wrote opens with no password,
 * the empty password is NOT its owner password, the typed one IS, its grant
 * is the original's switch for switch, and its cipher is at least as strong
 * as the original's. A copy that fails any of these is not delivered.
 */

/** What the uploaded file says about a typed owner password. */
export type OwnerPasswordCheck =
  /** Opens with no password, and this is its owner password. */
  | {
      kind: "owner";
      /** What the author grants without the owner password. */
      grant: QpdfGrant;
      /** {@link cipherStrength} of the original. */
      strength: number;
    }
  /** No viewer opens it without a password: today's refusal stands. */
  | { kind: "needs-open-password" }
  /** It opens without one, and this is not its owner password. */
  | { kind: "wrong-password" }
  /**
   * The handler could not read it: not encrypted, damaged, or an encryption
   * it does not read. Nothing is decrypted; OCRmyPDF itself refuses any
   * encrypted input (exit 8), so this can never lift a restriction.
   */
  | { kind: "not-read" };

/** A cipher's strength, for "at least as strong": RC4 by key length, then AES. */
function methodStrength(method: CryptMethod, lengthBits: number): number {
  switch (method) {
    case "aesv3":
      return 256;
    case "aesv2":
      // AES-128 outranks RC4 at any length the standard allows (≤ 128).
      return 129;
    case "rc4":
      return lengthBits;
    case "identity":
      return 0;
  }
}

/** The weaker of a file's string and stream ciphers. */
export function cipherStrength(params: EncryptParams): number {
  return Math.min(
    methodStrength(params.stream, params.lengthBits),
    methodStrength(params.string, params.lengthBits),
  );
}

/**
 * Is `password` the owner password of a PDF that opens without one? The
 * empty password is never one: a file whose owner password is empty opens
 * "as owner" for anyone, and that is not a person proving it.
 */
export async function checkOwnerPassword(
  bytes: Uint8Array,
  password: string,
): Promise<OwnerPasswordCheck> {
  if (password === "") return { kind: "wrong-password" };
  let free: Awaited<ReturnType<typeof openHandler>>;
  let typed: Awaited<ReturnType<typeof openHandler>>;
  try {
    free = await openHandler(bytes, "");
    if (!free.handler) return { kind: "needs-open-password" };
    typed = await openHandler(bytes, password);
  } catch {
    return { kind: "not-read" };
  }
  if (typed.handler?.authenticatedAs !== "owner")
    return { kind: "wrong-password" };
  return {
    kind: "owner",
    // The grant a viewer applies: /P after the /Perms cross-check, so a
    // tampered /P never widens the copy's grant.
    grant: qpdfGrantFromP(free.handler.effectiveP, free.params.r),
    strength: cipherStrength(free.params),
  };
}

/**
 * The switches the copy must match exactly. Accessibility is the one left
 * out: the copy is AES-256 (R6), and PDF 2.0 deprecates bit 10 — readers
 * ignore it and writers set it (ISO 32000-2, Table 22), and qpdf ignores
 * `--accessibility` for AES-256 — so {@link restrictedLike} requires it SET.
 */
export const OWNER_GRANT_KEPT_KEYS = QPDF_GRANT_KEYS.filter(
  (key) => key !== "accessibility",
);

/**
 * Is `output` restricted exactly like the original: opens with no
 * password, the empty password is not its owner's, `password` is, every
 * kept switch equals `grant`, and its cipher is at least `strength`?
 * Never throws: an unreadable output is not restricted like anything.
 */
export async function restrictedLike(
  output: Uint8Array,
  grant: QpdfGrant,
  password: string,
  strength: number,
): Promise<boolean> {
  try {
    const free = await openHandler(output, "");
    if (free.handler?.authenticatedAs !== "user") return false;
    const owner = await openHandler(output, password);
    if (owner.handler?.authenticatedAs !== "owner") return false;
    if (cipherStrength(free.params) < strength) return false;
    const got = qpdfGrantFromP(free.handler.effectiveP, free.params.r);
    if (!got.accessibility) return false;
    return OWNER_GRANT_KEPT_KEYS.every((key) => got[key] === grant[key]);
  } catch {
    return false;
  }
}

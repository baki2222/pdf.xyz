import type { ImageSignature } from "@/lib/pdf/signature";
import type { SignatureStyle } from "@/lib/pdf/offered-kinds";

/**
 * Signatures a person chose to keep, in THIS browser's localStorage only.
 *
 * Opt-in: nothing is written unless "Save for next time" was ticked when the
 * signature was used. Nothing here is sent anywhere — no request is made
 * with it, and it never leaves the device; deleting it in the panel removes
 * it. Storage can be unavailable (a private window, blocked site data) or
 * full, so every read and write is wrapped and fails to "nothing saved"
 * rather than breaking the editor — and since 2026-11-06 (audit #50) a save
 * that did not happen SAYS so: `saveSignature` reports whether it kept the
 * signature, and the list it returns is what storage actually holds. Until
 * then a refused write still returned (and the panel showed) the new
 * signature, gone on the next visit, and an over-size picture was dropped
 * without a word.
 */

export const SAVED_SIGNATURES_KEY = "pdfxyz.saved-signatures";
/** At most this many are kept; the oldest goes first. */
export const MAX_SAVED_SIGNATURES = 5;
/** A picture larger than this (as a data URL) is not kept. */
const MAX_DATA_URL_CHARS = 600_000;

export type SavedSignature =
  | { id: string; kind: "typed"; text: string; style: SignatureStyle }
  | { id: string; kind: "image"; format: "png" | "jpg"; dataUrl: string };

type ToSave =
  | { kind: "typed"; text: string; style: SignatureStyle }
  | { kind: "image"; sig: ImageSignature };

/** localStorage, or undefined where even reaching it throws. */
function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isSaved(value: unknown): value is SavedSignature {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string") return false;
  if (v.kind === "typed")
    return (
      typeof v.text === "string" &&
      (v.style === "signature" || v.style === "print")
    );
  return (
    v.kind === "image" &&
    (v.format === "png" || v.format === "jpg") &&
    typeof v.dataUrl === "string" &&
    v.dataUrl.startsWith("data:image/")
  );
}

export function readSavedSignatures(
  storage: Storage | undefined = browserStorage(),
): SavedSignature[] {
  try {
    const raw = storage?.getItem(SAVED_SIGNATURES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSaved) : [];
  } catch {
    return [];
  }
}

/** True when `list` is now what storage holds. */
function write(list: SavedSignature[], storage: Storage | undefined): boolean {
  if (!storage) return false;
  try {
    if (list.length === 0) storage.removeItem(SAVED_SIGNATURES_KEY);
    else storage.setItem(SAVED_SIGNATURES_KEY, JSON.stringify(list));
    return true;
  } catch {
    // Full or blocked: the signature is still used, just not remembered.
    return false;
  }
}

/** Why a signature was not kept. */
export type NotSavedReason = "too_large" | "storage";

/** What `saveSignature` did: the stored list, and whether the new one is in it. */
export type SaveResult =
  | { readonly kept: true; readonly list: SavedSignature[] }
  | {
      readonly kept: false;
      readonly reason: NotSavedReason;
      readonly list: SavedSignature[];
    };

function toDataUrl(sig: ImageSignature): string {
  let binary = "";
  for (let i = 0; i < sig.bytes.length; i += 1) {
    binary += String.fromCharCode(sig.bytes[i]!);
  }
  const mime = sig.format === "png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${btoa(binary)}`;
}

/** The bytes inside a base64 data URL we wrote, or null. */
export function bytesOfDataUrl(url: string): Uint8Array | null {
  try {
    const comma = url.indexOf(",");
    if (comma < 0) return null;
    const binary = atob(url.slice(comma + 1));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

let counter = 0;

/**
 * Keep `entry` (newest first, no duplicates). Returns the list storage now
 * holds, and whether `entry` is in it.
 */
export function saveSignature(
  entry: ToSave,
  storage: Storage | undefined = browserStorage(),
): SaveResult {
  const list = readSavedSignatures(storage);
  counter += 1;
  const id = `s${Date.now().toString(36)}${counter}`;
  let next: SavedSignature;
  if (entry.kind === "typed") {
    next = { id, kind: "typed", text: entry.text, style: entry.style };
  } else {
    const dataUrl = toDataUrl(entry.sig);
    if (dataUrl.length > MAX_DATA_URL_CHARS)
      return { kept: false, reason: "too_large", list };
    next = { id, kind: "image", format: entry.sig.format, dataUrl };
  }
  const same = (s: SavedSignature) =>
    s.kind === next.kind &&
    (s.kind === "typed"
      ? next.kind === "typed" && s.text === next.text && s.style === next.style
      : next.kind === "image" && s.dataUrl === next.dataUrl);
  const updated = [next, ...list.filter((s) => !same(s))].slice(
    0,
    MAX_SAVED_SIGNATURES,
  );
  if (!write(updated, storage)) return { kept: false, reason: "storage", list };
  return { kept: true, list: updated };
}

export function forgetSignature(
  id: string,
  storage: Storage | undefined = browserStorage(),
): SavedSignature[] {
  const updated = readSavedSignatures(storage).filter((s) => s.id !== id);
  write(updated, storage);
  return updated;
}

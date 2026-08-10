/**
 * The **ClamAV/clamd wire protocol**, as pure, node-free functions.
 *
 * This module knows how to *frame a request* and *classify a reply* for the two
 * clamd commands the scanner uses — `INSTREAM` (scan bytes streamed over the
 * connection) and `PING` (liveness) — and nothing else. It performs no I/O: it
 * turns bytes into request buffers and reply buffers into a small, typed,
 * **content-free** verdict enum, so every branch is unit-tested deterministically
 * with no socket, no daemon, and no network.
 *
 * Protocol notes (clamd, INSTREAM):
 *  - commands are sent NUL-terminated using the `z` prefix (`zINSTREAM\0`), which
 *    makes clamd reply with a single NUL-terminated line — easy to frame safely
 *    without newline ambiguity or command injection;
 *  - the stream is a sequence of chunks, each `<uint32 big-endian length><bytes>`,
 *    terminated by a zero-length chunk (`\0\0\0\0`);
 *  - the reply is one of `stream: OK`, `stream: <SIGNATURE> FOUND`, an
 *    `INSTREAM size limit exceeded` error, or another `... ERROR`.
 *
 * Honesty & privacy: {@link parseInstreamReply} deliberately returns ONLY a kind —
 * it never surfaces the signature name, the raw reply text, or any bytes — so a
 * caller physically cannot log a detection signature or file content. Nothing here
 * reads a filename, key, endpoint, or secret; it only ever sees raw bytes and the
 * daemon's short status line.
 */

/** Default INSTREAM frame size (64 KiB) — a safe, standard chunk under clamd limits. */
export const CLAMAV_DEFAULT_CHUNK_SIZE = 65536;

/** clamd rejects any single INSTREAM chunk larger than this; we always stay well under. */
const CLAMAV_MAX_CHUNK_SIZE = 131072; // clamd's StreamMaxLength floor is far higher; 128 KiB frames are safe.

/** Encode an ASCII command string (commands are ASCII-only) to bytes. Node-free. */
function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** Decode a reply (ASCII status line) to a string without Node's Buffer. */
function toText(raw: Uint8Array | string): string {
  if (typeof raw === "string") return raw;
  let text = "";
  for (let i = 0; i < raw.length; i++) text += String.fromCharCode(raw[i]!);
  return text;
}

/** The NUL-terminated `zPING` command; clamd answers `PONG`. */
export const CLAMAV_PING_REQUEST: Uint8Array = ascii("zPING\0");

/** The NUL-terminated `zVERSION` command; the answer is presence-only (never logged). */
export const CLAMAV_VERSION_REQUEST: Uint8Array = ascii("zVERSION\0");

/**
 * Build a complete `zINSTREAM` request for `bytes`: the NUL-terminated command,
 * the bytes split into length-prefixed frames, and the zero-length terminator.
 * Pure — returns one contiguous buffer the transport writes verbatim. `chunkSize`
 * is clamped to a safe frame size so a caller can never emit an over-limit frame.
 */
export function buildInstreamRequest(
  bytes: Uint8Array,
  chunkSize: number = CLAMAV_DEFAULT_CHUNK_SIZE,
): Uint8Array {
  const frame = Math.max(
    1,
    Math.min(
      Math.floor(chunkSize) || CLAMAV_DEFAULT_CHUNK_SIZE,
      CLAMAV_MAX_CHUNK_SIZE,
    ),
  );
  const header = ascii("zINSTREAM\0");
  const chunkCount = Math.ceil(bytes.length / frame);
  // header + for each chunk (4-byte length prefix + data) + 4-byte zero terminator.
  const total = header.length + bytes.length + chunkCount * 4 + 4;
  const out = new Uint8Array(total);
  let offset = 0;
  out.set(header, offset);
  offset += header.length;
  for (let start = 0; start < bytes.length; start += frame) {
    const end = Math.min(start + frame, bytes.length);
    const len = end - start;
    // uint32 big-endian length prefix.
    out[offset++] = (len >>> 24) & 0xff;
    out[offset++] = (len >>> 16) & 0xff;
    out[offset++] = (len >>> 8) & 0xff;
    out[offset++] = len & 0xff;
    out.set(bytes.subarray(start, end), offset);
    offset += len;
  }
  // Zero-length terminating chunk (already zeroed by the Uint8Array initializer).
  offset += 4;
  return out;
}

/**
 * A content-free classification of a clamd INSTREAM reply:
 *  - `clean`       — `stream: OK` (no threat);
 *  - `infected`    — `... FOUND` (a threat; the signature name is intentionally dropped);
 *  - `size-limit`  — the input exceeded clamd's stream size limit (terminal for this input);
 *  - `error`       — clamd returned another `... ERROR` (transient/operational);
 *  - `unparseable` — the reply matched no known shape (treated like a transient error).
 */
export type ClamavReplyKind =
  "clean" | "infected" | "size-limit" | "error" | "unparseable";

/**
 * Classify a raw clamd INSTREAM reply into a {@link ClamavReplyKind}. Returns ONLY
 * the kind — never the signature name or reply text — so a detection can never leak
 * into a log or error. Trailing NULs/whitespace are stripped; matching is
 * case-insensitive on the daemon's fixed status tokens.
 */
export function parseInstreamReply(raw: Uint8Array | string): ClamavReplyKind {
  const text = toText(raw).replace(/\0/g, "").trim();
  if (text.length === 0) return "unparseable";
  const upper = text.toUpperCase();
  // Order matters: a `FOUND` line names a signature we must not inspect further, and
  // the size-limit error must be recognized before the generic `ERROR` bucket.
  if (upper.endsWith("FOUND")) return "infected";
  if (upper.includes("SIZE LIMIT EXCEEDED")) return "size-limit";
  if (upper.endsWith("ERROR")) return "error";
  if (upper.endsWith("OK")) return "clean";
  return "unparseable";
}

/** True when a clamd reply to `PING` is the expected `PONG` (presence-only liveness). */
export function isPong(raw: Uint8Array | string): boolean {
  return toText(raw).replace(/\0/g, "").trim().toUpperCase() === "PONG";
}

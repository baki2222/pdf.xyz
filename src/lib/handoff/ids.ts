/**
 * Opaque handoff-id generation. Ids are unguessable tokens that double as the
 * IndexedDB primary key and the `?handoff=` URL parameter, so they must be
 * URL-safe and collision-resistant. A random UUID (secure contexts) is
 * preferred; robust fallbacks keep this working in odd runtimes and tests.
 */

const PREFIX = "h_";

/** URL-safe token from crypto random bytes, or null if crypto is unavailable. */
function randomToken(): string | null {
  try {
    if (typeof crypto !== "undefined") {
      if (typeof crypto.randomUUID === "function") {
        return crypto.randomUUID().replace(/-/g, "");
      }
      if (typeof crypto.getRandomValues === "function") {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        let hex = "";
        for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
        return hex;
      }
    }
  } catch {
    // Secure-context-only APIs can throw; fall through to the last resort.
  }
  return null;
}

/**
 * Generate a fresh handoff id. Uses crypto where available; the Math.random
 * fallback is only reached in environments without Web Crypto and never needs
 * to be cryptographically strong — the token merely names an in-browser,
 * single-use, short-lived record that only this origin can read.
 */
export function newHandoffId(): string {
  const token =
    randomToken() ??
    `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `${PREFIX}${token}`;
}

/** Cheap shape check for an id read from an untrusted URL parameter. */
export function looksLikeHandoffId(value: string): boolean {
  return (
    value.startsWith(PREFIX) &&
    value.length > PREFIX.length &&
    value.length <= 80
  );
}

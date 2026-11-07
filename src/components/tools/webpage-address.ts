import {
  isInternalHostname,
  isIpLiteral,
  normalizeHost,
} from "@/lib/net/public-address";

/**
 * Webpage to PDF's address field, read the way a person types it — before
 * any job is created (audit #33, 2026-11-06).
 *
 * The field starts with "https://", and until this module only its LENGTH
 * was checked: a full link pasted after the prefix (`https://https://…`) or
 * a bare `example.com` was sent, and came back as the API's developer
 * message, which blames localhost and private hosts for a typo.
 *
 * Client-safe on purpose: it reads the same classifier as the server's
 * `isSafePublicHttpUrl` (`@/lib/net/public-address`), never the validator
 * module itself, which would carry the whole tool catalog into the page.
 * `webpage-address.test.ts` pins that the two accept the same addresses.
 */

/** The field's starting value. */
export const WEBPAGE_ADDRESS_PREFIX = "https://";

const SCHEME = /^https?:\/\//i;

/**
 * Repeated leading schemes collapse to the LAST one — the link the user
 * pasted after the prefix is the one they meant. Safe on every keystroke.
 */
export function collapseRepeatedScheme(raw: string): string {
  const match = /^(?:https?:\/\/)+/i.exec(raw.trimStart());
  if (!match) return raw;
  const schemes = match[0].match(/https?:\/\//gi)!;
  if (schemes.length < 2) return raw;
  return schemes[schemes.length - 1]! + raw.trimStart().slice(match[0].length);
}

/** Anything that starts the way a scheme does: `mailto:`, `ftp://`, `x:`. */
const SCHEME_LIKE = /^[a-z][a-z0-9+.-]*:/i;
/**
 * A host followed by a port (`localhost:3000`, `example.com:8080/a`), which
 * {@link SCHEME_LIKE} also matches: what follows the colon is digits, then
 * the end or the path.
 */
const HOST_AND_PORT = /^[^:/?#]+:\d+(?:[/?#]|$)/;

/**
 * The address a job is sent with: trimmed, one scheme, and `https://` in
 * front of a scheme-less address — a dotted host (`example.com/page`), a
 * host with a port (`localhost:3000`), `localhost`, or a bracketed IPv6
 * address — so the check names what is wrong with the HOST. Anything that
 * names another scheme, with or without `//` (`ftp://…`, `mailto:…`,
 * `javascript:…`), is left as typed, for the check to refuse as a scheme.
 * `webpage-address.test.ts` pins both, through the check's own words.
 */
export function normalizeWebpageAddress(raw: string): string {
  const value = collapseRepeatedScheme(raw.trim()).trim();
  if (value === "" || SCHEME.test(value) || /\s/.test(value)) return value;
  if (SCHEME_LIKE.test(value) && !HOST_AND_PORT.test(value)) return value;
  const host = value.split(/[/?#]/, 1)[0]!.replace(/:\d+$/, "");
  return host.includes(".") ||
    host.toLowerCase() === "localhost" ||
    /^\[[0-9a-f:.]+\]$/i.test(host)
    ? WEBPAGE_ADDRESS_PREFIX + value
    : value;
}

/**
 * Why a normalized address cannot be sent, in plain words — or null when it
 * can. Null exactly when `isSafePublicHttpUrl` accepts it.
 */
export function webpageAddressProblem(address: string): string | null {
  if (address === "" || address.toLowerCase() === WEBPAGE_ADDRESS_PREFIX)
    return "Type the page's address first.";
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return "That is not a web address. Type one such as https://example.com.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return "Only http:// and https:// addresses can be opened.";
  if (url.username || url.password)
    return "Leave out the user name and password: the address cannot carry them.";
  if (!isInternalHostname(url.hostname)) return null;
  const host = normalizeHost(url.hostname);
  if (!host.includes(".") && !isIpLiteral(host) && host !== "localhost")
    return "Type the full address, such as https://example.com.";
  return "That address is not on the public internet (such as localhost or a private network), so our server cannot open it.";
}

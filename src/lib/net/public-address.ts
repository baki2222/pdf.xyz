/**
 * Is this address somewhere on the public internet?
 *
 * One classifier, two callers: the edge's early URL check
 * (`isSafePublicHttpUrl`) and the worker's renderer, which applies it to every
 * address DNS actually returns for every request Chromium makes. They must
 * agree, and the only way two checks agree for good is to be the same code.
 *
 * WHY NUMERIC RANGES AND NOT STRING PREFIXES. The previous guard matched host
 * strings (`/^127\./`, `host === "[::1]"`), and every one of these walked past
 * it: `localhost.` (a trailing dot defeats equality), `[::ffff:127.0.0.1]`
 * (only `[::1]` was spelled), `[::]`, `[fd00::1]`, `100.100.100.200` (CGNAT —
 * not on the list at all). An address has one value and many spellings; a
 * check over spellings is a check over the ones its author thought of.
 *
 * Pure TypeScript, no `node:net`, so it is safe in any bundle that imports the
 * job validator.
 */

/** A CIDR range this module refuses, with why — the `why` is for the reader. */
export interface BlockedRange {
  cidr: string;
  why: string;
}

/**
 * Every IPv4 range that is not ordinary public unicast (IANA special-purpose
 * registry, plus multicast and reserved space). Exported so the test can prove
 * each entry catches at least one real bypass — a range nothing exercises is
 * decoration (CLAUDE.md, guards rule 1).
 */
export const BLOCKED_IPV4_RANGES: readonly BlockedRange[] = [
  { cidr: "0.0.0.0/8", why: "this network; 0.0.0.0 connects to the host" },
  { cidr: "10.0.0.0/8", why: "RFC 1918 private" },
  { cidr: "100.64.0.0/10", why: "CGNAT shared space (and some metadata IPs)" },
  { cidr: "127.0.0.0/8", why: "loopback" },
  { cidr: "169.254.0.0/16", why: "link-local; cloud metadata endpoints" },
  { cidr: "172.16.0.0/12", why: "RFC 1918 private" },
  { cidr: "192.0.0.0/24", why: "IETF protocol assignments" },
  { cidr: "192.0.2.0/24", why: "TEST-NET-1 documentation" },
  { cidr: "192.88.99.0/24", why: "deprecated 6to4 relay anycast" },
  { cidr: "192.168.0.0/16", why: "RFC 1918 private" },
  { cidr: "198.18.0.0/15", why: "benchmarking" },
  { cidr: "198.51.100.0/24", why: "TEST-NET-2 documentation" },
  { cidr: "203.0.113.0/24", why: "TEST-NET-3 documentation" },
  { cidr: "224.0.0.0/4", why: "multicast" },
  { cidr: "240.0.0.0/4", why: "reserved, incl. 255.255.255.255 broadcast" },
];

/**
 * IPv6 is allowlisted rather than blocklisted: only global unicast 2000::/3 can
 * be public, so everything outside it (`::`, `::1`, fc00::/7, fe80::/10,
 * ff00::/8, 100::/64 …) is refused by construction. These are the carve-outs
 * INSIDE 2000::/3 that are still not public.
 */
export const BLOCKED_IPV6_RANGES: readonly BlockedRange[] = [
  { cidr: "2001::/23", why: "IETF protocol assignments, incl. Teredo" },
  { cidr: "2001:db8::/32", why: "documentation" },
  { cidr: "2002::/16", why: "6to4 — embeds an arbitrary IPv4 address" },
  { cidr: "3fff::/20", why: "documentation (RFC 9637)" },
];

/**
 * IPv6 ranges that carry an IPv4 address in their low 32 bits and are routed
 * to it. They are judged by the IPv4 address they carry, so
 * `::ffff:169.254.169.254` is exactly as blocked as `169.254.169.254`.
 */
const EMBEDDED_IPV4_PREFIXES: readonly string[] = [
  "::ffff:0:0/96", // IPv4-mapped
  "64:ff9b::/96", // NAT64 well-known prefix
];

const GLOBAL_UNICAST_V6 = "2000::/3";

// ───────────────────────────────── parsing ──────────────────────────────────

/** Canonical dotted-quad IPv4 → uint32, or null. */
export function parseIpv4(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** IPv6 text (optionally bracketed, optionally with an IPv4 tail) → 128-bit. */
export function parseIpv6(text: string): bigint | null {
  let s = text;
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  if (s.includes("%")) return null; // zone ids are link-local by definition
  if (!s.includes(":")) return null;

  // An IPv4 tail (`::ffff:127.0.0.1`) is two hex groups spelled differently.
  const lastColon = s.lastIndexOf(":");
  const maybeV4 = s.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const v4 = parseIpv4(maybeV4);
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const groupsOf = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
      groups.push(parseInt(g, 16));
    }
    return groups;
  };
  const head = groupsOf(halves[0] ?? "");
  const rest = halves.length === 2 ? groupsOf(halves[1] ?? "") : [];
  if (head === null || rest === null) return null;

  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null; // "::" stands for at least one zero group
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const g of groups) value = (value << 16n) | BigInt(g);
  return value;
}

interface ParsedRange {
  family: 4 | 6;
  base: bigint;
  bits: number;
}

function parseCidr(cidr: string): ParsedRange {
  const [addr, len] = cidr.split("/");
  const bits = Number(len);
  const v4 = parseIpv4(addr ?? "");
  if (v4 !== null) return { family: 4, base: BigInt(v4), bits };
  const v6 = parseIpv6(addr ?? "");
  if (v6 === null) throw new Error(`unparseable CIDR ${cidr}`);
  return { family: 6, base: v6, bits };
}

function inRange(value: bigint, range: ParsedRange): boolean {
  const width = range.family === 4 ? 32 : 128;
  const shift = BigInt(width - range.bits);
  return value >> shift === range.base >> shift;
}

const V4_BLOCKS = BLOCKED_IPV4_RANGES.map((r) => parseCidr(r.cidr));
const V6_BLOCKS = BLOCKED_IPV6_RANGES.map((r) => parseCidr(r.cidr));
const V6_EMBEDDED = EMBEDDED_IPV4_PREFIXES.map(parseCidr);
const V6_GLOBAL = parseCidr(GLOBAL_UNICAST_V6);

// ─────────────────────────────── classifying ────────────────────────────────

/** The blocked range an address falls in, or null if it is public. */
export function blockedRangeFor(address: string): BlockedRange | null {
  const v4 = parseIpv4(address);
  if (v4 !== null) {
    const i = V4_BLOCKS.findIndex((r) => inRange(BigInt(v4), r));
    return i >= 0 ? BLOCKED_IPV4_RANGES[i]! : null;
  }
  const v6 = parseIpv6(address);
  if (v6 === null) return { cidr: "unparseable", why: "not an IP address" };
  for (const prefix of V6_EMBEDDED) {
    if (inRange(v6, prefix)) {
      const embedded = Number(v6 & 0xffffffffn);
      const dotted = [24, 16, 8, 0].map((s) => (embedded >>> s) & 255);
      return blockedRangeFor(dotted.join("."));
    }
  }
  if (!inRange(v6, V6_GLOBAL))
    return { cidr: "outside 2000::/3", why: "not IPv6 global unicast" };
  const i = V6_BLOCKS.findIndex((r) => inRange(v6, r));
  return i >= 0 ? BLOCKED_IPV6_RANGES[i]! : null;
}

/** True only for an address on the public internet. Unparseable → false. */
export function isPublicIpAddress(address: string): boolean {
  return blockedRangeFor(address) === null;
}

/** Is this host text an IP literal (either family, brackets allowed)? */
export function isIpLiteral(host: string): boolean {
  return parseIpv4(host) !== null || parseIpv6(host) !== null;
}

/**
 * Canonical form for NAME checks: lower-cased, brackets and trailing dots
 * removed. `localhost.` and `localhost` are the same host to a resolver.
 */
export function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  while (h.endsWith(".")) h = h.slice(0, -1);
  return h;
}

/**
 * Suffixes that are never public DNS. `.invalid` and `.test` are reserved
 * (RFC 6761); `.internal` / `.local` / `.localhost` resolve inside the network
 * the worker sits on, never on the internet.
 */
const INTERNAL_SUFFIXES = [
  "localhost",
  "local",
  "internal",
  "intranet",
  "lan",
  "home.arpa",
  "invalid",
  "test",
] as const;

/**
 * A hostname that can only mean something inside the worker's own network.
 * Single-label names (`http://metadata/`) are included: resolv.conf search
 * domains turn them into internal names, and no public site is one label.
 */
export function isInternalHostname(host: string): boolean {
  const h = normalizeHost(host);
  if (h.length === 0) return true;
  if (isIpLiteral(h)) return !isPublicIpAddress(h);
  if (!h.includes(".")) return true;
  return INTERNAL_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}

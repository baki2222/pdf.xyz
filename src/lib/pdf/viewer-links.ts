import {
  VIEWER_MAX_OUTLINE_DEPTH,
  VIEWER_MAX_OUTLINE_ITEMS,
} from "./viewer-geometry";

/**
 * What the PDF Viewer follows out of a document, pure: which link addresses
 * it opens, and how much of a bookmark tree it reads.
 *
 * A PDF's link may name any URI at all — `javascript:`, `file:`, `data:`, a
 * custom app scheme. The viewer opens only web and e-mail addresses
 * ({@link VIEWER_LINK_SCHEMES}), in a new tab with no opener and no
 * referrer, and DROPS every other link: it is not drawn, so it cannot be
 * clicked. A link to a page in the same document is followed in place.
 */

/** The only schemes an external link may have. */
export const VIEWER_LINK_SCHEMES: readonly string[] = [
  "http:",
  "https:",
  "mailto:",
];

/** The longest link address followed. */
export const VIEWER_MAX_URL = 2_048;

/** What a followed external link's anchor carries: no opener, no referrer, no endorsement. */
export const VIEWER_LINK_REL = "noopener noreferrer nofollow";

/**
 * `url` as an address the viewer opens, or null to drop the link: not a
 * string, longer than {@link VIEWER_MAX_URL}, not an absolute URL, or of
 * a scheme outside {@link VIEWER_LINK_SCHEMES}.
 */
export function safeExternalHref(url: unknown): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  if (url.length > VIEWER_MAX_URL) return null;
  // Control characters and white space inside an address are a disguise
  // (`java\tscript:`), never a real link.
  for (const ch of url.trim()) {
    const code = ch.codePointAt(0)!;
    if (code <= 0x20 || code === 0x7f) return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (!VIEWER_LINK_SCHEMES.includes(parsed.protocol)) return null;
  if (parsed.protocol !== "mailto:" && parsed.hostname === "") return null;
  return parsed.href;
}

/** A bookmark node as pdf.js's `getOutline` returns it (the fields read). */
export interface OutlineNode {
  title?: unknown;
  dest?: unknown;
  url?: unknown;
  items?: unknown;
}

/** One bookmark, flattened, with how deep it sits. */
export interface OutlineEntry<D = unknown> {
  title: string;
  depth: number;
  /** pdf.js's destination (a name or an explicit array), resolved later. */
  dest: D | null;
  /** A web or e-mail address the bookmark opens instead, already filtered. */
  href: string | null;
}

/** The longest bookmark title shown. */
export const VIEWER_MAX_OUTLINE_TITLE = 300;

/**
 * The bookmark tree as a flat list in reading order, bounded: at most
 * {@link VIEWER_MAX_OUTLINE_ITEMS} entries, at most
 * {@link VIEWER_MAX_OUTLINE_DEPTH} levels deep, each node visited once (a
 * tree that names a node twice is read once). `truncated` says the list
 * stopped at a bound — a deeper or longer tree than the tab shows.
 */
export function walkOutline(
  roots: unknown,
  limits = {
    items: VIEWER_MAX_OUTLINE_ITEMS,
    depth: VIEWER_MAX_OUTLINE_DEPTH,
  },
): { entries: OutlineEntry[]; truncated: boolean } {
  const entries: OutlineEntry[] = [];
  let truncated = false;
  if (!Array.isArray(roots)) return { entries, truncated };
  const seen = new Set<object>();
  // An explicit stack, reversed per level, so the order is a depth-first
  // reading order and no tree is deep enough to overflow the call stack.
  const stack: { node: unknown; depth: number }[] = [];
  for (let i = roots.length - 1; i >= 0; i--) {
    stack.push({ node: roots[i], depth: 0 });
  }
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (typeof node !== "object" || node === null || seen.has(node)) continue;
    seen.add(node);
    if (entries.length >= limits.items) {
      truncated = true;
      break;
    }
    const n = node as OutlineNode;
    const title =
      typeof n.title === "string"
        ? n.title
            .replace(/\s+/gu, " ")
            .trim()
            .slice(0, VIEWER_MAX_OUTLINE_TITLE)
        : "";
    entries.push({
      title: title === "" ? "Untitled bookmark" : title,
      depth,
      dest: n.dest ?? null,
      href: safeExternalHref(n.url),
    });
    if (Array.isArray(n.items) && n.items.length > 0) {
      if (depth + 1 >= limits.depth) {
        truncated = true;
        continue;
      }
      for (let i = n.items.length - 1; i >= 0; i--) {
        stack.push({ node: n.items[i], depth: depth + 1 });
      }
    }
  }
  return { entries, truncated };
}

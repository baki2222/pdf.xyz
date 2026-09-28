import { getToolBySlug, searchTools } from "./index";
import type { Tool } from "./types";

/**
 * The tools a missing URL was most likely looking for, read from the URL
 * itself.
 *
 * The 404 page used to ignore the address it was asked for. People type the
 * paths other PDF sites use (`/merge-pdf`, `/compress-pdf`), follow old links,
 * or guess a slug (`/tools/pdf-to-docx`). Each got the same six popular tools,
 * even when the path named a real tool almost exactly.
 *
 * The last path segment is read as words. An exact tool slug wins outright.
 * Otherwise the words are searched as a phrase over the catalogue (names,
 * taglines, descriptions, keywords, so `pdf-to-docx` finds PDF to Word by its
 * "pdf to docx" keyword), then as individual words that must ALL match.
 * Filler words ("pdf", "to", "online") are dropped there, because every tool
 * matches them. A result so broad that it is no suggestion at all returns
 * nothing, and the page then shows no "did you mean".
 */

/** Words every tool, or no tool, would match. */
const FILLER = new Set([
  "pdf",
  "pdfs",
  "to",
  "and",
  "the",
  "a",
  "an",
  "online",
  "free",
  "tool",
  "tools",
  "file",
  "files",
  "for",
  "with",
]);

/** More matches than this is a search result, not a suggestion. */
const MAX_SUGGESTIONS = 3;

export function toolsForMissingPath(pathname: string): Tool[] {
  const segment = pathname.split("/").filter(Boolean).pop();
  if (!segment) return [];
  let raw = segment;
  try {
    raw = decodeURIComponent(segment);
  } catch {
    // A malformed escape is still words.
  }
  const words = raw
    .toLowerCase()
    .replace(/\.(html?|php|aspx?)$/, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return [];

  const exact = getToolBySlug(words.join("-"));
  if (exact) return [exact];

  const significant = words.filter((w) => !FILLER.has(w));
  if (significant.length === 0) return [];

  const phrase = searchTools(words.join(" "));
  if (phrase.length > 0 && phrase.length <= MAX_SUGGESTIONS) return phrase;

  // Every significant word must match; intersect the per-word results.
  let matched = searchTools(significant[0]!);
  for (const word of significant.slice(1)) {
    const hits = new Set(searchTools(word).map((t) => t.slug));
    matched = matched.filter((t) => hits.has(t.slug));
  }
  return matched.length > 0 && matched.length <= MAX_SUGGESTIONS ? matched : [];
}

import { tools } from "./catalog";
import { categories, getCategory } from "./categories";
import type {
  ProcessingMode,
  Tool,
  ToolBadge,
  ToolCategory,
  ToolCategoryId,
} from "./types";

export { tools, categories, getCategory };
export type { Tool, ToolCategory, ToolCategoryId, ProcessingMode, ToolBadge };

const bySlug = new Map<string, Tool>(tools.map((tool) => [tool.slug, tool]));

/** Total number of tools in the catalog. */
export const toolCount = tools.length;

export function getToolBySlug(slug: string): Tool | undefined {
  return bySlug.get(slug);
}

export function getAllToolSlugs(): string[] {
  return tools.map((tool) => tool.slug);
}

export function getToolsByCategory(categoryId: ToolCategoryId): Tool[] {
  return tools.filter((tool) => tool.category === categoryId);
}

export function getFeaturedTools(limit?: number): Tool[] {
  const featured = tools.filter((tool) => tool.featured);
  return typeof limit === "number" ? featured.slice(0, limit) : featured;
}

export function getPopularTools(limit = 8): Tool[] {
  return tools
    .filter((tool) => tool.badge === "popular" || tool.featured)
    .slice(0, limit);
}

export function getAiTools(): Tool[] {
  return getToolsByCategory("ai");
}

/** Resolve a tool's `related` slugs into full Tool objects. */
export function getRelatedTools(tool: Tool, limit = 3): Tool[] {
  const related = (tool.related ?? [])
    .map((slug) => bySlug.get(slug))
    .filter((candidate): candidate is Tool => Boolean(candidate));
  return related.slice(0, limit);
}

/** Group every category with its tools, preserving category order. */
export function getToolsGroupedByCategory(): {
  category: ToolCategory;
  tools: Tool[];
}[] {
  return categories.map((category) => ({
    category,
    tools: getToolsByCategory(category.id),
  }));
}

/** Count of tools per category, keyed by category id. */
export function getCategoryCounts(): Record<ToolCategoryId, number> {
  const counts = {} as Record<ToolCategoryId, number>;
  for (const category of categories) {
    counts[category.id] = getToolsByCategory(category.id).length;
  }
  return counts;
}

/**
 * Words the search ignores when MATCHING: "word to pdf" means the same two
 * formats as "word pdf". They still count for the exact-name bonus, so
 * "PDF to PDF/A" finds its own tool first, and "to" still sets direction.
 */
const STOPWORDS = new Set(["a", "an", "and", "for", "the", "my", "to", "of"]);

/**
 * Fold a plural so "pdfs" meets "pdf" — applied to the query AND the catalogue
 * alike, since folding only one side misses every keyword stored plural. Not
 * to short words ("has") or to "-ss" words, so "compress" stays "compress".
 */
function foldPlural(word: string): string {
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
    ? word.slice(0, -1)
    : word;
}

/**
 * Split on anything that is not a letter or digit: "password" is one word, so
 * a search for "word" no longer finds Protect PDF inside it. A slash-joined
 * pair ("PDF/A", "CSV/Excel") is ALSO kept whole, so "pdf/a" and "pdfa" find
 * PDF to PDF/A instead of every tool with "pdf" in it.
 */
function wordsOf(text: string): string[] {
  const lower = text.toLowerCase();
  const joined = [...lower.matchAll(/[a-z0-9]+(?:\/[a-z0-9]+)+/g)].map(
    (match) => match[0].replace(/\//g, ""),
  );
  return [...lower.split(/[^a-z0-9]+/), ...joined]
    .filter(Boolean)
    .map(foldPlural);
}

/** Field weights: a hit in the name outranks one buried in the description. */
const FIELD_WEIGHTS = { name: 8, keywords: 4, tagline: 2, description: 1 };

interface SearchIndexEntry {
  tool: Tool;
  name: string[];
  /** Each keyword as the words a query is compared with, joined. */
  keywordPhrases: string[];
  fields: { words: string[]; weight: number }[];
}

let searchIndex: SearchIndexEntry[] | undefined;
function getSearchIndex(): SearchIndexEntry[] {
  searchIndex ??= tools.map((tool) => {
    const name = wordsOf(tool.name);
    return {
      tool,
      name,
      keywordPhrases: tool.keywords.map((keyword) =>
        wordsOf(keyword).join(" "),
      ),
      fields: [
        { words: name, weight: FIELD_WEIGHTS.name },
        {
          words: wordsOf(tool.keywords.join(" ")),
          weight: FIELD_WEIGHTS.keywords,
        },
        { words: wordsOf(tool.tagline), weight: FIELD_WEIGHTS.tagline },
        { words: wordsOf(tool.description), weight: FIELD_WEIGHTS.description },
      ],
    };
  });
  return searchIndex;
}

/**
 * Search the catalogue the way people type.
 *
 * WAS one contiguous substring over the joined text: "merge pdfs" and
 * "pdf word" found nothing, "jpg pdf" found only PDF to JPG, and "word"
 * returned Protect and Unlock because "password" contains it. Now:
 *
 *  - every meaningful query word must match (AND), each as a word PREFIX, so
 *    typing "mer" or "comp" still narrows the grid on every keystroke;
 *  - plurals fold on both sides;
 *  - results rank name > keywords > tagline > description, with a bonus when
 *    the query words appear in the NAME in the order typed — the only thing
 *    that tells "word pdf" (Word to PDF) from "pdf word" (PDF to Word) — and a
 *    larger one for the exact name; a query with "to" also ranks tools whose
 *    name converts TO the words after it ("images to pdf": JPG to PDF);
 *  - ties keep catalogue order.
 */
export function searchTools(query: string): Tool[] {
  const all = wordsOf(query);
  if (all.length === 0) return query.trim() ? [] : tools;
  const meaningful = all.filter((word) => !STOPWORDS.has(word));
  const tokens = [...new Set(meaningful.length > 0 ? meaningful : all)];
  const exact = all.join(" ");
  const queryTo = all.indexOf("to");
  const target =
    queryTo === -1
      ? []
      : all.slice(queryTo + 1).filter((word) => !STOPWORDS.has(word));

  const scored: { tool: Tool; score: number; order: number }[] = [];
  getSearchIndex().forEach((entry, order) => {
    let score = 0;
    for (const token of tokens) {
      let best = 0;
      for (const field of entry.fields) {
        if (
          field.weight > best &&
          field.words.some((word) => word.startsWith(token))
        ) {
          best = field.weight;
        }
      }
      if (best === 0) return;
      score += best;
    }
    // In-order bonus: each token's first name position strictly after the last.
    let cursor = -1;
    let inOrder = tokens.length > 1;
    for (const token of tokens) {
      const at = entry.name.findIndex(
        (word, index) => index > cursor && word.startsWith(token),
      );
      if (at === -1) {
        inOrder = false;
        break;
      }
      cursor = at;
    }
    if (inOrder) score += 10;
    // Direction bonus: "images to pdf" names a TARGET. A word after the
    // query's "to" that matches a word after the name's "to" outranks a tool
    // that merely mentions both formats.
    if (target.length > 0) {
      const nameTo = entry.name.indexOf("to");
      if (nameTo !== -1) {
        const nameTarget = entry.name.slice(nameTo + 1);
        for (const token of target) {
          if (nameTarget.some((word) => word.startsWith(token))) score += 6;
        }
      }
    }
    // A query that IS one of the tool's keywords, word for word, names that
    // tool: "pdf to docx" is PDF to Word's keyword, and without this it tied
    // with Word to PDF (whose "docx to pdf" holds the same two words) and lost
    // on catalogue order — so the 404 page offered the reverse converter for
    // /tools/pdf-to-docx.
    if (entry.keywordPhrases.includes(exact)) score += 50;
    if (entry.name.join(" ") === exact) score += 100;
    scored.push({ tool: entry.tool, score, order });
  });

  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((hit) => hit.tool);
}

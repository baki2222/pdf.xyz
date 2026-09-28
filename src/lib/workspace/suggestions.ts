/**
 * Pure tool-suggestion logic: given the mix of staged files, propose the most
 * relevant tools with an honest, human reason. Deterministic (stable ordering)
 * and validated against the real catalog so we never suggest a tool that doesn't
 * exist. Used by the workspace to turn "I dropped these files" into next steps.
 */

import { eligibleFilesFor } from "@/lib/handoff/capability";
import { getToolBySlug } from "@/lib/tools";
import type { FileFamily, WorkspaceFile } from "./types";

export interface ToolSuggestion {
  slug: string;
  /** Why this tool fits the current file mix, e.g. "Combine your 3 PDFs…". */
  reason: string;
  /** Relevance score; higher sorts first. */
  score: number;
}

type FamilyCounts = Record<FileFamily, number>;

function countFamilies(files: WorkspaceFile[]): FamilyCounts {
  const counts: FamilyCounts = {
    pdf: 0,
    image: 0,
    word: 0,
    excel: 0,
    powerpoint: 0,
    text: 0,
    other: 0,
  };
  for (const file of files) counts[file.family] += 1;
  return counts;
}

const plural = (n: number) => (n === 1 ? "" : "s");

/**
 * Suggest tools for the staged file mix, best-first, capped at `limit`. Returns
 * an empty list when nothing is staged (the UI shows popular tools instead).
 */
export function suggestTools(
  files: WorkspaceFile[],
  limit = 6,
): ToolSuggestion[] {
  if (files.length === 0) return [];

  const c = countFamilies(files);
  const best = new Map<string, ToolSuggestion>();
  const add = (slug: string, reason: string, score: number) => {
    const current = best.get(slug);
    if (!current || score > current.score)
      best.set(slug, { slug, reason, score });
  };

  if (c.pdf >= 2) {
    add("merge-pdf", `Combine your ${c.pdf} PDFs into a single document.`, 100);
    add("compress-pdf", "Shrink your PDFs before sharing them.", 62);
  }
  if (c.pdf >= 1) {
    add("organize-pages", "Reorder, rotate, or delete pages.", 72);
    add("compress-pdf", "Optimize size losslessly, right in your browser.", 60);
    add("split-pdf", "Split a PDF into separate files.", 56);
    add("rotate-pdf", "Fix the orientation of scanned pages.", 44);
    add("pdf-to-jpg", "Export pages as image files.", 30);
  }
  if (c.image >= 1) {
    // The count promised is the count the tool will RECEIVE: read from the
    // same hand-off filter the launch uses, not from the "image" family (which
    // also holds WebP, GIF, HEIC… that neither image tool can embed). It used
    // to promise "your 5 images" for 3 PNGs + 2 JPGs and deliver 2.
    const images = files.filter((f) => f.family === "image");
    const slug = images.every((f) => f.kind === "PNG")
      ? "png-to-pdf"
      : "jpg-to-pdf";
    const convertible = eligibleFilesFor(
      slug,
      images.map((f) => ({ name: f.name, type: f.mime })),
    ).length;
    const other = images.length - convertible;
    if (convertible > 0) {
      add(
        slug,
        `Turn your ${convertible} image${plural(convertible)} into a PDF.` +
          (other > 0
            ? ` ${other} other image${plural(other)} (not PNG or JPG) can't be converted here.`
            : ""),
        90,
      );
    }
  }
  if (c.word >= 1) {
    add(
      "word-to-pdf",
      `Convert ${c.word} Word file${plural(c.word)} to PDF.`,
      86,
    );
  }
  if (c.excel >= 1) {
    add(
      "excel-to-pdf",
      `Convert ${c.excel} spreadsheet${plural(c.excel)} to PDF.`,
      85,
    );
  }
  if (c.powerpoint >= 1) {
    add(
      "powerpoint-to-pdf",
      `Convert ${c.powerpoint} slide deck${plural(c.powerpoint)} to PDF.`,
      85,
    );
  }
  if (c.text >= 1) {
    add(
      "text-to-pdf",
      `Turn ${c.text} text file${plural(c.text)} into a formatted PDF.`,
      80,
    );
  }

  return [...best.values()]
    .filter((s) => Boolean(getToolBySlug(s.slug)))
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, limit);
}

import { normalizeFormatLabel } from "@/lib/jobs/mime-by-format";
import type { Tool } from "./types";

/**
 * A list of formats as a family: one spelling each (JPEG is JPG, HTM is
 * HTML, MARKDOWN is MD — the rule the rest of the site compares formats
 * with), each once, in the list's own order, and no ZIP. A ZIP is packaging,
 * not a format: it is how several results arrive together, and whether a
 * tool hands one over depends on the run, which a list cannot say
 * (`in-browser-claims.test.ts` requires any sentence naming the ZIP to say
 * when). The guides compare tools by this same family
 * (`@/lib/guides` `reversesTool`).
 */
export function formatFamily(labels: readonly string[]): string[] {
  return [
    ...new Set(
      labels.filter((label) => label !== "ZIP").map(normalizeFormatLabel),
    ),
  ];
}

/**
 * A tool's formats as a reader scans them — what it takes, what it makes —
 * read from the catalogue's `accept` and `outputs`, never restated, each as a
 * {@link formatFamily}. "URL" and "PDF/A" are their own labels.
 *
 * Shown as "JPG, PNG → PDF" on every tool card and in a tool page's head.
 */
export function formatsLine(tool: Pick<Tool, "accept" | "outputs">): {
  takes: string[];
  makes: string[];
} {
  return {
    takes: formatFamily(tool.accept),
    makes: formatFamily(tool.outputs),
  };
}

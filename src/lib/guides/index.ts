import { guides } from "./catalog";
import { getToolBySlug } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import type { Guide, GuideFaqEntry, GuideSection } from "./types";

export { guides };
export type { Guide, GuideFaqEntry, GuideSection };

export function getGuideBySlug(slug: string): Guide | undefined {
  return guides.find((guide) => guide.slug === slug);
}

export function getAllGuideSlugs(): string[] {
  return guides.map((guide) => guide.slug);
}

/** Whether a guide in a tool's band teaches that tool, or only neighbours it. */
export type ToolGuideRole = "primary" | "related";

export interface ToolGuide {
  readonly guide: Guide;
  readonly role: ToolGuideRole;
}

/** A format family: a ZIP is packaging, not a format, and JPEG is JPG. */
function formats(list: readonly string[]): Set<string> {
  return new Set(
    list.filter((f) => f !== "ZIP").map((f) => (f === "JPEG" ? "JPG" : f)),
  );
}

function overlaps(a: Set<string>, b: Set<string>): boolean {
  return [...a].some((format) => b.has(format));
}

/**
 * `other` does `tool`'s job backwards: both convert between disjoint formats,
 * and each one's output is the other's input — Word to PDF and PDF to Word,
 * JPG to PDF and PDF to JPG. Derived from the catalogue's own `accept` and
 * `outputs`, so a new converter pair is covered without being named.
 */
export function reversesTool(tool: Tool, other: Tool): boolean {
  if (tool.slug === other.slug) return false;
  const [ti, to, oi, oo] = [
    formats(tool.accept),
    formats(tool.outputs),
    formats(other.accept),
    formats(other.outputs),
  ];
  return (
    !overlaps(ti, to) &&
    !overlaps(oi, oo) &&
    overlaps(ti, oo) &&
    overlaps(to, oi)
  );
}

/**
 * The guides for `toolSlug`'s Guides band — DISCOVERED from each guide's own
 * `tools` field, so the band cannot link a guide that does not claim the tool
 * back; there is no hand-typed href list anywhere for the two to drift apart.
 *
 * A guide lists its neighbours as well as its subject, so the listing alone
 * does not say which way a guide points. Guides whose primary tool IS this
 * tool come first, labelled `primary`; the rest are `related`; and a guide
 * whose primary tool does this tool's job in reverse is left out. Before
 * that, /tools/word-to-pdf's only guide was the PDF-to-Word one, and
 * /tools/pdf-to-jpg's was JPG to PDF — the opposite task, presented as the
 * tool's own guide (tool-page-guides-band.test.ts reads the rendered pages).
 */
export function guidesForTool(toolSlug: string): ToolGuide[] {
  const tool = getToolBySlug(toolSlug);
  const band: ToolGuide[] = [];
  for (const guide of guides) {
    if (!guide.tools.includes(toolSlug)) continue;
    const primarySlug = guide.tools[0];
    if (primarySlug === toolSlug) {
      band.push({ guide, role: "primary" });
      continue;
    }
    const primary = primarySlug ? getToolBySlug(primarySlug) : undefined;
    if (tool && primary && reversesTool(tool, primary)) continue;
    band.push({ guide, role: "related" });
  }
  // Stable: catalogue order within each role.
  return [
    ...band.filter((entry) => entry.role === "primary"),
    ...band.filter((entry) => entry.role === "related"),
  ];
}

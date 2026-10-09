/**
 * What a tool page SAYS — the one set of accessors the page renders and the
 * honesty guards read.
 *
 * The tool page used to call `howToSteps`, `toolFaq` and `tool.description`
 * directly, and the guards that keep its copy true (`capability-hedges`,
 * `ai-ceiling-surfaces`, `structured-steps`) called the same three. When the
 * authored per-tool content arrived (`./content`), wiring the page to it
 * directly would have left every one of those guards green over strings the
 * page no longer rendered — certifying the author's artifact while the reader
 * got another. So the page and the guards both go through here, and a change
 * to what the page shows is a change to what the guards read.
 *
 * Server-side only by convention: the content modules import worker constants
 * a client bundle has no business carrying, which is why this is not folded
 * into `tool-facts.ts` (imported by three client runners).
 */
import type { Tool } from "./types";
import { getToolContent, type ToolContent } from "./content";
import { factFaq, howToSteps, toolFaq, type ToolFaqEntry } from "./tool-facts";
import { guidesForTool, type ToolGuide } from "@/lib/guides";

/** One step of "How it works": a short title when authored, and its text. */
export interface PageStep {
  readonly title?: string;
  readonly text: string;
}

/** The authored content for this tool, if it has any. */
export function pageContent(tool: Tool): ToolContent | undefined {
  return getToolContent(tool.slug);
}

/** The "About this tool" paragraphs: authored intro, else the description. */
export function pageIntro(tool: Tool): readonly string[] {
  return pageContent(tool)?.intro ?? [tool.description];
}

/** Concrete situations the tool is for (authored content only). */
export function pageUseCases(
  tool: Tool,
): readonly { title: string; body: string }[] {
  return pageContent(tool)?.useCases ?? [];
}

/**
 * The steps the page renders AND ships as HowTo structured data: the authored
 * steps when present, else the catalogue's or the mode-true default.
 */
export function pageSteps(tool: Tool): readonly PageStep[] {
  const authored = pageContent(tool)?.steps;
  if (authored && authored.length > 0)
    return authored.map((step) => ({ title: step.title, text: step.body }));
  return howToSteps(tool).map((text) => ({ text }));
}

/** A step as one string — title and text — for guards that scan prose. */
export function stepText(step: PageStep): string {
  return step.title ? `${step.title}. ${step.text}` : step.text;
}

/**
 * The FAQ the page renders AND ships as FAQPage structured data.
 *
 * With authored content: its questions first, then the derived FACTS
 * (`factFaq` — the file ceiling, the AI allowance and ceiling, OCR languages),
 * which stay because the ceiling guards hold them to the engines. That was
 * NOT true of the file ceiling on four pages until 2026-09-27: it was the
 * upload gate, while LibreOffice and Chromium refuse lower, so Word, Excel,
 * PowerPoint and HTML to PDF answered "Up to 100 MB" beside authored copy
 * stating the real cap. `toolFileCeiling` now takes the engine's cap when it
 * is lower (`ENGINE_INPUT_CEILINGS`), and `file-ceilings.test.ts` runs each
 * engine at it.
 *
 * The mode TEMPLATE (`modeFaq` — "Is my file uploaded when I use X?") is
 * dropped: it is the same question on thirty pages, and the authored FAQ
 * answers it for this tool. The template was true by construction; the
 * authored answers are held to the mode by "the body's location claims are
 * the tool's mode" in `content/content.test.ts`, which reads everything this
 * module returns. A derived question the author already asked, word for word,
 * is not repeated. Without authored content, the whole derived FAQ, as before.
 */
export function pageFaq(tool: Tool): readonly ToolFaqEntry[] {
  const content = pageContent(tool);
  if (!content) return toolFaq(tool);
  const authored = content.faqs.map((f) => ({ question: f.q, answer: f.a }));
  const asked = new Set(authored.map((f) => f.question.toLowerCase()));
  return [
    ...authored,
    ...factFaq(tool).filter((f) => !asked.has(f.question.toLowerCase())),
  ];
}

/** Guide slugs the authored content links, in its order. */
export function pageRelatedGuideSlugs(tool: Tool): readonly string[] {
  return pageContent(tool)?.relatedGuides ?? [];
}

/**
 * The <title> the page serves: the authored search title, else the
 * catalogue's `seoTitle`, else the name. The H1, cards and nav keep `name`.
 * `tool-page-content.test.ts` evaluates the page's own title expression and
 * holds what this returns to the head term, the width budget and the tool's
 * own words.
 */
export function pageTitle(tool: Tool): string {
  return pageContent(tool)?.seoTitle ?? tool.seoTitle ?? tool.name;
}

/** The meta description: the authored one, else the catalogue's. */
export function pageDescription(tool: Tool): string {
  return pageContent(tool)?.metaDescription ?? tool.description;
}

/**
 * The Guides band: `guidesForTool` — discovered from each guide's own `tools`
 * field, guides that teach this tool first, a guide for the reverse task left
 * out (`guides/tool-page-guides-band.test.ts` reads the rendered band) — with
 * the guides this tool's authored content names ranked first within each
 * role. The content's list orders the band; it cannot add a guide the band's
 * rules leave out. Measured at the seo/content merge (2026-09-28): two content
 * files named the opposite task (Word to PDF → the PDF to Word guide, PDF to
 * JPG → the JPG to PDF guide) and fourteen named a guide whose `tools` field
 * does not list the tool (the scanned-PDF guide from the AI and export pages,
 * the form guide from Edit, Flatten and Request Signatures); none of those
 * sixteen reaches the page.
 */
export function pageGuides(tool: Tool): readonly ToolGuide[] {
  const named = pageRelatedGuideSlugs(tool);
  const rank = (entry: ToolGuide) => {
    const i = named.indexOf(entry.guide.slug);
    return i === -1 ? named.length : i;
  };
  const band = guidesForTool(tool.slug);
  const inRole = (role: ToolGuide["role"]) =>
    band
      .filter((entry) => entry.role === role)
      .map((entry, order) => ({ entry, order }))
      .sort((a, b) => rank(a.entry) - rank(b.entry) || a.order - b.order)
      .map(({ entry }) => entry);
  return [...inRole("primary"), ...inRole("related")];
}

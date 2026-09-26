/**
 * Every `/tools/[slug]` page as a reader and a crawler RECEIVE it: the visible
 * text, and the FAQPage and HowTo items parsed back out of the page's own
 * JSON-LD script bodies.
 *
 * The copy guards that call `toolFaq(tool)` or `howToSteps(tool)` check the
 * author's artifact. Those helpers can be right while the page renders
 * something else — a stale import, a second source, a branch the page never
 * reaches — so the claims about what a tool page SAYS are made here, over
 * rendered markup, in a fresh process (`render-tool-pages.ts` explains why it
 * must be one: `isolate: false` shares a module cache with test files that
 * mock the worker clients the page imports).
 *
 * A page with no parseable FAQPage or HowTo is a broken link in this chain,
 * and it is FATAL rather than an empty list: an empty list is the strongest
 * possible pass for every "no page says X" assertion built on it.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

export interface RenderedToolPage {
  /** Visible text, JSON-LD script bodies removed, whitespace collapsed. */
  readonly text: string;
  /** The FAQPage entries, exactly as the JSON-LD carries them. */
  readonly faq: readonly { question: string; answer: string }[];
  /** The HowTo step texts, in position order. */
  readonly howTo: readonly string[];
  /** Every JSON-LD node on the page, parsed. */
  readonly jsonLd: readonly Record<string, unknown>[];
}

const ROOT = process.cwd();
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const CENSUS = path.join(ROOT, "src", "tests", "render-tool-pages.ts");

const LD_SCRIPT = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
  "&middot;": " ",
  "&#183;": " ",
};

function decode(text: string): string {
  return text.replace(
    /&(?:amp|lt|gt|quot|nbsp|middot|#x27|#39|#183);/g,
    (e) => ENTITIES[e] ?? e,
  );
}

/** The markup's visible text: scripts dropped, tags removed, entities decoded. */
export function visibleText(markup: string): string {
  return decode(
    markup.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function parseToolPage(slug: string, markup: string): RenderedToolPage {
  const jsonLd = [...markup.matchAll(LD_SCRIPT)].map(
    (m) => JSON.parse(m[1]!) as Record<string, unknown>,
  );
  const faqNode = jsonLd.find((n) => n["@type"] === "FAQPage");
  const howToNode = jsonLd.find((n) => n["@type"] === "HowTo");
  if (!faqNode || !howToNode) {
    throw new Error(
      `${slug}: the rendered page carries no ${faqNode ? "HowTo" : "FAQPage"} JSON-LD — the chain this reader relies on is broken`,
    );
  }
  const faq = (
    faqNode.mainEntity as {
      name: string;
      acceptedAnswer: { text: string };
    }[]
  ).map((q) => ({ question: q.name, answer: q.acceptedAnswer.text }));
  const howTo = (howToNode.step as { position: number; text: string }[])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((s) => s.text);
  return { text: visibleText(markup), faq, howTo, jsonLd };
}

/** Render every tool page in a fresh process and parse what it served. */
export function renderToolPages(): Map<string, RenderedToolPage> {
  const stdout = execFileSync(process.execPath, [TSX_CLI, CENSUS, "--markup"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const pages = new Map<string, RenderedToolPage>();
  for (const [slug, markup] of Object.entries(
    JSON.parse(stdout) as Record<string, string>,
  )) {
    pages.set(slug, parseToolPage(slug, markup));
  }
  return pages;
}

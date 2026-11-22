/**
 * Text to PDF's copy against what its engine now does (audit wave 2):
 *
 *  - text-to-pdf#7: a tab moves to the next tab stop (`expandTabs`), where it
 *    used to become four spaces. "tabs become spaces" was true of the old
 *    engine and is too vague of the new one.
 *  - text-to-pdf#3: the margins are a choice (Narrow, Normal, Wide), where
 *    they were one fixed 0.75 in that three sentences called fixed.
 *
 * In both directions (CLAUDE.md "Guards — house style", rule 1): every
 * sentence that shipped is caught by some ban, every ban catches some
 * shipped sentence; then the bans run over everything the Text to PDF pages
 * serve (tool page, facts box, FAQ, and every guide that leads with them)
 * and must find nothing, and the pins say what the pages must say.
 *
 * Subjects are DISCOVERED from the runner registry, with a health check.
 *
 * WHAT THIS DOES NOT SEE: a synonym of these shapes, and a sentence about
 * Text to PDF on another tool's page.
 */
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { getRunnerKind } from "@/lib/pdf/registry";
import { guides } from "@/lib/guides/catalog";
import type { Guide } from "@/lib/guides/types";
import {
  pageDescription,
  pageFaq,
  pageIntro,
  pageSteps,
  pageTitle,
  pageUseCases,
  stepText,
} from "./page-copy";
import { TEXT_TAB_PHRASE, toolFacts } from "./tool-facts";
import {
  TEXT_MARGINS,
  TEXT_PAGE_SETUP_LABELS,
  TEXT_TAB_STOP,
} from "@/lib/pdf/text-page-options";
import { inches } from "@/lib/pdf/page-geometry";
import type { Tool } from "./types";

/** The sentences that shipped, verbatim. */
const SHIPPED = [
  "Every page carries a small heading, the file's name without its extension, or “text” for pasted text, and a page-of-total count in the footer. Long lines wrap at spaces, a word too long for one line is broken, tabs become spaces, and blank lines and leading indentation are kept.",
  "Long lines wrap at spaces, a word too long for one line is broken, tabs become spaces, Windows and old Mac line endings are normalised, and blank lines and leading indentation are kept.",
  // text-to-pdf#3: true until the margins became a choice.
  "The font and the margins are fixed.",
  "The margins and the font cannot be changed.",
  "Every page has 0.75 in margins and a page number (1 / N) at the foot.",
];

const BANS: Record<string, (s: string) => boolean> = {
  "tabs become spaces, no stop named": (s) =>
    /\btabs? (?:become|turns? into|are replaced (?:by|with)) (?:\w+ )?spaces\b/i.test(
      s,
    ) && !/\btab stop\b/i.test(s),
  "margins fixed or unchangeable": (s) =>
    /\bmargins?\b[^.]*\b(?:are|is) fixed\b/i.test(s) ||
    /\bmargins?\b[^.]*\bcannot be changed\b/i.test(s),
  "one margin width stated for every page": (s) =>
    /\bevery page has [\d.]+ ?in(?:ch(?:es)?)? margins?\b/i.test(s),
};

const sentences = (texts: readonly string[]) =>
  texts
    .flatMap((t) => t.split(/(?<=[.!?;])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);

function servedTool(tool: Tool): string[] {
  return [
    pageTitle(tool),
    pageDescription(tool),
    ...pageIntro(tool),
    ...pageUseCases(tool).flatMap((u) => [u.title, u.body]),
    ...pageSteps(tool).map(stepText),
    ...toolFacts(tool.slug).map((f) => f.value),
    ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
  ];
}
function servedGuide(guide: Guide): string[] {
  return [
    guide.title,
    guide.description,
    ...guide.intro,
    ...guide.steps,
    ...guide.sections.flatMap((s) => [s.heading, ...s.body]),
    ...guide.faq.flatMap((f) => [f.question, f.answer]),
  ];
}

const TEXT_TOOLS = tools.filter((t) => getRunnerKind(t.slug) === "text-to-pdf");
const GUIDES = guides.filter((g) =>
  TEXT_TOOLS.some((t) => t.slug === g.tools[0]),
);

describe("text page copy: the ban list against its corpus", () => {
  it("every shipped sentence is caught", () => {
    const missed = SHIPPED.filter(
      (t) => !sentences([t]).some((s) => Object.values(BANS).some((b) => b(s))),
    );
    expect(missed).toEqual([]);
  });
  it("every ban catches a shipped sentence", () => {
    const idle = Object.entries(BANS)
      .filter(([, ban]) => !sentences(SHIPPED).some((s) => ban(s)))
      .map(([name]) => name);
    expect(idle).toEqual([]);
  });
});

describe("text page copy: what the pages serve now", () => {
  const texts = () => [
    ...TEXT_TOOLS.flatMap(servedTool),
    ...GUIDES.flatMap(servedGuide),
  ];

  it("finds its subjects (health check)", () => {
    expect(TEXT_TOOLS.map((t) => t.slug)).toContain("text-to-pdf");
    expect(GUIDES.length).toBeGreaterThan(0);
    expect(texts().length).toBeGreaterThan(20);
  });

  it("no served sentence makes a banned claim", () => {
    const hits = sentences(texts()).filter((s) =>
      Object.values(BANS).some((ban) => ban(s)),
    );
    expect(hits).toEqual([]);
  });

  it("the tool page and its guides state the tab stop the engine uses", () => {
    expect(TEXT_TAB_PHRASE).toContain(`every ${TEXT_TAB_STOP} characters`);
    for (const tool of TEXT_TOOLS)
      expect(servedTool(tool).join("\n")).toContain(TEXT_TAB_PHRASE);
    for (const guide of GUIDES)
      expect(servedGuide(guide).join("\n")).toContain(TEXT_TAB_PHRASE);
  });

  it("the tool page and its guides name every margin choice and its width", () => {
    const named = (text: string) =>
      text.includes(TEXT_PAGE_SETUP_LABELS.margin) &&
      TEXT_MARGINS.every((m) =>
        text
          .toLowerCase()
          .includes(`${m.label.toLowerCase()} (${inches(m.points)} in)`),
      );
    for (const tool of TEXT_TOOLS)
      expect(named(servedTool(tool).join("\n")), tool.slug).toBe(true);
    for (const guide of GUIDES)
      expect(named(servedGuide(guide).join("\n")), guide.slug).toBe(true);
  });
});

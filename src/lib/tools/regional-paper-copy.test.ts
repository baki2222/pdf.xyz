/**
 * Audit backlog #5 (2026-11-16): Text to PDF got page setup and starts on the
 * browser region's paper; HTML and Webpage to PDF start on it too instead of
 * on "As the page sets it". The sentences below SHIPPED until then, each true
 * of the old page and false of the new one.
 *
 * In both directions (CLAUDE.md "Guards — house style", rule 1): every
 * shipped sentence is caught by some ban, and every ban catches some shipped
 * sentence. Then the bans run over everything the affected pages serve —
 * tool page, facts box, generated FAQ, and every guide that leads with one of
 * these tools — and must find nothing; the pins say what they must say.
 *
 * Subjects are DISCOVERED: the tools the registry mounts the text-to-pdf
 * runner for, and the tools whose served copy is built from
 * `htmlLayoutAnswer` (found by its opening words in the served text, with a
 * health check that it found the two it must).
 *
 * WHAT THIS DOES NOT SEE: a synonym of these shapes (one, "page size the
 * site's print stylesheet sets", was found in review on 2026-11-17 and is
 * now a ban), and a sentence about
 * these pages on another tool's page that does not lead with them.
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
import {
  TEXT_PAGE_FACT,
  TEXT_PAGE_SETUP_SENTENCE,
  toolFacts,
} from "./tool-facts";
import { htmlLayoutAnswer, HTML_LAYOUT_STEP } from "./html-layout-copy";
import type { Tool } from "./types";

const LQ = "“";
const RQ = "”";

/** The sentences that shipped, verbatim. */
const SHIPPED_TEXT = [
  "Paginated Letter-size PDF.",
  "There is no page-size or margin setting.",
  "There are no settings for page size, font or margins.",
  "There is none: every PDF is US Letter with fixed margins and text size, and the page heading doubles as the document's Title property.",
  "No. Every PDF is US Letter (8.5 × 11 in), with fixed margins and text size, and the page heading is also the document's Title property.",
  'Paste text into the box or drop in a .txt file, press Create PDF, and you get a US Letter document with a page-of-total counter in the footer and a small heading on every page: the loaded file\'s name minus the extension, or "text" for pasted text.',
  "Notes exported from a phone app, a Notepad file or a text-only journal become numbered US Letter pages, each headed with the note's file name.",
  "You get a paginated PDF on US Letter (8.5 × 11 in) pages.",
  "US Letter (8.5 × 11 in) portrait pages with 0.75 in margins and a page number (1 / N) at the foot of each page.",
];
const SHIPPED_HTML = [
  "Leave Page size on As the page sets it and a CSS @page rule in your file still decides the paper, US Letter when there is none; choose a size, a screen width or One long page and your choice decides it instead.",
  "Its default, Paper width, lays the page out at the paper's printable width, 739 pixels on US Letter with Normal margins; that is narrower than a 768 pixel tablet screen, so a site without print styles may come out in its tablet or phone layout, and Desktop (1280 px) gives its desktop layout.",
  "Left as they are, the page's own print settings decide the layout.",
  "Leave Page size on its default and a CSS @page rule in your file decides the paper.",
  "Because it is a print rather than a screenshot, text stays selectable, @media print rules take effect, and a CSS @page rule decides the paper size.",
  "Upload an .html file or paste HTML code, and headless Chromium prints it to PDF, running its scripts and applying print CSS and @page size.",
  "Embed the logo as a data: URI rather than pointing at an image file, and add @page { size: A4 } when the recipient expects A4 rather than US Letter.",
  "By default the PDF shows the result of your print CSS rather than your screen layout, including any @page size it sets, with backgrounds printed and no header or footer lines added; untick Use the site's print styles to print the screen layout for comparison.",
  // Missed by the first rewrite and found in review (2026-11-17): the same
  // @page claim without the token "@page", the synonym hole named above.
  "Paste the link and a headless copy of Chromium, the engine behind Chrome and Edge, loads it, lets its JavaScript run for a fixed budget of page time, and prints it to PDF with backgrounds included and any page size the site's print stylesheet sets.",
  // Typed by hand on this branch and found in review (2026-11-17): the
  // panel follows the browser's preferred language, not the country.
  "Page size starts on A4, or on Letter in countries that use Letter paper, so pick the other one under Page size when the person you send it to expects it.",
];

const AUTO = `(?:${LQ})?As the page sets it(?:${RQ})?`;
const BANS: Record<"text" | "html", Record<string, (s: string) => boolean>> = {
  text: {
    "Letter-size, as the whole page": (s) => /\bLetter-size\b/i.test(s),
    "no page-size setting": (s) =>
      /\bno (?:page-size\b|settings? for page size\b)/i.test(s),
    "every PDF is Letter": (s) => /\bevery PDF is (?:US )?Letter\b/i.test(s),
    "Letter pages or document, A4 unnamed": (s) =>
      /\bUS Letter(?:\s*\([^)]*\))?\s+(?:portrait\s+)?(?:document|pages?)\b/.test(
        s,
      ) && !/\bA4\b/.test(s),
  },
  html: {
    "leave Page size on (the old default)": (s) =>
      /\bLeave Page size on\b/i.test(s),
    "untouched layout follows the page's own settings": (s) =>
      /\bLeft as they are\b[^.]*\bpage's own\b/i.test(s),
    "@page decides, with neither the choice nor A4 named": (s) =>
      /@page\b/.test(s) &&
      /\b(?:decides?|size)\b/.test(s) &&
      !new RegExp(AUTO).test(s) &&
      !/\bA4\b/.test(s),
    "edit @page to get A4": (s) => /@page\s*\{\s*size:\s*A4\b/.test(s),
    "the stylesheet's page size, with neither the choice nor A4 named": (s) =>
      /\b(?:page|paper) size\b[^.]*\bstylesheet\b/i.test(s) &&
      !new RegExp(AUTO).test(s) &&
      !/\bA4\b/.test(s),
    "paper follows the country, not the browser": (s) =>
      /\bin (?:the )?countries (?:that|which|where)\b[^.]*\bLetter\b/i.test(
        s,
      ) && !/\bbrowser\b/i.test(s),
    "default width on Letter alone": (s) =>
      /\bdefault\b[^.]*\b\d+ pixels on (?:US )?Letter\b/i.test(s) &&
      !/\bA4\b/.test(s),
  },
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
const LAYOUT_OPENING = htmlLayoutAnswer("file").slice(0, 40);
const HTML_TOOLS = tools.filter((t) =>
  servedTool(t).some((s) => s.includes(LAYOUT_OPENING)),
);
const leadsWith = (set: readonly Tool[]) =>
  guides.filter((g) => set.some((t) => t.slug === g.tools[0]));

describe("regional paper copy: the ban list against its corpus", () => {
  for (const kind of ["text", "html"] as const) {
    const shipped = kind === "text" ? SHIPPED_TEXT : SHIPPED_HTML;
    it(`${kind}: every shipped sentence is caught`, () => {
      expect(
        shipped.filter((s) => !Object.values(BANS[kind]).some((ban) => ban(s))),
      ).toEqual([]);
    });
    it(`${kind}: every ban catches a shipped sentence`, () => {
      const idle = Object.entries(BANS[kind])
        .filter(([, ban]) => !shipped.some((s) => ban(s)))
        .map(([name]) => name);
      expect(idle).toEqual([]);
    });
  }
});

describe("regional paper copy: what the pages serve now", () => {
  it("finds its subjects (health check)", () => {
    expect(TEXT_TOOLS.map((t) => t.slug)).toContain("text-to-pdf");
    expect(HTML_TOOLS.map((t) => t.slug).sort()).toEqual(
      expect.arrayContaining(["html-to-pdf", "webpage-to-pdf"]),
    );
    expect(leadsWith(TEXT_TOOLS).length).toBeGreaterThan(0);
    expect(leadsWith(HTML_TOOLS).length).toBeGreaterThan(0);
  });

  for (const [kind, set] of [
    ["text", TEXT_TOOLS],
    ["html", HTML_TOOLS],
  ] as const) {
    it(`${kind}: no served sentence makes a banned claim`, () => {
      const texts = [
        ...set.flatMap(servedTool),
        ...leadsWith(set).flatMap(servedGuide),
      ];
      expect(texts.length).toBeGreaterThan(20);
      const hits = sentences(texts).filter((s) =>
        Object.values(BANS[kind]).some((ban) => ban(s)),
      );
      expect(hits).toEqual([]);
    });
  }

  it("text: the tool page and its guides state the page setup from the option tables", () => {
    for (const tool of TEXT_TOOLS) {
      const page = servedTool(tool).join("\n");
      expect(page).toContain(TEXT_PAGE_FACT);
      expect(page).toContain(TEXT_PAGE_SETUP_SENTENCE);
    }
    for (const guide of leadsWith(TEXT_TOOLS))
      expect(servedGuide(guide).join("\n")).toContain(TEXT_PAGE_SETUP_SENTENCE);
  });

  it("html: both pages and their guides state where Page size starts", () => {
    const starts = /Page size starts on A4, or Letter if your browser/;
    expect(htmlLayoutAnswer("file")).toMatch(starts);
    expect(HTML_LAYOUT_STEP.body).toMatch(starts);
    for (const tool of HTML_TOOLS)
      expect(servedTool(tool).join("\n")).toMatch(starts);
    for (const guide of leadsWith(HTML_TOOLS))
      expect(servedGuide(guide).join("\n")).toMatch(starts);
  });
});

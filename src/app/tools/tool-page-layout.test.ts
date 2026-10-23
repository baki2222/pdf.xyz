// @vitest-environment node
/**
 * The tool page template, as served: what comes first on a phone.
 *
 * Redesign D.4/D.5 (WP-06). Both layouts now read head → facts → panel →
 * details in DOM order, so on a phone the tool's working surface sits right
 * under its name. Measured before this change on a 390px screen: the Word
 * to PDF panel started at 2,192px and OCR's at 2,511px, under the whole
 * introduction, the processing note and "How it works"
 * (`e2e/tool-layout.mobile.spec.ts` measures the after). On a wide screen
 * the worker layout still puts the panel beside the head and the details,
 * sticky; that is grid placement, not DOM order.
 *
 * Read from the markup every page renders (`src/tests/render-tool-pages.ts`
 * in a fresh process), over EVERY slug, with the expected copy derived from
 * the same `page-copy` accessors the page reads — so the order is checked
 * on what a reader receives, and a section is expected exactly when the
 * page has copy for it. `ssr-content.test.ts` separately holds that no
 * heading or link the built pages served before is lost.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { getRelatedTools, tools } from "@/lib/tools";
import { getRunnerKind } from "@/lib/pdf/registry";
import { processingMeta } from "@/lib/tools/processing";
import { formatsLine } from "@/lib/tools/formats-line";
import { toolFacts } from "@/lib/tools/tool-facts";
import { workerPipelineStages } from "@/lib/jobs/capabilities";
import {
  pageFaq,
  pageGuides,
  pageIntro,
  pageSteps,
  pageUseCases,
} from "@/lib/tools/page-copy";
import { visibleText } from "@/tests/rendered-tool-pages";

const ROOT = process.cwd();
const TOOL_PAGE = path.join(ROOT, "src", "app", "tools", "[slug]", "page.tsx");

let markup: Map<string, string>;

beforeAll(() => {
  const stdout = execFileSync(
    process.execPath,
    [
      path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
      path.join(ROOT, "src", "tests", "render-tool-pages.ts"),
      "--markup",
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  markup = new Map(
    Object.entries(JSON.parse(stdout) as Record<string, string>),
  );
}, 120_000);

/** Position of a marker that must occur exactly once. */
function once(html: string, marker: string, slug: string): number {
  const at = html.indexOf(marker);
  expect(at, `${slug}: no ${marker}`).toBeGreaterThan(-1);
  expect(html.indexOf(marker, at + 1), `${slug}: ${marker} twice`).toBe(-1);
  return at;
}

/** The text of each `<h2>`, in order. */
function h2s(html: string): string[] {
  return [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map((m) =>
    visibleText(m[1]!),
  );
}

describe("every tool page: head, facts, panel, then the details", () => {
  it("health: every catalogue tool was rendered, both layouts among them", () => {
    expect([...markup.keys()].sort()).toEqual(tools.map((t) => t.slug).sort());
    expect(tools.some((t) => getRunnerKind(t.slug))).toBe(true);
    expect(tools.some((t) => !getRunnerKind(t.slug))).toBe(true);
  });

  it("the H1 comes first, then the facts row, then the panel, then the introduction", () => {
    for (const tool of tools) {
      const html = markup.get(tool.slug)!;
      const h1 = once(html, "<h1", tool.slug);
      const facts = once(html, "data-tool-facts", tool.slug);
      const panel = once(html, "data-tool-panel", tool.slug);
      expect(h1, tool.slug).toBeLessThan(facts);
      expect(facts, tool.slug).toBeLessThan(panel);
      // The introduction is read after the panel, never before it.
      const intro = pageIntro(tool)[0]!;
      expect(visibleText(html.slice(0, panel)), tool.slug).not.toContain(intro);
      expect(visibleText(html.slice(panel)), tool.slug).toContain(intro);
    }
  });

  it("the facts row says where the tool runs and what goes in and out", () => {
    for (const tool of tools) {
      const html = markup.get(tool.slug)!;
      const row = visibleText(
        html.slice(
          html.indexOf("data-tool-facts"),
          html.indexOf("data-tool-panel"),
        ),
      );
      const { takes, makes } = formatsLine(tool);
      expect(row, tool.slug).toContain(processingMeta[tool.processing].label);
      expect(row, tool.slug).toContain(
        `Takes ${takes.join(", ")}; makes ${makes.join(", ")}.`,
      );
    }
  });

  /*
   * Until 2026-10-23 the worker layout had no "About this tool" (its intro
   * ran bare under the head), and "When to use it" and "What this tool can
   * do" were sections of their own. Both layouts now share one About card,
   * and those two are its sub-headings (h3) under "More details" — held by
   * "About this tool leads with a short summary" below, on the words.
   */
  it("each layout keeps every section its copy calls for", () => {
    for (const tool of tools) {
      const own = [
        "About this tool",
        ...(pageSteps(tool).length ? ["How it works"] : []),
      ];
      const tail = [
        ...(pageFaq(tool).length ? ["Common questions"] : []),
        ...(getRelatedTools(tool, 3).length ? ["Related tools"] : []),
        ...(pageGuides(tool).length ? ["Guides"] : []),
      ];
      const served = h2s(markup.get(tool.slug)!);
      for (const heading of [...own, ...tail])
        expect(served, `${tool.slug}: "${heading}"`).toContain(heading);
    }
  });
});

describe("the template's own marks", () => {
  it("step numbers are square, as everywhere a number counts a step", () => {
    const source = readFileSync(TOOL_PAGE, "utf8");
    // Health: the step list is still drawn by this file.
    expect(source).toContain("steps.map(");
    expect(source).not.toMatch(/\brounded-full\b/);
    expect(source).toMatch(/\brounded-tag\b/);
  });
});

/**
 * Where an element that opens at `at` (a `<div`) closes, by counting the
 * divs between: React's markup is well formed, so they balance.
 */
function divEnd(html: string, at: number): number {
  const tag = /<div\b|<\/div>/g;
  tag.lastIndex = at;
  let depth = 0;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  throw new Error("unbalanced markup: the element never closes");
}

describe("the workbench's first screen", () => {
  it("POSITIVE CONTROL: the span of an element is read by its own closing tag, nested divs and all", () => {
    const html = `<main><div data-first-screen=""><div><h1>T</h1></div><div data-tool-panel=""></div></div><div><h2>About this tool</h2></div></main>`;
    const at = html.indexOf("<div data-first-screen");
    const end = divEnd(html, at);
    expect(html.slice(at, end)).toContain("data-tool-panel");
    expect(html.slice(at, end)).not.toContain("About this tool");
    expect(html.slice(end)).toContain("About this tool");
  });

  /*
   * The runner's first screen (`data-first-screen`) is what keeps the
   * About section off the screen under the runner, so a pick, a result or
   * its ending moves nothing a reader sees (2026-10-11). The property is
   * measured in a browser, at eight sizes, by `e2e/continue-chain.spec.ts`;
   * this holds what that measurement stands on, on every runner page as
   * served: one first screen, holding the breadcrumb, the name and the
   * panel with its stage — and the About section after it, never inside.
   */
  it("every runner page holds its breadcrumb, name and panel in one first screen, and its About section after it", () => {
    const runners = tools.filter((t) => getRunnerKind(t.slug));
    expect(runners.length).toBeGreaterThanOrEqual(25);
    for (const tool of runners) {
      const html = markup.get(tool.slug)!;
      const at = once(html, "data-first-screen", tool.slug);
      const open = html.lastIndexOf("<div", at);
      const end = divEnd(html, open);
      const screen = html.slice(open, end);
      for (const mark of [
        'aria-label="Breadcrumb"',
        "<h1",
        "data-tool-panel",
        "data-runner-stage",
      ])
        expect(screen, `${tool.slug}: ${mark}`).toContain(mark);
      expect(visibleText(screen), tool.slug).not.toContain("About this tool");
      expect(visibleText(html.slice(end)), tool.slug).toContain(
        "About this tool",
      );
    }
  });

  // Only the workbench draws one: the worker layout (head, panel, details;
  // the panel sticky beside the details from lg) is its own, and is
  // measured on its own by `e2e/layout-stability.spec.ts`.
  it("a worker tool's page draws no first screen", () => {
    for (const tool of tools.filter((t) => !getRunnerKind(t.slug)))
      expect(markup.get(tool.slug)!, tool.slug).not.toContain(
        "data-first-screen",
      );
  });
});

/*
 * ── A FIRST-TIME VISITOR'S PAGE (owner, 2026-10-23) ─────────────────────
 * "/tools is still not user-friendly." Measured on production that day: a
 * tool page ran 5,200-5,900px at 1440 and 8,300-10,000px at 390 — a stage
 * list before anything had happened, a technical paragraph opening the
 * panel, every paragraph of the introduction and every FAQ answer, all
 * open. The content stays (it is what the honesty guards read and what a
 * crawler indexes); what a visitor SEES first is the short version, the
 * rest one press away. So these read the served markup twice: whole, and
 * as SHOWN — a closed `<details>` cut to its `<summary>`, a `hidden`
 * element removed.
 */

/** Authored copy as the page prints it: whitespace collapsed (never tag-stripped — "<base>" in a sentence is text). */
const said = (copy: string) => copy.replace(/\s+/g, " ").trim();

/** Where the element opening at `at` (a `<tag`) closes, nesting counted. */
function elementEnd(html: string, at: number, tag: string): number {
  const re = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  re.lastIndex = at;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0] === `</${tag}>` ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  throw new Error(`unbalanced markup: a <${tag}> never closes`);
}

const OPEN_ATTR = /\sopen(?:=""|\s|>)/;

/**
 * The markup as shown before a visitor presses anything: every element with
 * a `hidden` attribute removed, and every `<details>` without `open` cut
 * down to its `<summary>`.
 */
function shownMarkup(html: string): string {
  let out = html;
  for (;;) {
    const m = /<([a-z][a-z0-9]*)\b[^>]*\shidden=""[^>]*>/.exec(out);
    if (!m) break;
    out = out.slice(0, m.index) + out.slice(elementEnd(out, m.index, m[1]!));
  }
  let from = 0;
  for (;;) {
    const at = out.indexOf("<details", from);
    if (at === -1) break;
    const openTag = out.slice(at, out.indexOf(">", at) + 1);
    const end = elementEnd(out, at, "details");
    if (OPEN_ATTR.test(openTag)) {
      from = at + openTag.length;
      continue;
    }
    const body = out.slice(at, end);
    const summary = /<summary\b[\s\S]*?<\/summary>/.exec(body)?.[0] ?? "";
    out = out.slice(0, at) + openTag + summary + "</details>" + out.slice(end);
    from = at + openTag.length + summary.length;
  }
  return out;
}

interface DetailsBlock {
  readonly summary: string;
  readonly text: string;
  readonly open: boolean;
}

/** Every `<details>` of a page: its summary's text, its whole text, whether it starts open. */
function detailsBlocks(html: string): DetailsBlock[] {
  const blocks: DetailsBlock[] = [];
  for (
    let at = html.indexOf("<details");
    at !== -1;
    at = html.indexOf("<details", at + 1)
  ) {
    const body = html.slice(at, elementEnd(html, at, "details"));
    const openTag = body.slice(0, body.indexOf(">") + 1);
    const summary =
      /<summary\b[^>]*>([\s\S]*?)<\/summary>/.exec(body)?.[1] ?? "";
    blocks.push({
      // As assistive tech names it: a decorative "+" is aria-hidden.
      summary: visibleText(
        summary.replace(/<span aria-hidden="true"[^>]*>[^<]*<\/span>/g, ""),
      ),
      text: visibleText(body),
      open: OPEN_ATTR.test(openTag),
    });
  }
  return blocks;
}

/** Every JSON-LD node a page carries, arrays flattened. */
function jsonLdNodes(html: string): Record<string, unknown>[] {
  return [
    ...html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    ),
  ].flatMap((m) => {
    const parsed = JSON.parse(m[1]!) as unknown;
    return (Array.isArray(parsed) ? parsed : [parsed]) as Record<
      string,
      unknown
    >[];
  });
}

describe("what a first-time visitor sees, and what stays one press away", () => {
  it("POSITIVE CONTROL: shown markup drops a closed details' body and a hidden element, and keeps an open one", () => {
    const html =
      "<main><p>lead</p><details><summary>More details</summary><p>long text</p>" +
      "<details><summary>inner</summary><p>deep</p></details></details>" +
      '<div hidden=""><div>stage list</div></div>' +
      '<details open=""><summary>Q</summary><p>shown answer</p></details></main>';
    const shown = visibleText(shownMarkup(html));
    expect(shown).toContain("lead");
    expect(shown).toContain("More details");
    expect(shown).not.toContain("long text");
    expect(shown).not.toContain("deep");
    expect(shown).not.toContain("stage list");
    expect(shown).toContain("shown answer");
    // Health: the whole markup still has every word.
    for (const word of ["long text", "deep", "stage list"])
      expect(visibleText(html)).toContain(word);
    expect(detailsBlocks(html).map((b) => [b.summary, b.open])).toEqual([
      ["More details", false],
      ["inner", false],
      ["Q", true],
    ]);
  });

  it("before a job, a worker panel draws no stage list; every stage's title and description is still in the HTML", () => {
    const pages = tools.filter((t) => !getRunnerKind(t.slug));
    expect(pages.length, "implausibly few worker pages").toBeGreaterThanOrEqual(
      15,
    );
    for (const tool of pages) {
      const html = markup.get(tool.slug)!;
      expect(html, `${tool.slug}: a docket before any job`).not.toContain(
        "data-docket",
      );
      const shown = visibleText(shownMarkup(html));
      const whole = visibleText(html);
      const stages = workerPipelineStages(null, tool);
      expect(stages.length, tool.slug).toBeGreaterThanOrEqual(3);
      for (const stage of stages) {
        const words = said(stage.description);
        expect(whole, `${tool.slug}: ${stage.title}`).toContain(stage.title);
        expect(whole, `${tool.slug}: ${stage.title}, described`).toContain(
          words,
        );
        expect(shown, `${tool.slug}: ${stage.title}, on screen`).not.toContain(
          words,
        );
      }
      expect(shown, `${tool.slug}: the stage list is on screen`).not.toContain(
        stages[stages.length - 1]!.title,
      );
    }
  });

  it("the FAQ is an accordion: each question a closed summary with its answer inside, and the FAQPage JSON-LD asks exactly those questions, in order", () => {
    let pages = 0;
    for (const tool of tools) {
      const faq = pageFaq(tool);
      if (faq.length === 0) continue;
      pages += 1;
      const html = markup.get(tool.slug)!;
      const questions = new Set(faq.map((e) => said(e.question)));
      const asked = detailsBlocks(html).filter((b) => questions.has(b.summary));
      expect(
        asked.map((b) => b.summary),
        tool.slug,
      ).toEqual(faq.map((e) => said(e.question)));
      for (const [i, block] of asked.entries()) {
        expect(block.open, `${tool.slug}: "${block.summary}" open`).toBe(false);
        expect(block.text, `${tool.slug}: "${block.summary}"`).toContain(
          said(faq[i]!.answer),
        );
      }
      const shown = visibleText(shownMarkup(html));
      for (const entry of faq)
        expect(shown, `${tool.slug}: an answer on screen`).not.toContain(
          said(entry.answer),
        );
      const ld = jsonLdNodes(html).find((n) => n["@type"] === "FAQPage") as
        { mainEntity: { name: string }[] } | undefined;
      expect(ld, `${tool.slug}: no FAQPage`).toBeDefined();
      expect(
        ld!.mainEntity.map((q) => said(q.name)),
        tool.slug,
      ).toEqual(asked.map((b) => b.summary));
    }
    expect(pages, "implausibly few FAQ pages").toBeGreaterThanOrEqual(40);
  });

  it("About this tool leads with a short summary; the whole introduction, use cases and facts sit in a closed More details", () => {
    for (const tool of tools) {
      const html = markup.get(tool.slug)!;
      const shown = visibleText(shownMarkup(html));
      const more = detailsBlocks(html).find(
        (b) => b.summary === "More details",
      );
      expect(more, `${tool.slug}: no More details`).toBeDefined();
      expect(more!.open, tool.slug).toBe(false);
      for (const paragraph of pageIntro(tool)) {
        expect(more!.text, `${tool.slug}: intro`).toContain(said(paragraph));
        expect(shown, `${tool.slug}: intro on screen`).not.toContain(
          said(paragraph),
        );
      }
      for (const useCase of pageUseCases(tool))
        expect(more!.text, `${tool.slug}: ${useCase.title}`).toContain(
          said(useCase.body),
        );
      for (const fact of toolFacts(tool.slug))
        expect(more!.text, `${tool.slug}: ${fact.label}`).toContain(
          said(fact.value),
        );
      // The short version is on screen: the tool's own description.
      expect(shown, tool.slug).toContain(said(tool.description));
    }
  });

  it("How it works shows each step's short title; the step's full text is one press away", () => {
    for (const tool of tools) {
      const steps = pageSteps(tool);
      const html = markup.get(tool.slug)!;
      const shown = visibleText(shownMarkup(html));
      const titled = steps.filter((s) => s.title);
      expect(titled.length, `${tool.slug}: untitled steps`).toBe(steps.length);
      for (const step of titled) {
        expect(shown, `${tool.slug}: "${step.title}"`).toContain(step.title);
        expect(shown, `${tool.slug}: step text on screen`).not.toContain(
          said(step.text),
        );
        expect(visibleText(html), tool.slug).toContain(said(step.text));
      }
    }
  });
});

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

  it("each layout keeps every section its copy calls for", () => {
    for (const tool of tools) {
      const runner = Boolean(getRunnerKind(tool.slug));
      const own = runner
        ? [
            "About this tool",
            ...(pageSteps(tool).length ? ["How it works"] : []),
          ]
        : [
            ...(pageUseCases(tool).length ? ["When to use it"] : []),
            ...(pageSteps(tool).length ? ["How it works"] : []),
          ];
      const tail = [
        ...(toolFacts(tool.slug).length ? ["What this tool can do"] : []),
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

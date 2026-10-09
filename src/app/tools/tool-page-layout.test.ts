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

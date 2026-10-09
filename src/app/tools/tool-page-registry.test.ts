// @vitest-environment node
/**
 * Every tool page has exactly one thing that runs it.
 *
 * WAS: `app/tools/[slug]/page.tsx` chose a worker panel with a chain of
 * `tool.slug === "…" ? <XWorkerPanel tool={tool} />` ternaries. A slug that
 * fell off the end of the chain got `WorkerPreview`, "an honest future-flow
 * preview" of a tool that had not shipped; an in-browser tool with no runner
 * got an `UploadZone` that staged its files for the workspace. Measured on
 * 2026-10-10, both branches rendered for ZERO tools — and that is what made
 * them dangerous rather than dead: a slug dropped from the chain would have
 * shipped a "coming soon" page for a live tool, and every build stayed green.
 *
 * NOW the page indexes a registry (`WORKER_PANELS`), and this file holds the
 * property the fallbacks hid: every catalogue slug resolves to an in-browser
 * runner OR a registered panel — never neither (the page would have nothing
 * to run) and never both (two engines claiming one tool). The page also
 * throws for a slug with neither, so `next build` fails on it too; this says
 * which slug before a build is needed.
 *
 * The subjects are DISCOVERED: the catalogue's slugs, the runner registry,
 * and the panel modules on disk (`src/components/tools/*-worker-panel.tsx`).
 * The parse every source-reading guard shares (`@/tests/worker-panel-dispatch`)
 * is held equal to the registry the page actually renders.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAllToolSlugs, tools } from "@/lib/tools";
import { getRunnerKind } from "@/lib/pdf/registry";
import { processingSplit } from "@/lib/tools/processing-split";
import {
  WORKER_PANELS,
  type WorkerPanelRoute,
} from "@/components/tools/worker-panels";
import {
  TOOL_PAGE,
  panelComponent,
  panelDispatchArms,
} from "@/tests/worker-panel-dispatch";

const TOOLS_DIR = path.resolve("src/components/tools");

interface Resolution {
  readonly neither: string[];
  readonly both: string[];
  readonly runners: string[];
  readonly panels: string[];
}

/** How each slug is served: by a runner, a panel, both, or nothing. */
function resolve(
  slugs: readonly string[],
  hasRunner: (slug: string) => boolean,
  panels: Readonly<Record<string, unknown>>,
): Resolution {
  const out: Resolution = { neither: [], both: [], runners: [], panels: [] };
  for (const slug of slugs) {
    const runner = hasRunner(slug);
    const panel = Object.hasOwn(panels, slug);
    if (runner && panel) out.both.push(slug);
    else if (runner) out.runners.push(slug);
    else if (panel) out.panels.push(slug);
    else out.neither.push(slug);
  }
  return out;
}

const SLUGS = getAllToolSlugs();
const hasRunner = (slug: string) => Boolean(getRunnerKind(slug));
const actual = resolve(SLUGS, hasRunner, WORKER_PANELS);

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");

describe("every tool page resolves to one engine", () => {
  it("every catalogue slug has an in-browser runner or a worker panel — never neither, never both", () => {
    expect(actual.neither, "these tools would render nothing to run").toEqual(
      [],
    );
    expect(actual.both, "these tools are claimed by two engines").toEqual([]);
  });

  it("every registry key is a catalogue slug", () => {
    const known = new Set(SLUGS);
    expect(Object.keys(WORKER_PANELS).filter((s) => !known.has(s))).toEqual([]);
  });

  it("health: the catalogue is whole, and the two halves partition it", () => {
    // A collapsed slug list would make "nothing is unresolved" vacuous.
    expect(SLUGS.length).toBe(tools.length);
    expect(new Set(SLUGS).size).toBe(SLUGS.length);
    expect(SLUGS.length).toBeGreaterThanOrEqual(40);
    expect(actual.runners.length).toBeGreaterThan(0);
    expect(actual.panels.length).toBeGreaterThan(0);
    expect(actual.runners.length + actual.panels.length).toBe(SLUGS.length);
  });

  it("a tool with a path in the browser runs there; a tool without one gets a worker panel", () => {
    // Bound to the processing partition, not to the registries' own lists:
    // a worker tool given a runner, or an in-browser tool routed to a panel,
    // would put the page's "where it runs" line at odds with what runs.
    const browser = new Set(
      processingSplit().hasBrowserPath.map((tool) => tool.slug),
    );
    expect(actual.runners.filter((slug) => !browser.has(slug))).toEqual([]);
    expect(actual.panels.filter((slug) => browser.has(slug))).toEqual([]);
  });

  it("positive control: the check reports a slug with neither and a slug with both", () => {
    const runnerSlug = actual.runners[0]!;
    const mutated = resolve([...SLUGS, "not-a-tool"], hasRunner, {
      ...WORKER_PANELS,
      [runnerSlug]: WORKER_PANELS[actual.panels[0]!],
    });
    expect(mutated.neither).toEqual(["not-a-tool"]);
    expect(mutated.both).toEqual([runnerSlug]);
  });
});

describe("the registry is the panels on disk, and the page renders it", () => {
  /** Non-test `*-worker-panel.tsx` modules, as `@/components/tools/…` specifiers. */
  const onDisk = readdirSync(TOOLS_DIR)
    .filter((f) => /-worker-panel\.tsx$/.test(f) && !/\.test\./.test(f))
    .map((f) => `@/components/tools/${f.replace(/\.tsx$/, "")}`)
    .sort();

  it("every worker panel module is registered, and the registry routes nothing else", () => {
    // Health: the directory walk found the panels, so equality is not [] = [].
    expect(onDisk.length).toBeGreaterThanOrEqual(10);
    const routed = [
      ...new Set(panelDispatchArms().map((arm) => arm.specifier)),
    ].sort();
    expect(routed).toEqual(onDisk);
  });

  it("each route's crash label is its panel's module name", () => {
    for (const arm of panelDispatchArms()) {
      expect(arm.boundary, arm.component).toBe(
        path.posix.basename(arm.specifier),
      );
    }
  });

  it("the page indexes the registry and keeps no dispatch chain of its own", () => {
    const page = withoutComments(readFileSync(TOOL_PAGE, "utf8"));
    expect(page).toMatch(
      /import\s*\{[^}]*\bWORKER_PANELS\b[^}]*\}\s*from\s*"@\/components\/tools\/worker-panels"/,
    );
    expect(page).toContain("WORKER_PANELS[");
    expect(page).not.toMatch(/tool\.slug\s*===/);
  });

  it("the parse every source-reading guard shares is the registry the page renders", async () => {
    const arms = panelDispatchArms();
    const parsed = arms.flatMap((arm) => arm.slugs).sort();
    expect(parsed).toEqual(Object.keys(WORKER_PANELS).sort());
    for (const arm of arms) {
      const component = await panelComponent(arm);
      for (const slug of arm.slugs) {
        const route: WorkerPanelRoute | undefined = WORKER_PANELS[slug];
        expect(route?.Panel, `${slug} → ${arm.component}`).toBe(component);
        expect(route?.boundary, slug).toBe(arm.boundary);
      }
    }
  });
});

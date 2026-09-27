// @vitest-environment jsdom
/**
 * What a worker tool page says BEFORE it knows whether the worker can run.
 *
 * The server renders every worker panel in its `loading` phase, so that phase
 * is the HTML search engines index, link previews quote, and a visitor on a
 * slow connection reads first. Twenty live tool pages — PDF to Word, Word to
 * PDF, OCR, Protect, Unlock among them — served "Notify me when this ships",
 * a "never pretends to …" apology, and "Files are not scanned for malware
 * here" in that phase, on a deployment that scans every file. The loading
 * phase fell into the same branch as a worker that really was off, and the
 * pipeline read `status?.scan.active ?? false` — "unknown" spelled as "no".
 *
 * THE SUBJECTS ARE DISCOVERED, not named: every arm of the tool page's own
 * dispatch (`tool.slug === "…" ? <XWorkerPanel tool={tool} />`), the same
 * source the production page renders from. A slug routed to a new panel is
 * checked without this file being edited. Tools that fall through to
 * `WorkerPreview` are not in the set — that page is a preview of a tool that
 * has not shipped, and "Notify me" is true there.
 *
 * THE CLAIMS ARE DERIVED where they can be: the notify text from rendering
 * `NotifyMe` itself, the scan claims from `workerPipelineStages`. Each
 * banned claim must ALSO appear when the worker really is off — the positive
 * control — so a claim that no panel renders any more cannot sit here as
 * decoration, and an absence check that cannot see its string cannot pass.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import { workerPipelineStages } from "@/lib/jobs/capabilities";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { resetTelemetry } from "@/lib/telemetry/track";
import { NotifyMe } from "./notify-me";

const PAGE = path.resolve("src/app/tools/[slug]/page.tsx");

interface Arm {
  slugs: string[];
  component: string;
  specifier: string;
}

/** The tool page's dispatch, read from the page. Throws on any loose end. */
function dispatchArms(): Arm[] {
  const source = readFileSync(PAGE, "utf8");
  const imports = new Map<string, string>();
  for (const m of source.matchAll(
    /import \{ (\w+) \} from "(@\/components\/tools\/[^"]+)";/g,
  ))
    imports.set(m[1]!, m[2]!);
  const arms: Arm[] = [];
  for (const m of source.matchAll(
    /((?:tool\.slug === "[^"]+"\s*(?:\|\|\s*)?)+)\?\s*\(([\s\S]*?)<(\w+) tool=\{tool\} \/>/g,
  )) {
    const slugs = [...m[1]!.matchAll(/"([^"]+)"/g)].map((s) => s[1]!);
    const component = m[3]!;
    const specifier = imports.get(component);
    if (!specifier)
      throw new Error(`${component} is dispatched but not imported`);
    arms.push({ slugs, component, specifier });
  }
  // A broken link is FATAL, not a smaller corpus: every slug comparison in
  // the page must have landed in an arm.
  const compared = [...source.matchAll(/tool\.slug === "/g)].length;
  const parsed = arms.reduce((n, arm) => n + arm.slugs.length, 0);
  if (compared !== parsed)
    throw new Error(
      `page.tsx compares ${compared} slugs; the dispatch parse found ${parsed}`,
    );
  return arms;
}

const ARMS = dispatchArms();
const SUBJECTS = ARMS.flatMap((arm) =>
  arm.slugs.map((slug) => ({ slug, ...arm })),
);

async function componentOf(arm: Arm): Promise<ComponentType<{ tool: Tool }>> {
  const mod = (await import(
    /* @vite-ignore */ arm.specifier.replace(
      /^@\//,
      `${path.resolve("src").replace(/\\/g, "/")}/`,
    )
  )) as Record<string, unknown>;
  const component = mod[arm.component];
  if (typeof component !== "function")
    throw new Error(`${arm.specifier} does not export ${arm.component}`);
  return component as ComponentType<{ tool: Tool }>;
}

function toolOf(slug: string): Tool {
  const tool = getToolBySlug(slug);
  if (!tool) throw new Error(`dispatched slug ${slug} is not in the catalog`);
  return tool;
}

function textOf(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ");
}

const NOTIFY_TEXT = textOf(
  renderToString(createElement(NotifyMe, { toolName: "X", toolSlug: "x" })),
);
// The button's label: the part of NotifyMe that says "not shipped".
const NOTIFY_CLAIM = /Notify me when this ships/;
const NOT_SCANNED = scanStageOf(false).description;
const SCANNED = scanStageOf(true).description;
/** The unavailable box's apology, in each panel's own words. */
const NEVER_PRETENDS = /never pretends/;

function scanStageOf(active: boolean) {
  const on = workerPipelineStages(true);
  const off = workerPipelineStages(false);
  const index = off.findIndex((s, i) => s.description !== on[i]?.description);
  const stage = (active ? on : off)[index];
  if (index < 0 || !stage)
    throw new Error("the scanning and non-scanning pipelines do not differ");
  return stage;
}

const providers = getProviderReadiness("disabled");
/** A worker that is really off: every panel's gate must say so. */
const OFF: WorkerStatus = {
  mode: "disabled",
  enabled: false,
  localDevOnly: false,
  detail: "No secure worker is configured in this environment.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: false, detail: "not scanned" },
  ocr: { available: false, engine: null, languages: [], detail: "off" },
  security: {
    available: false,
    operations: ["protect", "unlock"],
    detail: "off",
  },
  providers,
  daemon: resolveDaemonReadiness({}),
  ai: resolveAiReadiness({}),
  pipeline: {
    verdict: "off",
    observed: false,
    drainable: false,
    detail: "no worker observed",
  },
};

afterEach(() => {
  cleanup();
  resetTelemetry();
  vi.unstubAllGlobals();
});

describe("the corpus — derived from the tool page's own dispatch", () => {
  it("is the size the page implies, and every subject resolves", async () => {
    // Health check: 13 panels serve 20 slugs today. A parse that quietly
    // shrank would make every absence below vacuous.
    expect(ARMS.length).toBeGreaterThanOrEqual(13);
    expect(SUBJECTS.length).toBeGreaterThanOrEqual(20);
    for (const arm of ARMS) await componentOf(arm);
    for (const { slug } of SUBJECTS) toolOf(slug);
  });

  it("the derived claims are real sentences", () => {
    expect(NOTIFY_TEXT).toMatch(NOTIFY_CLAIM);
    expect(NOT_SCANNED).toMatch(/not scanned for malware/);
    expect(SCANNED).toMatch(/scanned for malware before/);
  });
});

describe("the server-rendered (loading) HTML of every dispatched worker panel", () => {
  it.each(SUBJECTS.map((s) => [s.slug, s] as const))(
    "%s makes no claim it cannot know yet",
    async (_slug, subject) => {
      const Panel = await componentOf(subject);
      const html = renderToString(
        createElement(Panel, { tool: toolOf(subject.slug) }),
      );
      const text = textOf(html);
      expect(text).not.toMatch(NOTIFY_CLAIM);
      expect(text).not.toMatch(NEVER_PRETENDS);
      expect(text).not.toContain(NOT_SCANNED);
      expect(text).not.toContain(SCANNED);
      // …and it does say something: a live status line, not a blank box.
      expect(html).toMatch(/role="status"/);
    },
  );
});

describe("POSITIVE CONTROL: the same panels once the worker is known to be off", () => {
  it("every banned claim appears in some panel, and the notify button in every one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => OFF })),
    );
    const seen = { neverPretends: 0, notScanned: 0 };
    for (const subject of SUBJECTS) {
      const Panel = await componentOf(subject);
      const { container, unmount } = render(
        createElement(Panel, { tool: toolOf(subject.slug) }),
      );
      await waitFor(
        () => expect(container.textContent ?? "").toMatch(NOTIFY_CLAIM),
        { timeout: 2000 },
      ).catch(() => {
        throw new Error(`${subject.slug}: no notify button for an OFF worker`);
      });
      const text = (container.textContent ?? "").replace(/\s+/g, " ");
      if (NEVER_PRETENDS.test(text)) seen.neverPretends += 1;
      if (text.includes(NOT_SCANNED)) seen.notScanned += 1;
      unmount();
    }
    // Rule 1, the other direction: each pattern still catches a shipped
    // sentence, so none of the absences above is decoration.
    expect(seen.neverPretends).toBeGreaterThan(0);
    expect(seen.notScanned).toBe(SUBJECTS.length);
  });
});

describe("a status endpoint that cannot be reached", () => {
  it.each(ARMS.map((a) => [a.component, a] as const))(
    "%s offers a retry, not a notify button, and the retry works",
    async (_name, arm) => {
      let reachable = false;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          reachable
            ? { ok: true, status: 200, json: async () => OFF }
            : Promise.reject(new TypeError("Failed to fetch")),
        ),
      );
      const Panel = await componentOf(arm);
      const { container } = render(
        createElement(Panel, { tool: toolOf(arm.slugs[0]!) }),
      );
      const retry = await screen.findByRole("button", { name: /check again/i });
      expect(container.textContent ?? "").not.toMatch(NOTIFY_CLAIM);
      reachable = true;
      await act(async () => {
        fireEvent.click(retry);
      });
      await waitFor(() =>
        expect(container.textContent ?? "").toMatch(NOTIFY_CLAIM),
      );
    },
  );
});

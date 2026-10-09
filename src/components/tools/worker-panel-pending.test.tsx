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
 * THE SUBJECTS ARE DISCOVERED, not named: every route of the panel registry
 * the tool page indexes (`WORKER_PANELS`, `src/components/tools/worker-panels.tsx`),
 * the same source the production page renders from. A slug routed to a new
 * panel is checked without this file being edited. Until WP-06 (2026-10-10)
 * the set was the arms of a ternary chain in the page, and a tool the chain
 * did not name fell through to a `WorkerPreview` of "a tool that has not
 * shipped". Nothing falls through now: `tool-page-registry.test.ts` requires
 * every slug to resolve to an in-browser runner or a route, so every worker
 * tool is in this set.
 *
 * THE CLAIMS ARE DERIVED where they can be: the notify text from rendering
 * `NotifyMe` itself, the scan claims from `workerPipelineStages` — PER TOOL,
 * since the merge with HEAD's per-tool pipeline (2026-09-28): the preflight
 * sentence names each tool's own refusals, and a URL tool (webpage-to-pdf)
 * uploads nothing, so its pipeline has no scan stage to claim anything with. Each
 * banned claim must ALSO appear when the worker really is off — the positive
 * control — so a claim that no panel renders any more cannot sit here as
 * decoration, and an absence check that cannot see its string cannot pass.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  getToolInputKind,
  workerPipelineStages,
} from "@/lib/jobs/capabilities";
import type { Tool } from "@/lib/tools/types";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { resetTelemetry } from "@/lib/telemetry/track";
import { NotifyMe } from "./notify-me";
import {
  catalogTool,
  panelComponent,
  panelDispatchArms,
} from "@/tests/worker-panel-dispatch";

const ARMS = panelDispatchArms();
const SUBJECTS = ARMS.flatMap((arm) =>
  arm.slugs.map((slug) => ({ slug, ...arm })),
);
const componentOf = panelComponent;
const toolOf = catalogTool;

function textOf(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ");
}

const NOTIFY_TEXT = textOf(
  renderToString(
    createElement(NotifyMe, { toolName: "X", toolSlug: "x", checking: false }),
  ),
);
// The button's label: the part of NotifyMe that says "not shipped".
const NOTIFY_CLAIM = /Notify me when this ships/;
/** The unavailable box's apology, in each panel's own words. */
const NEVER_PRETENDS = /never pretends/;

/**
 * The two answers `tool`'s scan stage can give — the one stage that differs
 * between its scanning and non-scanning pipelines — or `null` when the two
 * do not differ, which the corpus test below allows only for a URL tool.
 */
function scanClaimsOf(
  tool: Tool,
): { scanned: string; notScanned: string } | null {
  const on = workerPipelineStages(true, tool);
  const off = workerPipelineStages(false, tool);
  const index = off.findIndex((s, i) => s.description !== on[i]?.description);
  if (index < 0) return null;
  return {
    scanned: on[index]!.description,
    notScanned: off[index]!.description,
  };
}
const CLAIMS = new Map(
  SUBJECTS.map((s) => [s.slug, scanClaimsOf(toolOf(s.slug))] as const),
);
/** The subjects whose pipeline has a scan stage — every one that uploads. */
const SCANNABLE = SUBJECTS.filter((s) => CLAIMS.get(s.slug) !== null);

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
    // Every subject that uploads a file has both claims; only a URL tool,
    // which uploads nothing, has neither. Derived from the catalogue, not
    // from the pipelines being compared.
    for (const { slug } of SUBJECTS) {
      const claims = CLAIMS.get(slug);
      if (getToolInputKind(slug) === "url") {
        expect(claims, slug).toBeNull();
        continue;
      }
      expect(claims, slug).not.toBeNull();
      expect(claims!.notScanned, slug).toMatch(/not scanned for malware/);
      expect(claims!.scanned, slug).toMatch(/scanned for malware before/);
    }
    // Health: the per-tool derivation did not collapse to the URL case.
    expect(SCANNABLE.length).toBeGreaterThanOrEqual(SUBJECTS.length - 1);
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
      const claims = CLAIMS.get(subject.slug);
      if (claims) {
        expect(text).not.toContain(claims.notScanned);
        expect(text).not.toContain(claims.scanned);
      }
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
      const claims = CLAIMS.get(subject.slug);
      if (claims && text.includes(claims.notScanned)) seen.notScanned += 1;
      unmount();
    }
    // Rule 1, the other direction: each pattern still catches a shipped
    // sentence, so none of the absences above is decoration.
    expect(seen.neverPretends).toBeGreaterThan(0);
    expect(seen.notScanned).toBe(SCANNABLE.length);
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

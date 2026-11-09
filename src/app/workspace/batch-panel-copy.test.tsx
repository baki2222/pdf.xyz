// @vitest-environment jsdom
/**
 * THE WORKSPACE NEVER TELLS A WORKER TOOL'S READER THAT NOTHING IS UPLOADED
 * (batch plan P6).
 *
 * Until P6 no worker tool could launch from the workspace's launch area, so
 * its two client sentences — "right here in your browser" and "nothing is
 * uploaded" — could only ever be drawn for a tool that runs in the browser.
 * P6 lets every worker tool with a batch launch from there, and the
 * cheapest way to do that is to reuse the "ready" status, words and all.
 * This walks EVERY tool the page is given, through the planner the page uses
 * (`batchToolInfoOf`) and the panel the page draws, and reads what the launch
 * area says.
 *
 * Two-way, as CLAUDE.md rule 1 asks, over a corpus the walk DERIVES rather
 * than one typed here:
 *   - the corpus is every sentence the launch area draws for an in-browser
 *     tool that speaks of uploads, the browser, a device or a server;
 *   - every corpus sentence must be caught by a pattern (a new way of saying
 *     "it stays here" fails until a pattern names it), and every pattern
 *     must catch a corpus sentence (a pattern nothing ships is decoration);
 *   - then no pattern may match anything drawn for a worker tool, in any
 *     status, for one file, a few, or more than one batch takes.
 * The worker set is discovered from the summaries by the panel's own
 * "Secure server" predicate (uploads, and no in-browser runner), held to the
 * catalogue's own count, and split into the tools with a batch and those
 * without, each half health-checked so neither walk is vacuous. A hybrid
 * tool WITH a runner (Compress) is not in it: its launch hands the files to
 * the in-browser runner, which uploads nothing, so its client words are true
 * — and it is the positive control.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WORKER_BATCH_TOOLS } from "@/lib/batch/tools";
import { isToolSupported } from "@/lib/pdf/registry";
import { getAiTools, tools } from "@/lib/tools";
import { modeUploadsFiles } from "@/lib/tools/processing-split";
import { planBatch, type WorkspaceFile } from "@/lib/workspace";
import { BatchPanel } from "./batch-panel";
import { buildToolSummaries, type WorkspaceToolSummary } from "./presenter";
import { batchToolInfoOf } from "./use-workspace";

afterEach(cleanup);

const summaries = buildToolSummaries();
const bySlug = new Map(summaries.map((s) => [s.slug, s]));

/** The shapes of "your files stay here", each one shipped for client tools. */
const STAYS_HERE: readonly RegExp[] = [
  /\bnothing (?:is|was|gets|will be) uploaded\b/i,
  /\bin your browser\b/i,
];

/** Which drawn sentences the corpus takes: any that speaks of where files go. */
const SPEAKS_OF_PLACE = /upload|browser|device|server|leave/i;

function filesOf(n: number): WorkspaceFile[] {
  return Array.from(
    { length: n },
    (_, i) =>
      ({
        id: `f${i}`,
        name: `file-${i + 1}.pdf`,
        size: 1000,
        mime: "application/pdf",
        kind: "PDF",
        family: "pdf",
      }) as unknown as WorkspaceFile,
  );
}

/** What the launch area says for `tool` with `n` files queued, and its status. */
function launchArea(
  tool: WorkspaceToolSummary,
  n: number,
): { status: string; text: string } {
  const files = filesOf(n);
  const batch = { toolSlug: tool.slug, fileIds: files.map((f) => f.id) };
  const plan = planBatch(batch, (slug) => {
    const summary = bySlug.get(slug);
    return summary ? batchToolInfoOf(summary) : undefined;
  });
  const { container, unmount } = render(
    <BatchPanel
      files={files}
      summaries={summaries}
      batch={batch}
      plan={plan}
      onSetTool={() => {}}
      onAddAll={() => {}}
      onRemove={() => {}}
      onClear={() => {}}
      onLaunch={() => {}}
      launchingSlug={null}
    />,
  );
  const region = container.querySelector('[role="status"]');
  const text = region?.textContent ?? "";
  unmount();
  return { status: plan.status, text };
}

/** One file, a few, and more than the largest batch takes. */
function counts(tool: WorkspaceToolSummary): number[] {
  return [1, 3, (tool.batchMaxFiles ?? 20) + 2];
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const workerTools = summaries.filter((s) => !s.live && s.uploadsFiles);
const clientTools = summaries.filter((s) => s.live);
const batchSlugs = new Set(Object.keys(WORKER_BATCH_TOOLS));

describe("the discovered sets", () => {
  it("every uploading tool in the catalogue, split into batch and no batch", () => {
    const catalogue = tools.filter(
      (t) => modeUploadsFiles(t.processing) && !isToolSupported(t.slug),
    );
    // Health: the walk sees the catalogue's own count, not a shrunken set.
    expect(workerTools.map((t) => t.slug).sort()).toEqual(
      catalogue.map((t) => t.slug).sort(),
    );
    expect(workerTools.length).toBeGreaterThanOrEqual(20);
    const withBatch = workerTools.filter((t) => batchSlugs.has(t.slug));
    const without = workerTools.filter((t) => !batchSlugs.has(t.slug));
    expect(withBatch.length).toBe(batchSlugs.size);
    expect(without.length).toBeGreaterThanOrEqual(5);
    // An AI tool among them, by the catalogue's own list of AI tools.
    const ai = new Set(getAiTools().map((t) => t.slug));
    expect(without.some((t) => ai.has(t.slug))).toBe(true);
    expect(clientTools.length).toBeGreaterThanOrEqual(25);
  });
});

describe("the launch area's 'stays here' words", () => {
  const corpus = clientTools.flatMap((tool) =>
    counts(tool).flatMap((n) =>
      sentences(launchArea(tool, n).text).filter((s) =>
        SPEAKS_OF_PLACE.test(s),
      ),
    ),
  );
  const unique = [...new Set(corpus)];

  it("positive control: an in-browser tool says its browser words", () => {
    const compress = bySlug.get("compress-pdf")!;
    const { status, text } = launchArea(compress, 3);
    expect(status).toBe("ready");
    expect(STAYS_HERE.every((p) => p.test(text))).toBe(true);
  });

  it("every corpus sentence is caught by a pattern", () => {
    // Health: the corpus is the client copy, not an empty set.
    expect(unique.length).toBeGreaterThanOrEqual(4);
    const uncaught = unique.filter((s) => !STAYS_HERE.some((p) => p.test(s)));
    expect(uncaught).toEqual([]);
  });

  it("every pattern catches a corpus sentence", () => {
    const idle = STAYS_HERE.filter((p) => !unique.some((s) => p.test(s)));
    expect(idle.map(String)).toEqual([]);
  });

  it("no pattern matches anything drawn for a worker tool, in any status", () => {
    const seen = new Set<string>();
    const offending: string[] = [];
    for (const tool of workerTools)
      for (const n of counts(tool)) {
        const { status, text } = launchArea(tool, n);
        seen.add(status);
        // Health: the status said SOMETHING, so a blank region cannot pass.
        expect(text.length, `${tool.slug} × ${n}`).toBeGreaterThan(20);
        for (const p of STAYS_HERE)
          if (p.test(text)) offending.push(`${tool.slug} × ${n}: ${text}`);
      }
    // Health: both worker statuses were drawn, so both copies were read.
    expect([...seen].sort()).toEqual(["worker-batch", "worker-disabled"]);
    expect(offending).toEqual([]);
  });
});

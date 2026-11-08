// @vitest-environment jsdom
/**
 * What the workspace's launch area says before it hands files to a batch
 * tool (batch plan P1): the five settings batches are batch tools now, not
 * "works on one PDF at a time", and a set larger than one batch takes is
 * told that only the first files open in it — a batch lists the rest with
 * the reason (`capBatchFiles`), so "runs on each of these 25 files" was
 * false of any PDF batch, Compress's included, since the cap shipped.
 *
 * The summaries are the page's own (`buildToolSummaries`), so the cap is
 * the number the presenter derives, not one typed here.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BATCH_LIMITS } from "@/lib/batch/limits";
import { planBatch, type WorkspaceFile } from "@/lib/workspace";
import { BatchPanel } from "./batch-panel";
import { buildToolSummaries, type WorkspaceToolSummary } from "./presenter";

afterEach(cleanup);

const summaries = buildToolSummaries();
const bySlug = new Map(summaries.map((s) => [s.slug, s]));

function filesOf(n: number): WorkspaceFile[] {
  return Array.from(
    { length: n },
    (_, i) =>
      ({
        id: `f${i}`,
        name: `scan-${i + 1}.pdf`,
        size: 1000,
        mime: "application/pdf",
        kind: "PDF",
        family: "pdf",
      }) as unknown as WorkspaceFile,
  );
}

function renderPanel(slug: string, n: number) {
  const files = filesOf(n);
  const batch = { toolSlug: slug, fileIds: files.map((f) => f.id) };
  const plan = planBatch(batch, (s) => {
    const t = bySlug.get(s);
    return t
      ? {
          live: t.live,
          usesWorker: t.uploadsFiles,
          handoff: t.handoffMode,
        }
      : undefined;
  });
  render(
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
  return { plan, tool: bySlug.get(slug) as WorkspaceToolSummary };
}

const max = BATCH_LIMITS.clientMaxFiles;

describe("the workspace launch area for a PDF batch tool", () => {
  it.each(["rotate-pdf", "compress-pdf"])(
    "%s: a set past one batch says only the first files open, and the rest are listed",
    (slug) => {
      const { plan, tool } = renderPanel(slug, max + 5);
      expect(plan.status).toBe("ready");
      expect(tool.batchMaxFiles).toBe(max);
      expect(
        screen.getByText(
          `${tool.name} runs on up to ${max} files at a time, right here in your browser: the first ${max} of these open in its batch, and the other 5 are listed there with the reason. They load straight in — nothing is uploaded.`,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/runs on each of these/)).toBeNull();
    },
  );

  it("control: a set one batch takes runs on each file", () => {
    const { tool } = renderPanel("rotate-pdf", 3);
    expect(
      screen.getByText(
        `${tool.name} runs on each of these 3 files right here in your browser. They load straight in — nothing is uploaded.`,
      ),
    ).toBeInTheDocument();
  });

  it("one file: it runs on this file, never 'each of these 1 file'", () => {
    const { tool } = renderPanel("rotate-pdf", 1);
    expect(
      screen.getByText(
        `${tool.name} runs on this file right here in your browser. It loads straight in — nothing is uploaded.`,
      ),
    ).toBeInTheDocument();
  });

  it("a settings batch tool is no longer 'one PDF at a time' (inverted)", () => {
    // WAS "works on one PDF at a time. It opens with your first queued
    // file" until 2026-11-08: Rotate took the first file and left the rest.
    renderPanel("rotate-pdf", 2);
    expect(screen.queryByText(/one PDF at a time/)).toBeNull();
    expect(
      screen.getByRole("button", { name: /Open Rotate PDF with 2 files/ }),
    ).toBeInTheDocument();
  });

  it("control: a single-file tool still opens the first file", () => {
    renderPanel("organize-pages", 2);
    expect(screen.getByText(/works on one PDF at a time/)).toBeInTheDocument();
  });
});

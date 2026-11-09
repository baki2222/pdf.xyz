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
import { batchMaxFilesFor } from "@/lib/batch/tools";
import { workerBatchEachFileSentence } from "@/lib/batch/worker-copy";
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

/*
 * Batch plan P6: a worker tool with a batch launches from here into its
 * batch list. Its words are its own — the files ARE uploaded, one job per
 * file, when Run is pressed on the tool's page — and every number is the
 * presenter's: the cap from `batchMaxFilesFor`, the hourly jobs from the
 * limiter's constants (`workerBatchEachFileSentence`).
 */
describe("the workspace launch area for a worker tool with a batch", () => {
  const cost = workerBatchEachFileSentence();

  it("several files: they open in its batch list and go up one job each, on Run", () => {
    const { plan, tool } = renderPanel("repair-pdf", 3);
    expect(plan).toMatchObject({ status: "worker-batch", ready: true });
    expect(
      screen.getByText("Ready — 3 files, for our secure server"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `${tool.name} runs on our secure server, so these files are uploaded. They open in a batch list on the tool’s page first; each one is uploaded only when you press the button under that list, in turn, one job per file. ${cost}`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Open ${tool.name} with 3 files` }),
    ).toBeInTheDocument();
    // Launchable, so not the preview link a worker tool without a batch gets.
    expect(screen.queryByRole("link", { name: /See how it works/ })).toBeNull();
  });

  it.each(["repair-pdf", "word-to-pdf", "ocr-pdf"])(
    "%s: a set past one batch names the cap, and the rest are listed there",
    (slug) => {
      const cap = batchMaxFilesFor(slug);
      const { tool } = renderPanel(slug, cap + 2);
      expect(tool.batchMaxFiles).toBe(cap);
      expect(
        screen.getByText(
          `${tool.name} runs on our secure server, so these files are uploaded. One batch takes up to ${cap} files: the first ${cap} of these open in its list on the tool’s page, and the other 2 are listed there with the reason. Each file in the list is uploaded only when you press the button under it, in turn, one job per file. ${cost}`,
        ),
      ).toBeInTheDocument();
    },
  );

  it("one file: it opens on the tool's page, and goes up on its button", () => {
    const { tool } = renderPanel("unlock-pdf", 1);
    expect(
      screen.getByText(
        `${tool.name} runs on our secure server, so this file is uploaded. It opens on the tool’s page first, and is uploaded only when you press the tool’s button there. ${cost}`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Open ${tool.name} with 1 file` }),
    ).toBeInTheDocument();
  });

  it("control: a worker tool with no batch still cannot launch from here", () => {
    const { plan, tool } = renderPanel("summarize-pdf", 3);
    expect(plan).toMatchObject({ status: "worker-disabled", ready: false });
    expect(tool.workerBatchCost).toBeUndefined();
    expect(screen.getByText("Runs on a secure server")).toBeInTheDocument();
    expect(
      screen.getByText(
        `${tool.name} runs on a secure server, so your file is uploaded rather than processed on your device. Open the tool to see exactly what happens to your files first.`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    expect(
      screen.getByRole("link", { name: /See how it works/ }),
    ).toBeInTheDocument();
  });
});

describe("the workspace launch area before anything can launch", () => {
  it("names what is missing, for each empty status", () => {
    const empty = render(
      <BatchPanel
        files={[]}
        summaries={summaries}
        batch={{ toolSlug: null, fileIds: [] }}
        plan={planBatch({ toolSlug: null, fileIds: [] }, () => undefined)}
        onSetTool={() => {}}
        onAddAll={() => {}}
        onRemove={() => {}}
        onClear={() => {}}
        onLaunch={() => {}}
        launchingSlug={null}
      />,
    );
    expect(screen.getByText("Nothing to run yet")).toBeInTheDocument();
    empty.unmount();
    const { plan } = renderPanel("does-not-exist", 2);
    expect(plan.status).toBe("unavailable");
    expect(screen.getByText("Not batch-ready yet")).toBeInTheDocument();
  });
});

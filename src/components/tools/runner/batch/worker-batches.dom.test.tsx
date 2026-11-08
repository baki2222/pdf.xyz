// @vitest-environment jsdom
/**
 * The worker batches (batch plan P3), through each page's OWN panel: the
 * module the tool page mounts (`ownPanelModules`, read from the page's
 * dispatch), two real Files on its file input, the batch's Run, and the
 * network the real job client meets (`stubJobNetwork`).
 *
 * The SET is the registration (`WORKER_BATCH_TOOLS`), and each slug's panel
 * is found from the page, never typed — so a registered tool whose panel
 * never forks to the batch fails here (CLAUDE.md: verify the composed
 * chain; loading a module is not running it). HTML to PDF is the negative
 * control: it shares EPUB to PDF's panel and stays one file at a time.
 *
 * For every registered tool, two files make:
 *   - the batch view, not the single-file panel;
 *   - exactly two jobs, each of today's exact shape (this tool, ONE input);
 *   - one telemetry outcome per file — the job reports it, the batch does
 *     not (`reportsOutcome: false`);
 *   - nothing written to `useWorkerJob`'s sessionStorage resume key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { WORKER_BATCH_TOOLS, type WorkerBatchSlug } from "@/lib/batch/tools";
import {
  WORKER_BATCH_PAUSED,
  workerBatchJobsSentence,
} from "@/lib/batch/worker-copy";
import { RATE_LIMITS } from "@/lib/jobs/types";
import { getToolBySlug } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  configureTelemetry,
  resetTelemetry,
  type RedactedEvent,
} from "@/lib/telemetry/track";
import { enterToolPage } from "@/lib/telemetry/tool-outcome";
import { stubJobNetwork } from "@/tests/stub-job-network";
import { signedPdf } from "@/tests/signed-pdf";
import { ownPanelModules } from "@/tests/tool-panel-modules";
import { BATCH_VIEW_LOADED } from "./batch-view";
import { signedSkipReason } from "./worker-batch-runner";

const READY = {
  mode: "remote-configured",
  enabled: true,
  localDevOnly: false,
  detail: "remote",
  compress: { lossless: false, deep: false, engines: [] },
  ocr: { available: false, engine: null, languages: [], detail: "off" },
  scan: { active: false, detail: "not scanned" },
  security: { available: true, operations: [], detail: "qpdf" },
  providers: {
    storage: { ready: true },
    queue: { ready: true },
    processor: { ready: true },
  },
  daemon: { drainable: true, detail: "ready" },
  ai: { ready: false },
  pipeline: { verdict: "off", observed: false, drainable: false, detail: "" },
} as unknown as WorkerStatus;

const EXTENSION: Record<string, { ext: string; type: string }> = {
  PDF: { ext: "pdf", type: "application/pdf" },
  DOCX: {
    ext: "docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  XLSX: {
    ext: "xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  PPTX: {
    ext: "pptx",
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  EPUB: { ext: "epub", type: "application/epub+zip" },
  HTML: { ext: "html", type: "text/html" },
};

/** A file this tool takes, by its first catalogue format. */
function fileFor(tool: Tool, name: string, bytes?: Uint8Array): File {
  const format = tool.accept.find((f) => f in EXTENSION);
  if (!format) throw new Error(`${tool.slug}: no fixture for ${tool.accept}`);
  const { ext, type } = EXTENSION[format]!;
  return new File(
    [(bytes ?? new TextEncoder().encode("%PDF-1.7\n%%EOF\n")) as BlobPart],
    `${name}.${ext}`,
    { type },
  );
}

const { bySlug } = ownPanelModules();

async function panelFor(slug: string): Promise<ComponentType<{ tool: Tool }>> {
  const panel = bySlug.get(slug);
  if (!panel || panel.dispatch !== "worker")
    throw new Error(`${slug}: its page mounts no worker panel`);
  const mod = (await import(/* @vite-ignore */ panel.file)) as Record<
    string,
    ComponentType<{ tool: Tool }>
  >;
  const Panel = mod[panel.name];
  if (!Panel) throw new Error(`${panel.file} exports no ${panel.name}`);
  return Panel;
}

let events: RedactedEvent[] = [];
let leave: () => void = () => {};
let storageWrites: string[] = [];
const originalSetItem = Storage.prototype.setItem;
beforeEach(() => {
  events = [];
  storageWrites = [];
  configureTelemetry((e) => events.push(e));
  Storage.prototype.setItem = function (key: string, value: string) {
    storageWrites.push(key);
    return originalSetItem.call(this, key, value);
  };
});
afterEach(() => {
  cleanup();
  leave();
  resetTelemetry();
  resetAnnouncer();
  Storage.prototype.setItem = originalSetItem;
  vi.unstubAllGlobals();
});

const outcomes = () =>
  events
    .map((e) => e.name)
    .filter((n) => n === "tool_completed" || n === "tool_failed");

/** Every job completes with an artifact of its own. */
function network() {
  let n = 0;
  return stubJobNetwork(READY, () => {
    n += 1;
    return {
      status: "completed",
      artifact: {
        artifact: {
          artifactId: `art_${n}`,
          filename: `out-${n}.pdf`,
          contentType: "application/pdf",
          bytes: 8,
          url: `/__art/${n}`,
          expiresAt: new Date(0).toISOString(),
        },
        bytes: new TextEncoder().encode("%PDF-out"),
      },
    };
  });
}

async function dropTwo(slug: string, files?: File[]) {
  const tool = getToolBySlug(slug)!;
  leave = enterToolPage({ toolSlug: slug, capability: "secure-worker" });
  const Panel = await panelFor(slug);
  const view = render(<Panel tool={tool} />);
  const input = await waitFor(() => {
    const el = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(el).not.toBeNull();
    return el!;
  });
  fireEvent.change(input, {
    target: {
      files: files ?? [fileFor(tool, "first"), fileFor(tool, "second")],
    },
  });
  return { tool, view };
}

const SLUGS = Object.keys(WORKER_BATCH_TOOLS) as WorkerBatchSlug[];

describe("every registered worker batch, through its page's own panel", () => {
  it("health: the registration holds P3's ten tools, and each page mounts a worker panel", () => {
    expect(SLUGS.length).toBe(10);
    for (const slug of SLUGS)
      expect(bySlug.get(slug)?.dispatch, slug).toBe("worker");
  });

  for (const slug of SLUGS) {
    it(`${slug}: two files open the batch, and Run sends two of today's single jobs`, async () => {
      const net = network();
      const { tool, view } = await dropTwo(slug);
      await waitFor(() =>
        expect(
          view.container.querySelector(`[data-chunk="${BATCH_VIEW_LOADED}"]`),
        ).not.toBeNull(),
      );
      const { verb, noun } = WORKER_BATCH_TOOLS[slug];
      // The sentence before Run, from the constants.
      expect(view.container.textContent).toContain(workerBatchJobsSentence(2));
      expect(view.container.textContent).toContain(
        `${RATE_LIMITS.jobsPerHourPerClient} server jobs an hour`,
      );
      const run = await screen.findByRole("button", {
        name: `${verb} 2 ${noun[1]}`,
      });
      // Run waits for the panel's own check.
      await waitFor(() => expect(run).not.toHaveAttribute("aria-disabled"));
      fireEvent.click(run);
      await screen.findByText("Batch complete. 2 done, 0 failed.", undefined, {
        timeout: 5000,
      });
      expect(net.jobBodies).toHaveLength(2);
      for (const body of net.jobBodies) {
        expect(body.tool).toBe(tool.slug);
        expect(body.inputs).toHaveLength(1);
      }
      expect(net.uploads()).toBe(2);
      expect(outcomes()).toEqual(["tool_completed", "tool_completed"]);
      expect(storageWrites.filter((k) => /job/i.test(k))).toEqual([]);
    });
  }

  it("Optimize for Web leaves a signed PDF out, unsent, and runs the other", async () => {
    const net = network();
    const tool = getToolBySlug("optimize-web")!;
    const signed = await signedPdf({ signatures: 2 });
    const { view } = await dropTwo("optimize-web", [
      fileFor(tool, "signed", signed),
      fileFor(tool, "plain"),
    ]);
    const run = await screen.findByRole("button", { name: "Optimize 2 PDFs" });
    await waitFor(() => expect(run).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(run);
    await screen.findByText("Batch complete. 1 done, 0 failed, 1 skipped.");
    expect(view.container.textContent).toContain(
      signedSkipReason(2, "Optimizing"),
    );
    expect(net.uploads()).toBe(1);
    expect(net.jobBodies).toHaveLength(1);
  });

  it("a rate limit pauses: the banner says so, Continue now waits for the limit, the file is never failed, and the batch carries on by itself", async () => {
    let reservations = 0;
    let jobs = 0;
    const json = (value: unknown, status = 200, headers = {}) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json", ...headers },
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.includes("/api/worker/status")) return json(READY);
        if (url === "/api/uploads") {
          reservations += 1;
          // The second file's first reservation is refused for one second.
          if (reservations === 2)
            return json(
              { error: { code: "rate_limited", message: "Too many." } },
              429,
              { "Retry-After": "1" },
            );
          return json({
            slots: [
              {
                fileId: `f${reservations}`,
                url: "/__put",
                method: "PUT",
                headers: {},
              },
            ],
          });
        }
        if (url === "/__put") return json({});
        if (url === "/api/jobs" && method === "POST") {
          jobs += 1;
          return json({
            jobId: `job_${jobs}`,
            status: "completed",
            artifacts: [
              {
                artifactId: `a${jobs}`,
                filename: `out-${jobs}.pdf`,
                contentType: "application/pdf",
                bytes: 8,
                url: `/__art/${jobs}`,
                expiresAt: new Date(0).toISOString(),
              },
            ],
          });
        }
        if (url.startsWith("/__art/")) return new Response("%PDF-out");
        throw new Error(`unexpected ${method} ${url}`);
      }),
    );
    const { view } = await dropTwo("repair-pdf");
    const run = await screen.findByRole("button", { name: "Repair 2 PDFs" });
    await waitFor(() => expect(run).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(run);
    const status = await screen.findByText(WORKER_BATCH_PAUSED);
    expect(status).toHaveAttribute("role", "status");
    const banner = view.container.querySelector("[data-batch-paused]")!;
    expect(banner.textContent).toMatch(/Continuing in about 1 second/);
    const now = screen.getByRole("button", { name: "Continue now" });
    expect(now).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(view.container.textContent).not.toMatch(/failed/);
    await screen.findByText("Batch complete. 2 done, 0 failed.", undefined, {
      timeout: 5000,
    });
    // The paused file was asked for again: three reservations, two jobs.
    expect(reservations).toBe(3);
    expect(jobs).toBe(2);
  });

  it("control: HTML to PDF, on the same panel as EPUB to PDF, stays one file", async () => {
    stubJobNetwork(READY);
    const tool = getToolBySlug("html-to-pdf")!;
    const { view } = await dropTwo("html-to-pdf", [
      fileFor(tool, "a"),
      fileFor(tool, "b"),
    ]);
    await screen.findByText("a.html");
    expect(
      view.container.querySelector(`[data-chunk="${BATCH_VIEW_LOADED}"]`),
    ).toBeNull();
  });
});

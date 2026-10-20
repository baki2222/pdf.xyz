// @vitest-environment jsdom
/**
 * A worker job that outlives the browser's wait is still the user's job.
 *
 * Every panel rendered a stopped wait as an error: "Stopped waiting for the
 * worker — the job may still finish. (job job_…)". Nothing could open that id,
 * so a long OCR scan, a detailed summary or a large deck finished on the
 * worker — already charged to the day's AI allowance — while the page told the
 * user to start again. Nothing could cancel a run either, and a reload forgot
 * the job completely.
 *
 * THE SUBJECTS ARE DISCOVERED from the panel registry the tool page indexes
 * (see `@/tests/worker-panel-dispatch`), and each panel is driven through the REAL
 * browser client over a stubbed network:
 *   - a job this tab left running (its id in sessionStorage, as the panel
 *     stores it) is offered back with "Keep waiting";
 *   - Keep waiting polls THAT job and reaches the downloadable result;
 *   - "Cancel the job" sends the job's DELETE.
 * Then one panel end to end: a fresh run whose status reads fail is offered
 * back rather than reported as an error, with a Cancel button while it runs
 * and a label that says it is waiting, not working.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { OCR_LANGUAGE_CODES } from "@/lib/jobs/ocr";
import { resetTelemetry } from "@/lib/telemetry/track";
import {
  catalogTool,
  panelComponent,
  panelDispatchArms,
} from "@/tests/worker-panel-dispatch";
import { LOST_CONNECTION, useWorkerJob } from "./worker-job";
import { readyFileInput } from "@/tests/worker-ready";

const ARMS = panelDispatchArms();
const SUBJECTS = ARMS.flatMap((arm) =>
  arm.slugs.map((slug) => ({ slug, ...arm })),
);
const JOB_ID = "job_leftrunning1";
const STORAGE_KEY = (slug: string) => `pdfxyz.workerJob.${slug}`;

const providers = getProviderReadiness("remote-configured");
/** Everything ready, so every panel mounts its run area. */
const READY: WorkerStatus = {
  mode: "remote-configured",
  enabled: true,
  localDevOnly: false,
  detail: "A worker backend is configured.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: true, detail: "scanned" },
  ocr: {
    available: true,
    engine: "ocrmypdf",
    languages: [...OCR_LANGUAGE_CODES],
    detail: "OCR runs on the worker.",
  },
  security: {
    available: true,
    operations: ["protect", "unlock"],
    detail: "qpdf runs on the worker.",
  },
  providers: {
    ...providers,
    storage: { ...providers.storage, ready: true },
    queue: { ...providers.queue, ready: true },
  },
  daemon: { ...resolveDaemonReadiness({}), drainable: true },
  ai: resolveAiReadiness({
    PDFXYZ_AI_PROVIDER: "openai",
    PDFXYZ_AI_MODEL: "gpt-5.6-luna",
  }),
  pipeline: {
    verdict: "live",
    observed: true,
    drainable: true,
    detail: "worker observed",
  },
};

function completedJob(tool: string) {
  return {
    jobId: JOB_ID,
    tool,
    capability: "worker",
    status: "completed",
    progress: 100,
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    artifacts: [
      {
        artifactId: "a1",
        filename: "resumed-output.zip",
        contentType: "application/zip",
        bytes: 4,
        url: "/download/a1",
        expiresAt: "2026-09-27T01:00:00.000Z",
      },
    ],
  };
}

function stub(tool: string) {
  const calls: { url: string; method: string }[] = [];
  const json = (body: unknown, status = 200) => ({
    ok: status < 400,
    status,
    json: async () => body,
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string }) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (url === "/api/worker/status") return json(READY);
      if (url === `/api/jobs/${JOB_ID}` && init?.method === "DELETE")
        return json({ jobId: JOB_ID, status: "canceled" });
      if (url === `/api/jobs/${JOB_ID}`) return json(completedJob(tool));
      if (url === "/download/a1") return json({});
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  resetTelemetry();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  sessionStorage.clear();
});

describe("the corpus", () => {
  it("is every panel the tool page dispatches to", () => {
    expect(ARMS.length).toBeGreaterThanOrEqual(13);
    expect(SUBJECTS.length).toBeGreaterThanOrEqual(20);
  });
});

describe.each(SUBJECTS.map((s) => [s.slug, s] as const))("%s", (slug, arm) => {
  it("offers a job this tab left running back, and Keep waiting reaches its result", async () => {
    const calls = stub(slug);
    sessionStorage.setItem(
      STORAGE_KEY(slug),
      JSON.stringify({ jobId: JOB_ID, expiresAt: Date.now() + 60_000 }),
    );
    const Panel = await panelComponent(arm);
    render(createElement(Panel, { tool: catalogTool(slug) }));

    const keep = await screen.findByRole("button", { name: /keep waiting/i });
    await act(async () => {
      fireEvent.click(keep);
    });
    await waitFor(
      () =>
        expect(document.body.textContent ?? "").toContain("resumed-output.zip"),
      { timeout: 4000 },
    );
    // It polled THAT job; it did not upload or create another.
    expect(calls.some((c) => c.url === `/api/jobs/${JOB_ID}`)).toBe(true);
    expect(calls.some((c) => c.url === "/api/uploads")).toBe(false);
    expect(
      calls.some((c) => c.url === "/api/jobs" && c.method === "POST"),
    ).toBe(false);
    // Finished: nothing left to offer back after a reload.
    expect(sessionStorage.getItem(STORAGE_KEY(slug))).toBeNull();
  });

  it("Cancel the job sends the job's DELETE and forgets it", async () => {
    const calls = stub(slug);
    sessionStorage.setItem(
      STORAGE_KEY(slug),
      JSON.stringify({ jobId: JOB_ID, expiresAt: Date.now() + 60_000 }),
    );
    const Panel = await panelComponent(arm);
    render(createElement(Panel, { tool: catalogTool(slug) }));
    fireEvent.click(
      await screen.findByRole("button", { name: /cancel the job/i }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url === `/api/jobs/${JOB_ID}` && c.method === "DELETE",
        ),
      ).toBe(true),
    );
    expect(screen.queryByRole("button", { name: /keep waiting/i })).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY(slug))).toBeNull();
  });

  it("POSITIVE CONTROL: with nothing saved, nothing is offered", async () => {
    stub(slug);
    const Panel = await panelComponent(arm);
    render(createElement(Panel, { tool: catalogTool(slug) }));
    // The run area is up (its status line has resolved)…
    await waitFor(() =>
      expect(document.body.textContent ?? "").not.toMatch(
        /Checking the secure worker/,
      ),
    );
    // …and there is no job to keep waiting on.
    expect(screen.queryByRole("button", { name: /keep waiting/i })).toBeNull();
  });

  it("an expired or malformed saved job is not offered", async () => {
    stub(slug);
    sessionStorage.setItem(
      STORAGE_KEY(slug),
      JSON.stringify({ jobId: JOB_ID, expiresAt: Date.now() - 1 }),
    );
    const Panel = await panelComponent(arm);
    render(createElement(Panel, { tool: catalogTool(slug) }));
    await waitFor(() =>
      expect(document.body.textContent ?? "").not.toMatch(
        /Checking the secure worker/,
      ),
    );
    expect(screen.queryByRole("button", { name: /keep waiting/i })).toBeNull();
  });
});

describe("a fresh run, end to end (Extract Tables)", () => {
  it("says it is waiting, can be canceled, and a lost wait is offered back — not reported as an error", async () => {
    const arm = ARMS.find((a) => a.slugs.includes("extract-tables"))!;
    const calls: { url: string; method: string }[] = [];
    let statusReads = 0;
    let fail = false;
    const json = (body: unknown, status = 200) => ({
      ok: status < 400,
      status,
      json: async () => body,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string }) => {
        calls.push({ url, method: init?.method ?? "GET" });
        if (url === "/api/worker/status") return json(READY);
        if (url === "/api/uploads")
          return json({
            slots: [
              { fileId: "f1", url: "/upload/f1", method: "PUT", headers: {} },
            ],
          });
        if (url === "/upload/f1") return json({});
        if (url === "/api/jobs")
          return json({
            jobId: JOB_ID,
            tool: "extract-tables",
            status: "queued",
          });
        if (url === `/api/jobs/${JOB_ID}`) {
          statusReads += 1;
          return fail
            ? json({}, 503)
            : json({ jobId: JOB_ID, tool: "extract-tables", status: "queued" });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const Panel = await panelComponent(arm);
    render(createElement(Panel, { tool: catalogTool("extract-tables") }));
    const advance = async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };
    let input: Element | null = null;
    for (let i = 0; i < 50 && !input; i += 1) {
      await advance(10);
      input = readyFileInput();
    }
    fireEvent.change(input!, {
      target: {
        files: [
          new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "a.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /extract tables/i }));
    for (let i = 0; i < 20 && statusReads === 0; i += 1) await advance(500);

    // Queued, not "Extracting": the label says where the job is.
    expect(document.body.textContent).toContain("Waiting for the worker…");
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeTruthy();
    // The job id is saved while it may still be running.
    expect(sessionStorage.getItem(STORAGE_KEY("extract-tables"))).toContain(
      JOB_ID,
    );

    // The status endpoint goes away: three failed reads end the wait.
    fail = true;
    for (
      let i = 0;
      i < 40 && !screen.queryByRole("button", { name: /keep waiting/i });
      i += 1
    )
      await advance(1000);
    expect(screen.getByRole("button", { name: /keep waiting/i })).toBeTruthy();
    // Offered back, not reported as a failure.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body.textContent ?? "").not.toContain(JOB_ID);
  });

  it("Cancel during a run aborts it and sends the job's DELETE", async () => {
    const arm = ARMS.find((a) => a.slugs.includes("extract-tables"))!;
    const calls: { url: string; method: string }[] = [];
    const json = (body: unknown) => ({
      ok: true,
      status: 200,
      json: async () => body,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (
          url: string,
          init?: { method?: string; signal?: AbortSignal },
        ) => {
          calls.push({ url, method: init?.method ?? "GET" });
          if (init?.signal?.aborted)
            throw new DOMException("aborted", "AbortError");
          if (url === "/api/worker/status") return json(READY);
          if (url === "/api/uploads")
            return json({
              slots: [
                { fileId: "f1", url: "/upload/f1", method: "PUT", headers: {} },
              ],
            });
          if (url === "/upload/f1") return json({});
          if (url === "/api/jobs")
            return json({
              jobId: JOB_ID,
              tool: "extract-tables",
              status: "processing",
            });
          if (url === `/api/jobs/${JOB_ID}` && init?.method === "DELETE")
            return json({ jobId: JOB_ID, status: "canceled" });
          if (url === `/api/jobs/${JOB_ID}`)
            return json({
              jobId: JOB_ID,
              tool: "extract-tables",
              status: "processing",
            });
          throw new Error(`unexpected fetch ${url}`);
        },
      ),
    );
    const Panel = await panelComponent(arm);
    render(createElement(Panel, { tool: catalogTool("extract-tables") }));
    const input = await waitFor(() => {
      const found = readyFileInput();
      if (!found) throw new Error("no input");
      return found;
    });
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "a.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /extract tables/i }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === `/api/jobs/${JOB_ID}`)).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url === `/api/jobs/${JOB_ID}` && c.method === "DELETE",
        ),
      ).toBe(true),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/Canceled/);
    expect(sessionStorage.getItem(STORAGE_KEY("extract-tables"))).toBeNull();
  });
});

describe("useWorkerJob — the run always stops", () => {
  it("a rejected run ends busy with an honest message, and saves nothing", async () => {
    const { result } = renderHook(() =>
      useWorkerJob<{ ok: true }>({
        tool: "extract-tables",
        resume: async () => ({ ok: true }),
      }),
    );
    await act(async () => {
      await result.current.run(async (controls) => {
        controls.onJobCreated(JOB_ID);
        throw new TypeError("Failed to fetch");
      });
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.outcome).toEqual(LOST_CONNECTION);
    expect(sessionStorage.getItem(STORAGE_KEY("extract-tables"))).toBeNull();
  });

  it("storage that throws does not break a run", async () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });
    const { result } = renderHook(() =>
      useWorkerJob<{ ok: true }>({
        tool: "extract-tables",
        resume: async () => ({ ok: true }),
      }),
    );
    await act(async () => {
      await result.current.run(async (controls) => {
        controls.onJobCreated(JOB_ID);
        return { ok: false, message: "x", jobId: JOB_ID, stillRunning: true };
      });
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.outcome).toMatchObject({ stillRunning: true });
    setItem.mockRestore();
  });
});

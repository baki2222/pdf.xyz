// @vitest-environment jsdom
// @native-canvas
/**
 * One telemetry outcome per file, read at the sink, through the COMPOSED chain:
 * `CompressBatchRunner` → `useBatchRunner` → `compressBatchFileDeep` →
 * `runWorkerCompression`'s `withToolOutcome` (batch plan P0b).
 *
 * Until 2026-11-08 every server file was counted twice: the batch reported
 * each row, and the worker client reported the same job. The fix is one
 * option, `reportsOutcome: !deep`, and the review of P0b found nothing that
 * would go red if it became `true` again — the hook's option was tested, the
 * wiring from Compress was not. So this runs a real deep batch through the
 * real runner, with only `fetch` answered (no module is mocked:
 * `src/tests/mock-isolation.test.ts`):
 *
 * - a.pdf: the server compresses it — one `tool_completed`;
 * - b.pdf: the server's job fails — one `tool_failed`;
 * - c.pdf: the browser cannot read it (moved or revoked: `NotReadableError`)
 *   before anything is uploaded — one `tool_failed`, reported by the deep
 *   pre-flight, since it never reaches the worker client.
 *
 * And a lossless batch, which reports only through the hook, still reports
 * once per file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  configureTelemetry,
  resetTelemetry,
  type RedactedEvent,
} from "@/lib/telemetry/track";
import { enterToolPage } from "@/lib/telemetry/tool-outcome";
import type { WorkerStatus } from "@/lib/workers/status";
import { BATCH_DEEP_LABEL } from "@/lib/pdf/compress-batch-copy";
import { resetWorkerStatusForTests } from "../use-worker-status";
import { CompressBatchRunner } from "./compress-batch";

const router = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};

const DEEP_READY = {
  mode: "local-dev",
  localDevOnly: true,
  detail: "local dev server",
  compress: { lossless: true, deep: true, engines: ["ghostscript"] },
} as unknown as WorkerStatus;

const EPOCH = new Date(0).toISOString();
const RETENTION = {
  inputTtlMinutes: 60,
  outputTtlMinutes: 60,
  persistsAfterJob: false,
};

/**
 * Our server, as `fetch` sees it: a.pdf's job completes, b.pdf's fails. The
 * session's slot names the file it was asked for, so each job knows its file.
 */
function answerServer() {
  const requests: string[] = [];
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status });
  let current = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string, init?: { method?: string; body?: ArrayBuffer }) => {
        const method = init?.method ?? "GET";
        requests.push(`${method} ${url}`);
        if (url === "/api/worker/status") return json(DEEP_READY);
        if (url === "/api/uploads" && method === "POST") {
          const asked = JSON.parse(
            new TextDecoder().decode(new Uint8Array(init!.body!)),
          ) as { files?: { filename?: string }[] };
          current = asked.files?.[0]?.filename ?? "";
          return json(
            {
              sessionId: "sess_abcdefghij",
              tool: "compress-pdf",
              slots: [
                {
                  fileId: "f_abcdefghij",
                  filename: current,
                  url: "/api/uploads/local/f_abcdefghij",
                  method: "PUT",
                  headers: { "content-type": "application/pdf" },
                },
              ],
              expiresAt: EPOCH,
              retention: RETENTION,
            },
            201,
          );
        }
        if (url.startsWith("/api/uploads/local/") && method === "PUT")
          return json({ ok: true });
        if (url === "/api/jobs" && method === "POST") {
          const failed = current === "b.pdf";
          return json(
            {
              jobId: "job_abcdefghij",
              tool: "compress-pdf",
              capability: "hybrid",
              status: failed ? "failed" : "completed",
              progress: 100,
              ...(failed
                ? { error: { code: "processing_failed", message: "no" } }
                : {}),
              artifacts: failed
                ? []
                : [
                    {
                      artifactId: "art_abcdefghij",
                      filename: "a-compressed.pdf",
                      contentType: "application/pdf",
                      bytes: 3,
                      url: "/api/artifacts/local/art_abcdefghij",
                      expiresAt: EPOCH,
                    },
                  ],
              createdAt: EPOCH,
              updatedAt: EPOCH,
              expiresAt: EPOCH,
              retention: RETENTION,
            },
            201,
          );
        }
        if (url === "/api/artifacts/local/art_abcdefghij")
          return new Response(new Uint8Array([9, 9, 9]).buffer);
        throw new Error(`unexpected request in test: ${method} ${url}`);
      },
    ),
  );
  return { requests };
}

async function pdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1)
    doc.addPage([300, 200]).drawText(`Page ${i + 1}`, { x: 20, y: 100, font });
  return doc.save({ useObjectStreams: false });
}

const pdfFile = (bytes: Uint8Array, name: string) =>
  new File([bytes.slice()], name, { type: "application/pdf" });

/** A file the browser can no longer read: moved, or its permission revoked. */
function unreadableFile(name: string): File {
  const f = new File(["%PDF-1.4"], name, { type: "application/pdf" });
  Object.defineProperty(f, "arrayBuffer", {
    value: () =>
      Promise.reject(new DOMException("The file is gone.", "NotReadableError")),
  });
  return f;
}

let events: RedactedEvent[] = [];
let leave: () => void = () => {};
beforeEach(() => {
  events = [];
  resetWorkerStatusForTests();
  configureTelemetry((e) => events.push(e));
  leave = enterToolPage({ toolSlug: "compress-pdf", capability: "hybrid" });
});
afterEach(() => {
  leave();
  resetTelemetry();
  resetWorkerStatusForTests();
  vi.unstubAllGlobals();
});

const outcomes = () =>
  events.filter((e) => e.name === "tool_completed" || e.name === "tool_failed");

function renderBatch(files: File[]) {
  return render(
    <AppRouterContext.Provider value={router as never}>
      <CompressBatchRunner files={files} onReset={() => {}} />
    </AppRouterContext.Provider>,
  );
}

describe("CompressBatchRunner — one outcome per file, at the sink", () => {
  it("a deep batch: each server file once (not twice), and a file that never reaches the server once", async () => {
    const { requests } = answerServer();
    const bytes = await pdf(3);
    renderBatch([
      pdfFile(bytes, "a.pdf"),
      pdfFile(bytes, "b.pdf"),
      unreadableFile("c.pdf"),
    ]);
    fireEvent.click(await screen.findByLabelText(BATCH_DEEP_LABEL));
    fireEvent.click(
      screen.getByRole("button", { name: "Compress 3 PDFs on our server" }),
    );
    await screen.findByText(/^Batch complete\./, {}, { timeout: 10_000 });

    // The server was really used: two jobs, and c.pdf never left.
    expect(requests.filter((r) => r === "POST /api/jobs")).toHaveLength(2);

    const seen = outcomes();
    expect(seen.map((e) => e.name)).toEqual([
      "tool_completed",
      "tool_failed",
      "tool_failed",
    ]);
  }, 20_000);

  it("a lossless batch still reports each file once, through the batch", async () => {
    answerServer();
    const bytes = await pdf(20);
    renderBatch([pdfFile(bytes, "x.pdf"), pdfFile(bytes, "y.pdf")]);
    // The deep option is offered (the server is up), and not chosen.
    await screen.findByLabelText(BATCH_DEEP_LABEL);
    fireEvent.click(screen.getByRole("button", { name: "Compress 2 PDFs" }));
    await screen.findByText(/^Batch complete\./, {}, { timeout: 10_000 });
    expect(outcomes().map((e) => e.name)).toEqual([
      "tool_completed",
      "tool_completed",
    ]);
  }, 20_000);
});

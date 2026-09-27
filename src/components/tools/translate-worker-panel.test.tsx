// @vitest-environment jsdom
/**
 * How long the Translate panel waits for a job: long enough for the plan it
 * just computed.
 *
 * The worker translates one chunk per provider call, one after another, and
 * the browser waited a flat two minutes — shorter than a single call's own
 * default timeout. A document of several chunks was abandoned mid-job while
 * the worker finished it and charged the allowance for it.
 *
 * The chunk count is derived here from the SAME planner and the same ceiling
 * the panel uses, never typed, and the wait is read from what the panel
 * actually hands the job client.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { pageTextChunks } from "@/lib/pdf/text";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { planTranslateChunks } from "@/lib/workers/translate/chunking";
import { TRANSLATE_MAX_INPUT_CHARS } from "@/lib/jobs/translate-limits";
import {
  AI_JOB_POLL,
  pollWaitMs,
  translateJobPoll,
} from "@/lib/jobs/client-wait";
import { resetTelemetry } from "@/lib/telemetry/track";

const runWorkerTranslate = vi.hoisted(() => vi.fn());
const extracted = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/workers/translate-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workers/translate-client")>()),
  runWorkerTranslate,
}));
vi.mock("@/lib/pdf/text", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pdf/text")>()),
  extractPdfText: async () => extracted.value,
}));

const { TranslateWorkerPanel } = await import("./translate-worker-panel");

const tool = getToolBySlug("translate-pdf")!;
const providers = getProviderReadiness("remote-configured");
const READY: WorkerStatus = {
  mode: "remote-configured",
  enabled: true,
  localDevOnly: false,
  detail: "A worker backend is configured.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: true, detail: "scanned" },
  ocr: { available: false, engine: null, languages: [], detail: "off" },
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

/** `pages` pages, each just under a third of the per-call ceiling. */
function documentOf(pages: number): ExtractedPdfText {
  const text = "word ".repeat(Math.floor(TRANSLATE_MAX_INPUT_CHARS / 3 / 5));
  const list = Array.from({ length: pages }, (_, i) => ({
    pageNumber: i + 1,
    text,
    characterCount: text.length,
  }));
  return {
    pageCount: pages,
    pages: list,
    text: list.map((p) => p.text).join("\n\n"),
    characterCount: list.reduce((n, p) => n + p.characterCount, 0),
    hasText: true,
  };
}

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
  runWorkerTranslate.mockReset();
  document.body.innerHTML = "";
});

async function translate(doc: ExtractedPdfText) {
  extracted.value = doc;
  runWorkerTranslate.mockResolvedValue({ ok: false, message: "stub" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => READY })),
  );
  render(<TranslateWorkerPanel tool={tool} />);
  const input = await waitFor(() => {
    const found = document.querySelector('input[type="file"]');
    if (!found) throw new Error("no input");
    return found;
  });
  fireEvent.change(input, {
    target: {
      files: [
        new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "long.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  fireEvent.click(screen.getByRole("button", { name: /translate pdf/i }));
  await waitFor(() => expect(runWorkerTranslate).toHaveBeenCalledTimes(1));
  return runWorkerTranslate.mock.calls[0]![1] as {
    pollIntervalMs?: number;
    maxPollAttempts?: number;
  };
}

describe("Translate panel — the wait follows the plan", () => {
  it("a many-chunk document gets the wait its chunk count needs", async () => {
    const doc = documentOf(12);
    const chunks = planTranslateChunks(
      pageTextChunks(doc.pages),
      TRANSLATE_MAX_INPUT_CHARS,
    ).chunks.length;
    // Health: the fixture really is several provider calls.
    expect(chunks).toBeGreaterThanOrEqual(3);
    const options = await translate(doc);
    const expected = translateJobPoll(chunks);
    expect(options).toMatchObject({
      pollIntervalMs: expected.intervalMs,
      maxPollAttempts: expected.maxAttempts,
    });
    expect(pollWaitMs(expected)).toBeGreaterThan(pollWaitMs(AI_JOB_POLL));
  });

  it("POSITIVE CONTROL: a one-chunk document gets the ordinary AI wait", async () => {
    const options = await translate(documentOf(1));
    expect(options).toMatchObject({
      pollIntervalMs: AI_JOB_POLL.intervalMs,
      maxPollAttempts: AI_JOB_POLL.maxAttempts,
    });
  });
});

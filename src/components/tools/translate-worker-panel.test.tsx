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
 * the panel uses, never typed, and the wait is COUNTED on the wire: status
 * reads against a job that never finishes, until the panel offers Keep waiting.
 * No `vi.mock` — a mocked module stays cached for later files (mock-isolation).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

import { translateTextDeps } from "@/lib/workers/translate-client";
import { TranslateWorkerPanel } from "./translate-worker-panel";

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

const realExtract = translateTextDeps.extract;
const JOB = "job_translate1";

afterEach(() => {
  translateTextDeps.extract = realExtract;
  resetTelemetry();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/**
 * Translate `doc` against a job that never finishes, and count the status
 * reads the browser makes before it stops waiting — the wait as it reaches the
 * wire, not as the panel's source spells it.
 */
async function pollsBeforeGivingUp(doc: ExtractedPdfText) {
  translateTextDeps.extract = async () => doc;
  let polls = 0;
  const json = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
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
          jobId: JOB,
          tool: "translate-pdf",
          status: "processing",
        });
      if (url === `/api/jobs/${JOB}`) {
        polls += 1;
        return json({
          jobId: JOB,
          tool: "translate-pdf",
          status: "processing",
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  render(<TranslateWorkerPanel tool={tool} />);
  const input = await waitFor(() => {
    const found = document.querySelector('input[type="file"]');
    if (!found) throw new Error("no input");
    return found;
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
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
  for (
    let i = 0;
    i < 200 && !screen.queryByRole("button", { name: /keep waiting/i });
    i += 1
  )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
  expect(screen.getByRole("button", { name: /keep waiting/i })).toBeTruthy();
  return { polls };
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
    const expected = translateJobPoll(chunks);
    expect(pollWaitMs(expected)).toBeGreaterThan(pollWaitMs(AI_JOB_POLL));
    const { polls } = await pollsBeforeGivingUp(doc);
    expect(polls).toBe(expected.maxAttempts);
  });

  it("POSITIVE CONTROL: a one-chunk document gets the ordinary AI wait", async () => {
    const { polls } = await pollsBeforeGivingUp(documentOf(1));
    expect(polls).toBe(AI_JOB_POLL.maxAttempts);
  });
});

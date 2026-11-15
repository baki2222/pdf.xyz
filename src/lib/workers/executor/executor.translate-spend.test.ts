// @vitest-environment node
/**
 * THE COMPOSED CHAIN for a Translate PDF failure that came after the money.
 *
 * engine → processor → executor spend hook → the limiter the web tier reads.
 *
 * WHY (2026-11-15): the executor's spend hook sits above the success/failure
 * fork (executor.ts, "THE GLOBAL SPEND CEILING'S ADD PHASE") and was correct.
 * It recorded ZERO for a translate job whose package came out over the size
 * bound, because the engine's size arm returned no `window` and
 * `aiResultsFromFailure` therefore returned no block. Every unit was right in
 * isolation; only the path through all of them shows the debit.
 *
 * There was no executor-level spend test to extend: a search for
 * `aiSpendTokens`, `before the fork` and `recordAiSpend` across
 * `src/**\/*.test.ts` found the hook's docblock and the limiter's own unit
 * tests, nothing that drove a job through the executor and read the limiter.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, type Job } from "@/lib/jobs";
import { RATE_LIMIT_ENV } from "@/lib/ratelimit";
import {
  peekAiSpendCeiling,
  resetRateLimitGuardForTests,
} from "@/lib/ratelimit/guard";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { DevWorkerStore } from "../store";
import { createLocalDevQueue } from "../queue/local-dev";
import type { ClaimableQueue } from "../queue/claim";
import { ProcessorRegistry } from "../processor/registry";
import { createTranslateProcessor } from "../processor/translate";
import type { AiProvider } from "../ai/provider";
import type { TranslateLimits } from "../translate/engine";
import { createLocalDevExecutorStorage } from "./local-dev-storage";
import { createWorkerExecutor } from "./executor";
import type { ExecutorStorage } from "./types";

const TEXT = "A genuine document with content to translate.";

const extract = async (): Promise<ExtractedPdfText> => ({
  pageCount: 1,
  pages: [{ pageNumber: 1, text: TEXT, characterCount: TEXT.length }],
  text: TEXT,
  characterCount: TEXT.length,
  hasText: true,
});

const provider: AiProvider = {
  id: "anthropic",
  model: "claude-sonnet-5",
  async complete() {
    return {
      ok: true,
      text: "Un document authentique.",
      model: "claude-sonnet-5",
      usage: { inputTokens: 1_000, outputTokens: 400 },
    };
  },
};

describe("a translate job that failed after its calls debits the spend ceiling", () => {
  let clock: number;
  let store: DevWorkerStore;
  let queue: ClaimableQueue;
  let storage: ExecutorStorage;
  const previous = process.env[RATE_LIMIT_ENV.provider];

  beforeEach(() => {
    process.env[RATE_LIMIT_ENV.provider] = "local-memory";
    resetRateLimitGuardForTests();
    clock = Date.now();
    store = new DevWorkerStore(() => clock);
    queue = createLocalDevQueue({ store, now: () => clock });
    storage = createLocalDevExecutorStorage({ store, now: () => clock });
  });

  afterEach(() => {
    if (previous === undefined) delete process.env[RATE_LIMIT_ENV.provider];
    else process.env[RATE_LIMIT_ENV.provider] = previous;
    resetRateLimitGuardForTests();
  });

  async function runOne(jobId: string, limits: TranslateLimits) {
    const slot = store.reserveSlot({
      sessionId: "sess_test00000",
      filename: "report.pdf",
      contentType: "application/pdf",
      declaredBytes: 1,
    });
    store.putBytes(slot.fileId, new Uint8Array([1]));
    const job: Job = {
      jobId,
      tool: "translate-pdf",
      capability: "secure-worker",
      status: "queued",
      progress: 0,
      createdAt: new Date(clock).toISOString(),
      updatedAt: new Date(clock).toISOString(),
      expiresAt: new Date(clock + 60 * 60_000).toISOString(),
      retention: DEFAULT_RETENTION,
    };
    await queue.submit({
      job,
      inputs: [slot.fileId],
      options: { targetLanguage: "fr" },
    });
    const registry = new ProcessorRegistry().register(
      createTranslateProcessor({ extract, provider, limits }),
    );
    return createWorkerExecutor({
      queue,
      storage,
      registry,
      leaseMs: 1_000,
    }).drain();
  }

  it("the package-size arm is debited with the tokens its call spent", async () => {
    expect((await peekAiSpendCeiling()).used, "the bucket starts empty").toBe(
      0,
    );
    const ticks = await runOne("job_tsize00000", { maxOutputBytes: 1 });
    expect(ticks.map((t) => t.outcome)).toContain("failed");
    expect(store.getJob("job_tsize00000")?.status).toBe("failed");
    const used = (await peekAiSpendCeiling()).used;
    expect(
      used,
      "a translate job spent 1,400 tokens and failed on its package size, and " +
        "the ceiling recorded nothing — the engine's size arm lost its usage",
    ).toBeGreaterThan(0);
  });

  it("positive control: a successful job is debited through the same chain", async () => {
    const ticks = await runOne("job_tok000000", {});
    expect(ticks.map((t) => t.outcome)).toContain("completed");
    expect((await peekAiSpendCeiling()).used).toBeGreaterThan(0);
  });
});

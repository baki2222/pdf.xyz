/**
 * The browser's waits, held against the WORKER's bounds.
 *
 * A wait is a constant, and a constant has no relationships to constrain (house
 * rule 3): the old two-minute default sat for months beside a worker whose AI
 * call alone may take two minutes. The only check that sees a wrong number is
 * a second, independent one, so each budget below is compared with the value
 * the worker itself enforces — imported from the worker's own config here in
 * the test, never into the browser bundle.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AI_TIMEOUT_MS_BOUNDS } from "@/lib/workers/ai/config";
import { resolveNativeOfficeConversionConfig } from "@/lib/workers/office-conversion/native-config";
import { retryRequeueDelayMs } from "@/lib/workers/executor/executor";
import { OFFICE_TO_PDF_TOOLS } from "@/lib/workers/office-conversion/engine";
import { tools } from "@/lib/tools";
import { capabilityForMode } from "./capabilities";
import { RATE_LIMITS } from "./types";
import {
  AI_CALL_TIMEOUT_MS,
  AI_JOB_POLL,
  AI_JOB_TOOLS,
  browserStoppedWaitingAt,
  DEFAULT_JOB_POLL,
  FIRST_REQUEUE_DELAY_MS,
  jobPollFor,
  OFFICE_CONVERSION_TIMEOUT_MS,
  OFFICE_TO_PDF_JOB_POLL,
  OFFICE_TO_PDF_JOB_TOOLS,
  OCR_JOB_POLL,
  PIPELINE_MARGIN_MS,
  pollWaitMs,
  translateJobPoll,
} from "./client-wait";

describe("the client-safe copies equal the worker's own values", () => {
  it("one AI call", () => {
    expect(AI_CALL_TIMEOUT_MS).toBe(AI_TIMEOUT_MS_BOUNDS.default);
  });
  it("one LibreOffice run", () => {
    expect(OFFICE_CONVERSION_TIMEOUT_MS).toBe(
      resolveNativeOfficeConversionConfig({}).timeoutMs,
    );
  });
  it("the first requeue delay", () => {
    expect(FIRST_REQUEUE_DELAY_MS).toBe(retryRequeueDelayMs(1));
  });
});

describe("each budget outlasts the worker's own work", () => {
  it("AI: a call that times out, its retry, and the pipeline", () => {
    expect(pollWaitMs(AI_JOB_POLL)).toBeGreaterThanOrEqual(
      2 * AI_TIMEOUT_MS_BOUNDS.default +
        retryRequeueDelayMs(1) +
        PIPELINE_MARGIN_MS,
    );
  });

  it("AI: strictly longer than the two minutes it replaced", () => {
    expect(pollWaitMs(AI_JOB_POLL)).toBeGreaterThan(
      pollWaitMs(DEFAULT_JOB_POLL),
    );
  });

  it("translate: one provider call per chunk, one after another", () => {
    for (const chunks of [1, 2, 5, 12]) {
      expect(pollWaitMs(translateJobPoll(chunks))).toBeGreaterThanOrEqual(
        chunks * AI_TIMEOUT_MS_BOUNDS.default + PIPELINE_MARGIN_MS,
      );
      expect(pollWaitMs(translateJobPoll(chunks))).toBeGreaterThanOrEqual(
        pollWaitMs(AI_JOB_POLL),
      );
    }
  });

  it("Office to PDF: one LibreOffice timeout and the pipeline (a timeout is final, not retried)", () => {
    expect(pollWaitMs(OFFICE_TO_PDF_JOB_POLL)).toBeGreaterThanOrEqual(
      resolveNativeOfficeConversionConfig({}).timeoutMs + PIPELINE_MARGIN_MS,
    );
  });

  it("a long AI wait stays well inside the per-client status allowance", () => {
    const perMinute = 60_000 / AI_JOB_POLL.intervalMs;
    // Two tabs, or a resumed job beside a new one, must not trip the limiter:
    // three consecutive 429s end a poll as "lost contact".
    expect(2 * perMinute).toBeLessThan(
      RATE_LIMITS.statusRequestsPerMinutePerClient,
    );
  });
});

describe("the tool sets are the catalog's and the processor's, in both directions", () => {
  it("AI tools = the catalog's AI-mode tools that the worker runs", () => {
    const catalogAi = tools
      .filter((t) => capabilityForMode(t.processing) === "ai")
      .map((t) => t.slug);
    // Every slug named here is a catalog AI tool…
    for (const slug of AI_JOB_TOOLS) expect(catalogAi).toContain(slug);
    // …and the reverse direction is held by worker-job-resume.test.ts, which
    // drives every job client and requires the AI tools it reaches to be
    // exactly these.
    expect(AI_JOB_TOOLS.length).toBeGreaterThanOrEqual(4);
  });

  it("Office to PDF tools = the office-conversion processor's tools", () => {
    expect([...OFFICE_TO_PDF_JOB_TOOLS].sort()).toEqual(
      [...OFFICE_TO_PDF_TOOLS].sort(),
    );
    for (const tool of OFFICE_TO_PDF_TOOLS)
      expect(jobPollFor(tool)).toBe(OFFICE_TO_PDF_JOB_POLL);
  });

  it("POSITIVE CONTROL: a tool in neither set gets the default", () => {
    expect(jobPollFor("protect-pdf")).toBe(DEFAULT_JOB_POLL);
    expect(jobPollFor("summarize-pdf")).toBe(AI_JOB_POLL);
  });
});

describe("browserStoppedWaitingAt — what the deployment proof asks of every job", () => {
  it("is null inside the wait and names the moment past it", () => {
    const wait = pollWaitMs(AI_JOB_POLL);
    expect(browserStoppedWaitingAt("summarize-pdf", wait)).toBeNull();
    expect(browserStoppedWaitingAt("summarize-pdf", wait + 1)).toBe(wait);
    // POSITIVE CONTROL: the same elapsed time is past a default tool's wait.
    expect(browserStoppedWaitingAt("protect-pdf", wait)).toBe(
      pollWaitMs(DEFAULT_JOB_POLL),
    );
  });

  it("the proof's own timeout is longer than every browser wait it could miss", () => {
    // Otherwise the check above could never fire: the proof would time out
    // first and report a timeout instead.
    const source = readFileSync(
      path.resolve("scripts/worker-prove-tools.ts"),
      "utf8",
    );
    const timeout = Number(
      /const JOB_TIMEOUT_MS = ([\d_]+);/.exec(source)![1]!.replace(/_/g, ""),
    );
    expect(source).toContain("browserStoppedWaitingAt(spec.tool");
    for (const budget of [
      DEFAULT_JOB_POLL,
      OFFICE_TO_PDF_JOB_POLL,
      OCR_JOB_POLL,
    ])
      expect(timeout).toBeGreaterThan(pollWaitMs(budget));
  });
});

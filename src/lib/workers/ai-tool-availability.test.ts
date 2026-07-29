import { describe, expect, it } from "vitest";
import { aiToolUnavailableDetail, canRunAiTool } from "./ai-tool-availability";
import type { AiReadiness } from "./ai/readiness";
import type { WorkerStatus } from "./status";

const AI_READY: AiReadiness = {
  declared: true,
  provider: "anthropic",
  model: "claude-sonnet-5",
  configuredHere: false,
  ready: true,
  detail: "ai declared for this deployment",
};

const AI_OFF: AiReadiness = {
  declared: false,
  provider: null,
  model: null,
  configuredHere: false,
  ready: false,
  detail: "no ai provider is declared for this deployment",
};

/** A fully drainable remote deployment with AI declared — the runnable baseline. */
function status(overrides: Partial<WorkerStatus> = {}): WorkerStatus {
  return {
    mode: "remote-configured",
    enabled: false,
    localDevOnly: false,
    detail: "remote",
    compress: { lossless: false, deep: false, engines: [] },
    ocr: { available: false, engine: null, languages: [], detail: "off" },
    security: {
      available: false,
      operations: ["protect", "unlock", "repair", "optimize-web"],
      detail: "qpdf",
    },
    providers: {
      storage: {
        provider: "s3",
        ready: true,
        configured: true,
        signedUploads: true,
        signedDownloads: true,
        deleteNow: true,
        detail: "ready",
      },
      queue: {
        provider: "redis",
        ready: true,
        configured: true,
        enqueue: true,
        status: true,
        cancel: true,
        atomicTransitions: true,
        detail: "ready",
      },
      processor: {
        ready: true,
        configured: true,
        executor: { mode: "not-implemented", ready: false, detail: "out-of-band" },
        detail: "ready",
      },
    },
    daemon: {
      mode: "remote-configured",
      queueConfigured: true,
      storageConfigured: true,
      drainable: true,
      runsInThisProcess: false,
      detail: "daemon can drain",
    },
    ai: AI_READY,
    ...overrides,
  };
}

describe("canRunAiTool", () => {
  it("allows a drainable deployment that declares an AI provider", () => {
    expect(canRunAiTool(status())).toBe(true);
  });

  it("refuses when the pipeline is drainable but no AI provider is declared", () => {
    // The regression this module exists for: without the AI check the UI would
    // offer the tool, take the user's PDF, upload it, and only then fail.
    expect(canRunAiTool(status({ ai: AI_OFF }))).toBe(false);
  });

  it("refuses when AI is declared but the pipeline cannot drain", () => {
    expect(
      canRunAiTool(
        status({
          daemon: { ...status().daemon, drainable: false, queueConfigured: false },
          providers: {
            ...status().providers,
            queue: { ...status().providers.queue, ready: false },
          },
        }),
      ),
    ).toBe(false);
  });

  it("never advertises the flow for a local-dev-only worker, even with AI declared", () => {
    expect(canRunAiTool(status({ localDevOnly: true }))).toBe(false);
  });

  it("is unavailable when status is absent", () => {
    expect(canRunAiTool(null)).toBe(false);
    expect(canRunAiTool(undefined)).toBe(false);
  });
});

describe("aiToolUnavailableDetail", () => {
  it("blames AI when AI is the only missing piece", () => {
    expect(aiToolUnavailableDetail(status({ ai: AI_OFF }))).toBe(AI_OFF.detail);
  });

  it("blames the pipeline when the daemon cannot drain", () => {
    const broken = status({
      ai: AI_READY,
      daemon: { ...status().daemon, drainable: false, detail: "nothing to drain" },
    });
    expect(aiToolUnavailableDetail(broken)).toBe("nothing to drain");
  });

  it("explains local-dev without pointing at AI configuration", () => {
    const detail = aiToolUnavailableDetail(status({ localDevOnly: true }));
    expect(detail).toMatch(/out-of-band secure worker/i);
    expect(detail).not.toContain(AI_OFF.detail);
  });

  it("degrades honestly with no status at all", () => {
    expect(aiToolUnavailableDetail(null)).toMatch(/not drainable/i);
  });
});

import { describe, expect, it } from "vitest";
import type { WorkerStatus } from "@/lib/workers/status";
import { canRunDeepCompression } from "./compress-runner";

function status(overrides: Partial<WorkerStatus> = {}): WorkerStatus {
  return {
    mode: "disabled",
    enabled: false,
    localDevOnly: false,
    detail: "test",
    compress: { lossless: false, deep: false, engines: [] },
    ocr: { available: false, engine: null, languages: [], detail: "test" },
    scan: { active: false, detail: "not scanned" },
    security: {
      available: false,
      operations: ["protect", "unlock"],
      detail: "test",
    },
    providers: {
      storage: {
        provider: "disabled",
        ready: false,
        configured: false,
        signedUploads: false,
        signedDownloads: false,
        deleteNow: false,
        detail: "storage",
      },
      queue: {
        provider: "disabled",
        ready: false,
        configured: false,
        enqueue: false,
        status: false,
        cancel: false,
        atomicTransitions: false,
        detail: "queue",
      },
      processor: {
        ready: false,
        configured: false,
        detail: "processor",
        executor: { mode: "none", ready: false, detail: "executor" },
      },
    },
    daemon: {
      mode: "disabled",
      queueConfigured: false,
      storageConfigured: false,
      drainable: false,
      runsInThisProcess: false,
      detail: "daemon",
    },
    ai: {
      declared: false,
      provider: null,
      model: null,
      configuredHere: false,
      ready: false,
      detail: "no ai declared",
    },
    pipeline: {
      verdict: "off",
      observed: false,
      drainable: false,
      detail: "no server observed",
    },
    ...overrides,
  };
}

describe("canRunDeepCompression", () => {
  it("allows local-dev only when a native deep engine was probed", () => {
    expect(
      canRunDeepCompression(
        status({
          localDevOnly: true,
          compress: { lossless: true, deep: false, engines: [] },
        }),
      ),
    ).toBe(false);

    expect(
      canRunDeepCompression(
        status({
          localDevOnly: true,
          compress: { lossless: true, deep: true, engines: ["ghostscript"] },
        }),
      ),
    ).toBe(true);
  });

  it("allows staging/production when queue + storage are ready and the daemon is drainable", () => {
    expect(
      canRunDeepCompression(
        status({
          providers: {
            storage: {
              provider: "s3",
              ready: true,
              configured: true,
              signedUploads: true,
              signedDownloads: true,
              deleteNow: true,
              detail: "storage ready",
            },
            queue: {
              provider: "redis",
              ready: true,
              configured: true,
              enqueue: true,
              status: true,
              cancel: true,
              atomicTransitions: true,
              detail: "queue ready",
            },
            processor: {
              ready: false,
              configured: false,
              detail: "web does not process jobs",
              executor: {
                mode: "not-implemented",
                ready: false,
                detail: "web",
              },
            },
          },
          daemon: {
            mode: "disabled",
            queueConfigured: true,
            storageConfigured: true,
            drainable: true,
            runsInThisProcess: false,
            detail: "daemon can drain out of band",
          },
        }),
      ),
    ).toBe(true);
  });

  it("keeps deep disabled when any production provider prerequisite is missing", () => {
    expect(canRunDeepCompression(status())).toBe(false);
    expect(
      canRunDeepCompression(
        status({
          providers: {
            ...status().providers,
            storage: {
              provider: "s3",
              ready: true,
              configured: true,
              signedUploads: true,
              signedDownloads: true,
              deleteNow: true,
              detail: "storage ready",
            },
          },
          daemon: { ...status().daemon, drainable: true },
        }),
      ),
    ).toBe(false);
  });
});

/*
 * `stageHoldPx` was tested here until 2026-10-11: how tall a picked file's
 * stage was held — to the bottom of the screen, never past the cap
 * (`STAGE_HOLD_REM`), in whole pixels. The hold is gone (its history is in
 * `./compress-runner.tsx`, above `CompressSingle`): it moved the content
 * under the runner at the pick, where a file dropped or handed over opens
 * no input window. The test that inverts these — the stage is never held
 * by script, in any state — renders the runner, in
 * `./compress-runner.dom.test.tsx` ("the stage a picked file is analysed
 * on"); the page that holds the first screen instead is measured by
 * `e2e/continue-chain.spec.ts`.
 */

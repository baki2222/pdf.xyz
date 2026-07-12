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
    ...overrides,
  };
}

describe("canRunDeepCompression", () => {
  it("allows local-dev only when a native deep engine was probed", () => {
    expect(
      canRunDeepCompression(
        status({ localDevOnly: true, compress: { lossless: true, deep: false, engines: [] } }),
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
              executor: { mode: "not-implemented", ready: false, detail: "web" },
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

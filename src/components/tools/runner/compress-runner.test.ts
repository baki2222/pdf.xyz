import { describe, expect, it } from "vitest";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  STAGE_HOLD_REM,
  canRunDeepCompression,
  stageHoldPx,
} from "./compress-runner";

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
      detail: "no worker observed",
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

/**
 * How tall a picked file's stage is held (`stageHoldPx`): to the bottom of
 * the screen, never past it and never past the cap. The browser half — one
 * shift after a pick, and the shortest analysis filling the stage — is
 * `e2e/continue-chain.spec.ts`.
 */
describe("stageHoldPx", () => {
  const rem = 16;
  const cap = STAGE_HOLD_REM * rem;

  it("holds what is left of the screen below the stage when that is less than the cap", () => {
    // 1280 x 720: the stage starts 401 px down, 319 px are left.
    expect(stageHoldPx({ top: 401, viewport: 720, rem })).toBe(319);
    expect(stageHoldPx({ top: 401, viewport: 720, rem })).toBeLessThan(cap);
  });

  it("holds no more than the cap on a screen with room to spare", () => {
    expect(stageHoldPx({ top: 401, viewport: 900, rem })).toBe(cap);
    expect(stageHoldPx({ top: 401, viewport: 1440, rem })).toBe(cap);
  });

  it("the cap is in rem: a larger root font holds proportionally more", () => {
    // In whole pixels, as every hold is (the last case below). Until the
    // merge of main (2026-10-11) the cap was 28 rem, whole at any root
    // size, and this read `STAGE_HOLD_REM * 20` bare; at 27.4375 rem (the
    // one pixel both continue-chain bounds allow) that is 548.75, and a
    // hold of 548.75 px would be the sub-pixel min-height that case bans.
    expect(stageHoldPx({ top: 0, viewport: 4000, rem: 20 })).toBe(
      Math.round(STAGE_HOLD_REM * 20),
    );
    expect(stageHoldPx({ top: 0, viewport: 4000, rem: 20 })).toBeGreaterThan(
      stageHoldPx({ top: 0, viewport: 4000, rem: 16 }),
    );
  });

  it("a stage below the screen, or at its edge, is not held", () => {
    expect(stageHoldPx({ top: 900, viewport: 900, rem })).toBe(0);
    expect(stageHoldPx({ top: 1200, viewport: 900, rem })).toBe(0);
  });

  it("a stage scrolled partly above the screen is held to the cap, not to the screen plus the part above it", () => {
    expect(stageHoldPx({ top: -300, viewport: 900, rem })).toBe(cap);
  });

  it("whole pixels: a fractional top does not leave a sub-pixel min-height", () => {
    expect(stageHoldPx({ top: 401.4, viewport: 720, rem })).toBe(319);
  });
});

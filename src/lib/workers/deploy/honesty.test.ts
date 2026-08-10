// @vitest-environment node
/**
 * Cross-cutting honesty guard for Phase 19: the worker layer must never claim a
 * capability it does not have. This ties three separate honesty invariants into
 * one place so a regression in any of them fails loudly:
 *  - the client status never claims a worker is deployed/running, and never claims
 *    OCR, malware scanning, or a lifecycle policy that isn't there;
 *  - the operator deployment readiness always reports malware scanning inactive and
 *    OCR not-implemented, and reports the lifecycle backstop `validated` ONLY when
 *    the operator has actually asserted it.
 */
import { describe, expect, it } from "vitest";
import { buildWorkerStatus } from "../status";
import type { WorkerMode } from "../mode";
import { resolveDaemonReadiness } from "../daemon/readiness";
import { LIFECYCLE_ENV } from "../lifecycle";
import { resolveDeploymentReadiness } from "./readiness";
import { MALWARE_SCANNER_ENV } from "./scanner";

const MODES: WorkerMode[] = ["disabled", "remote-configured", "local-dev"];

// A drainable, engine-equipped environment — the strongest a deployment gets.
const DRAINABLE_ENV = {
  PDFXYZ_STORAGE_PROVIDER: "s3",
  PDFXYZ_S3_ENDPOINT: "https://s3.example.com",
  PDFXYZ_S3_REGION: "auto",
  PDFXYZ_S3_BUCKET: "pdfxyz-store",
  PDFXYZ_S3_ACCESS_KEY_ID: "AKIAEXAMPLE123",
  PDFXYZ_S3_SECRET_ACCESS_KEY: "s3-secret-value-1234567890",
  PDFXYZ_QUEUE_PROVIDER: "redis",
  PDFXYZ_REDIS_REST_URL: "https://redis.example.com",
  PDFXYZ_REDIS_REST_TOKEN: "redis-rest-token-1234",
} as const;

const DEEP = { lossless: true as const, deep: true, engines: ["ghostscript"] };

describe("client status — never over-claims", () => {
  it("never reports OCR as available in any mode", () => {
    for (const mode of MODES) {
      expect(buildWorkerStatus(mode).ocr.available).toBe(false);
    }
  });

  it("never claims the app process itself runs a worker daemon", () => {
    for (const mode of MODES) {
      const status = buildWorkerStatus(mode, undefined, undefined, {
        ...DRAINABLE_ENV,
      });
      // Even fully drainable, the app can only ever be "drainable", never running.
      expect(status.daemon.runsInThisProcess).toBe(false);
    }
  });

  it("presence-only: never leaks a variable name", () => {
    const serialized = JSON.stringify(
      buildWorkerStatus(
        "remote-configured",
        undefined,
        undefined,
        DRAINABLE_ENV,
      ),
    );
    expect(serialized).not.toMatch(/PDFXYZ_/);
  });

  it("never claims malware scanning it is not doing", () => {
    // This assertion used to be `not.toContain("malware")` — honesty by silence. The
    // silence was the problem: because the status said nothing either way, the UI's
    // pipeline copy filled the vacuum with "Every file is scanned before any processor
    // touches it", shown on every worker-backed tool page while no scanner existed.
    // The invariant was never "do not say the word"; it was "do not claim the control".
    // Saying so explicitly is what lets the UI render the truth.
    const status = buildWorkerStatus(
      "remote-configured",
      undefined,
      undefined,
      DRAINABLE_ENV,
    );
    const serialized = JSON.stringify(status).toLowerCase();
    expect(status.scan.active).toBe(false);
    expect(serialized).not.toMatch(/every file is scanned/);
    expect(serialized).not.toMatch(/files are scanned/);
    // ...and it must positively disclose the absence, not merely omit the claim.
    expect(status.scan.detail.toLowerCase()).toContain(
      "not scanned for malware",
    );
  });
});

describe("operator deployment readiness — honest scanner + OCR", () => {
  it("reports malware scanning active ONLY when configured, and OCR never", () => {
    // Not-configured and misconfigured are inactive; a usable clamd endpoint is
    // active (Phase 22 ships an optional real scanner). OCR is never implemented.
    const inactiveEnvs = [
      {},
      { ...DRAINABLE_ENV },
      { [MALWARE_SCANNER_ENV]: "clamav://" },
    ];
    for (const env of inactiveEnvs) {
      const readiness = resolveDeploymentReadiness(
        resolveDaemonReadiness(env),
        env,
        {
          engine: DEEP,
        },
      );
      expect(readiness.malwareScan.active).toBe(false);
      expect(readiness.facets.find((f) => f.id === "ocr")!.state).toBe(
        "not-implemented",
      );
    }
    const configured = {
      [MALWARE_SCANNER_ENV]: "clamav://clamd.internal:3310",
    };
    const ready = resolveDeploymentReadiness(
      resolveDaemonReadiness(configured),
      configured,
      { engine: DEEP },
    );
    expect(ready.malwareScan.active).toBe(true);
    expect(ready.facets.find((f) => f.id === "ocr")!.state).toBe(
      "not-implemented",
    );
    // Still content-free even when a scanner is configured.
    expect(JSON.stringify(ready)).not.toContain("clamd.internal");
    expect(JSON.stringify(ready)).not.toContain("PDFXYZ_");
  });

  it("reports the lifecycle backstop validated ONLY when the operator asserts it", () => {
    const declared = { ...DRAINABLE_ENV, [LIFECYCLE_ENV.provider]: "aws-s3" };
    const validated = { ...declared, [LIFECYCLE_ENV.validated]: "true" };
    const facetState = (env: Record<string, string>) =>
      resolveDeploymentReadiness(resolveDaemonReadiness(env), env, {
        engine: DEEP,
      }).facets.find((f) => f.id === "lifecycle")!.state;
    expect(facetState(DRAINABLE_ENV as unknown as Record<string, string>)).toBe(
      "unknown",
    );
    expect(facetState(declared)).toBe("degraded"); // declared but not verified
    expect(facetState(validated)).toBe("ready");
  });
});

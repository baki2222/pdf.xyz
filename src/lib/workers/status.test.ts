import { describe, expect, it } from "vitest";
import type { ToolAvailability } from "./compression/engine";
import { S3_ENV } from "./storage/s3-config";
import { AI_ENV } from "./ai/config";
import { buildPipelineSummary, buildWorkerStatus } from "./status";

const noTools: ToolAvailability = {
  ghostscript: false,
  qpdf: false,
  mutool: false,
};

/** A fully-valid S3 storage environment (fake credentials). */
const s3Env: Record<string, string> = {
  [S3_ENV.provider]: "s3",
  [S3_ENV.endpoint]: "https://s3.us-east-1.amazonaws.com",
  [S3_ENV.region]: "us-east-1",
  [S3_ENV.bucket]: "pdfxyz-prod",
  [S3_ENV.accessKeyId]: "AKIAEXAMPLE0000000",
  [S3_ENV.secretAccessKey]: "s3cr3tEXAMPLEkeyValue00000000000000000000",
};

// The existing suite relies on the ambient env having no S3 config; pass an
// explicit empty env so those cases are hermetic regardless of process.env.
const noEnv: Record<string, string | undefined> = {};

describe("buildWorkerStatus", () => {
  it("reports disabled with no capability by default", () => {
    const status = buildWorkerStatus("disabled");
    expect(status.mode).toBe("disabled");
    expect(status.enabled).toBe(false);
    expect(status.localDevOnly).toBe(false);
    expect(status.compress).toEqual({
      lossless: false,
      deep: false,
      engines: [],
    });
    // The detail names its own vantage (this web process), never the
    // deployment's: its predecessor read "No secure worker is configured in
    // this environment" and became the /status headline over a live worker.
    expect(status.detail).toMatch(
      /this web process runs no in-process worker/i,
    );
    // With nothing observed and nothing drainable, the pipeline verdict is off.
    expect(status.pipeline).toMatchObject({
      verdict: "off",
      observed: false,
      drainable: false,
    });
  });

  it("reports OCR as unavailable with an honest reason in every mode", () => {
    for (const mode of [
      "disabled",
      "remote-configured",
      "local-dev",
    ] as const) {
      const status = buildWorkerStatus(mode);
      expect(status.ocr.available).toBe(false);
      expect(status.ocr.engine).toBeNull();
      expect(status.ocr.languages).toEqual([]);
      expect(status.ocr.detail.length).toBeGreaterThan(0);
    }
  });

  it("reports remote-configured as not-enabled (no pipeline shipped)", () => {
    const status = buildWorkerStatus("remote-configured");
    expect(status.enabled).toBe(false);
    expect(status.localDevOnly).toBe(false);
    expect(status.compress.deep).toBe(false);
    expect(status.detail).toMatch(/no in-process pipeline/i);
  });

  it("summarizes the pipeline from the two observed facts alone", () => {
    // Observed beats everything: a heartbeat is the one fact that proves a
    // worker exists, so it alone decides `live`.
    expect(buildPipelineSummary(true, false).verdict).toBe("live");
    expect(buildPipelineSummary(true, true).verdict).toBe("live");
    // Drainable without a heartbeat is `configured` — could run, none seen.
    expect(buildPipelineSummary(false, true).verdict).toBe("configured");
    expect(buildPipelineSummary(false, false).verdict).toBe("off");
    // The off detail states the precise gap, never a deployment-wide negative
    // ("no secure worker is configured") — that wording is what misled an
    // operator while the worker ran jobs.
    expect(buildPipelineSummary(false, false).detail).not.toMatch(
      /no secure worker is configured/i,
    );
  });

  it("reports local-dev as enabled with lossless, but deep off with no engine", () => {
    const status = buildWorkerStatus("local-dev", noTools);
    expect(status.enabled).toBe(true);
    expect(status.localDevOnly).toBe(true);
    expect(status.compress.lossless).toBe(true);
    expect(status.compress.deep).toBe(false);
    expect(status.compress.engines).toEqual([]);
    expect(status.detail).toMatch(/no native engine/i);
    // OCR is not part of the local-dev worker, so it stays unavailable.
    expect(status.ocr.available).toBe(false);
  });

  it("reports deep on with the installed engines in preference order", () => {
    const status = buildWorkerStatus("local-dev", {
      ghostscript: false,
      qpdf: true,
      mutool: true,
    });
    expect(status.compress.deep).toBe(true);
    expect(status.compress.engines).toEqual(["qpdf", "mutool"]);
    expect(status.detail).toContain("qpdf");
  });

  it("reports the protect/unlock (qpdf) security facet honestly", () => {
    // Explicit qpdf-security probe wins.
    const withProbe = buildWorkerStatus(
      "local-dev",
      undefined,
      undefined,
      {},
      true,
    );
    expect(withProbe.security.available).toBe(true);
    expect(withProbe.security.operations).toEqual([
      "protect",
      "unlock",
      "repair",
      "optimize-web",
    ]);
    expect(withProbe.security.detail).toMatch(/repair/i);

    // Absent an explicit probe, it falls back to the compression qpdf presence.
    const fromTools = buildWorkerStatus("local-dev", {
      ghostscript: false,
      qpdf: true,
      mutool: false,
    });
    expect(fromTools.security.available).toBe(true);

    // No qpdf anywhere ⇒ unavailable.
    expect(buildWorkerStatus("local-dev", noTools).security.available).toBe(
      false,
    );
    const disabledSecurity = buildWorkerStatus("disabled").security;
    // The shared qpdf facet backs security + structure tools; unavailable copy
    // must not claim the whole facet is only password protection.
    expect(disabledSecurity.available).toBe(false);
    expect(disabledSecurity.detail).toMatch(/qpdf-backed PDF tools/i);
    expect(disabledSecurity.detail).not.toMatch(/password protection needs/i);
    // The web process never claims availability for a remote worker's engine.
    expect(buildWorkerStatus("remote-configured").security.available).toBe(
      false,
    );
  });

  it("treats missing tool data in local-dev as no deep engine", () => {
    const status = buildWorkerStatus("local-dev");
    expect(status.compress.lossless).toBe(true);
    expect(status.compress.deep).toBe(false);
  });
});

describe("buildWorkerStatus — provider readiness", () => {
  it("reports every provider not-ready and not-configured when disabled", () => {
    const { providers } = buildWorkerStatus("disabled");
    for (const p of [providers.storage, providers.queue, providers.processor]) {
      expect(p.ready).toBe(false);
      expect(p.configured).toBe(false);
      expect(p.detail.length).toBeGreaterThan(0);
    }
  });

  it("reports providers configured-but-not-ready in remote-configured", () => {
    const { providers } = buildWorkerStatus("remote-configured");
    expect(providers.storage.ready).toBe(false);
    expect(providers.storage.configured).toBe(true);
    expect(providers.queue.configured).toBe(true);
    expect(providers.processor.configured).toBe(true);
  });

  it("reports storage/queue/processor ready in local-dev", () => {
    const { providers } = buildWorkerStatus("local-dev", noTools);
    expect(providers.storage.ready).toBe(true);
    expect(providers.queue.ready).toBe(true);
    expect(providers.processor.ready).toBe(true);
    expect(providers.storage.signedUploads).toBe(true);
    expect(providers.queue.cancel).toBe(true);
  });

  it("reports executor readiness per mode (presence-only)", () => {
    expect(
      buildWorkerStatus("local-dev", noTools).providers.processor.executor,
    ).toMatchObject({ mode: "in-process", ready: true });
    expect(
      buildWorkerStatus("remote-configured").providers.processor.executor,
    ).toMatchObject({ mode: "not-implemented", ready: false });
    expect(
      buildWorkerStatus("disabled").providers.processor.executor,
    ).toMatchObject({ mode: "none", ready: false });
    for (const mode of [
      "disabled",
      "remote-configured",
      "local-dev",
    ] as const) {
      const { executor } = buildWorkerStatus(mode).providers.processor;
      expect(executor.detail.length).toBeGreaterThan(0);
      expect(executor.detail).not.toMatch(/PDFXYZ_/);
    }
  });

  it("never leaks a variable name in any provider detail", () => {
    for (const mode of [
      "disabled",
      "remote-configured",
      "local-dev",
    ] as const) {
      const { providers } = buildWorkerStatus(mode);
      const details = [
        providers.storage.detail,
        providers.queue.detail,
        providers.processor.detail,
      ].join(" ");
      expect(details).not.toMatch(/PDFXYZ_/);
    }
  });
});

describe("buildWorkerStatus — S3 storage readiness (independent of queue/processor)", () => {
  it("reports storage ready while queue/processor stay not-ready when only S3 is wired", () => {
    for (const mode of ["disabled", "remote-configured"] as const) {
      const { providers } = buildWorkerStatus(
        mode,
        undefined,
        undefined,
        s3Env,
      );
      expect(providers.storage).toMatchObject({
        provider: "s3",
        ready: true,
        configured: true,
      });
      expect(providers.queue.ready).toBe(false);
      expect(providers.processor.ready).toBe(false);
    }
  });

  it("keeps the S3 storage detail free of any variable name or value", () => {
    const { providers } = buildWorkerStatus(
      "disabled",
      undefined,
      undefined,
      s3Env,
    );
    const detail = providers.storage.detail;
    for (const leak of [
      "pdfxyz-prod",
      "amazonaws",
      "us-east-1",
      "AKIA",
      "PDFXYZ_",
    ]) {
      expect(detail).not.toContain(leak);
    }
  });

  it("ignores S3 config in local-dev mode (the in-process store serves)", () => {
    const { providers } = buildWorkerStatus(
      "local-dev",
      noTools,
      undefined,
      s3Env,
    );
    expect(providers.storage.provider).toBe("local-dev");
  });

  it("falls back to honest not-configured storage with an explicit empty env", () => {
    const { providers } = buildWorkerStatus(
      "disabled",
      undefined,
      undefined,
      noEnv,
    );
    expect(providers.storage.ready).toBe(false);
    expect(providers.storage.provider).toBe("disabled");
  });
});

describe("buildWorkerStatus — processor readiness follows observed liveness", () => {
  const queueEnv: Record<string, string> = {
    PDFXYZ_QUEUE_PROVIDER: "redis",
    PDFXYZ_REDIS_REST_URL: "https://redis.example.com",
    PDFXYZ_REDIS_REST_TOKEN: "redis-rest-token-1234",
  };

  it("stays not-ready when a queue is configured but no worker is seen", () => {
    const { providers } = buildWorkerStatus(
      "disabled",
      undefined,
      undefined,
      queueEnv,
      undefined,
      false,
    );
    expect(providers.queue.ready).toBe(true);
    expect(providers.processor.ready).toBe(false);
    expect(providers.processor.executor).toMatchObject({
      mode: "not-implemented",
      ready: false,
    });
  });

  it("becomes ready once a worker is observed beating against that queue", () => {
    const { providers } = buildWorkerStatus(
      "disabled",
      undefined,
      undefined,
      queueEnv,
      undefined,
      true,
    );
    expect(providers.processor.ready).toBe(true);
    expect(providers.processor.executor).toMatchObject({
      mode: "worker",
      ready: true,
    });
  });

  it("never claims a processor on an observed worker with no queue to claim from", () => {
    // Liveness alone is not enough: without a broker there is nothing to drain,
    // so this must not flip ready on the strength of a heartbeat.
    const { providers } = buildWorkerStatus(
      "disabled",
      undefined,
      undefined,
      noEnv,
      undefined,
      true,
    );
    expect(providers.queue.ready).toBe(false);
    expect(providers.processor.ready).toBe(false);
  });

  it("keeps the cautious answer when the caller cannot observe at all", () => {
    const { providers } = buildWorkerStatus(
      "disabled",
      undefined,
      undefined,
      queueEnv,
    );
    expect(providers.processor.ready).toBe(false);
  });

  it("never names a variable in either processor detail", () => {
    for (const observed of [true, false]) {
      const { providers } = buildWorkerStatus(
        "disabled",
        undefined,
        undefined,
        queueEnv,
        undefined,
        observed,
      );
      expect(providers.processor.detail).not.toMatch(/PDFXYZ_/);
      expect(providers.processor.executor.detail).not.toMatch(/PDFXYZ_/);
      expect(providers.processor.detail.length).toBeGreaterThan(0);
    }
  });
});

describe("buildWorkerStatus — worker daemon readiness (Phase 16)", () => {
  const redisEnv: Record<string, string> = {
    PDFXYZ_QUEUE_PROVIDER: "redis",
    PDFXYZ_REDIS_REST_URL: "https://redis.example.com",
    PDFXYZ_REDIS_REST_TOKEN: "redis-rest-token-1234",
  };

  it("reports the daemon not drainable and never in-process by default", () => {
    const { daemon } = buildWorkerStatus(
      "disabled",
      undefined,
      undefined,
      noEnv,
    );
    expect(daemon.drainable).toBe(false);
    expect(daemon.runsInThisProcess).toBe(false);
  });

  it("reports the daemon drainable only when queue AND storage are configured", () => {
    const { daemon } = buildWorkerStatus("disabled", undefined, undefined, {
      ...s3Env,
      ...redisEnv,
    });
    expect(daemon).toMatchObject({ drainable: true, runsInThisProcess: false });
    // Storage alone is not enough to drain.
    expect(
      buildWorkerStatus("disabled", undefined, undefined, s3Env).daemon
        .drainable,
    ).toBe(false);
  });
});

describe("buildWorkerStatus — AI provider readiness", () => {
  it("reports AI not ready in every mode when nothing is declared", () => {
    for (const mode of [
      "disabled",
      "remote-configured",
      "local-dev",
    ] as const) {
      const { ai } = buildWorkerStatus(mode, undefined, undefined, noEnv);
      expect(ai.ready).toBe(false);
      expect(ai.declared).toBe(false);
      expect(ai.provider).toBeNull();
      expect(ai.detail.length).toBeGreaterThan(0);
    }
  });

  it("reports AI ready from the declaration alone, independently of the mode", () => {
    // AI always runs on the out-of-band worker, so — exactly like `daemon` — its
    // readiness is mode-independent and derived from the non-secret family switch.
    for (const mode of [
      "disabled",
      "remote-configured",
      "local-dev",
    ] as const) {
      const { ai } = buildWorkerStatus(mode, undefined, undefined, {
        [AI_ENV.provider]: "anthropic",
      });
      expect(ai).toMatchObject({
        ready: true,
        declared: true,
        provider: "anthropic",
        model: "claude-sonnet-5",
        configuredHere: false,
      });
    }
  });

  it("keeps AI readiness independent of the pipeline providers", () => {
    // A fully drainable deployment with no model wired must still report AI off,
    // so the AI tools are refused up front instead of after an upload.
    const { ai, daemon } = buildWorkerStatus("disabled", undefined, undefined, {
      ...s3Env,
      PDFXYZ_QUEUE_PROVIDER: "redis",
      PDFXYZ_REDIS_REST_URL: "https://redis.example.com",
      PDFXYZ_REDIS_REST_TOKEN: "redis-rest-token-1234",
    });
    expect(daemon.drainable).toBe(true);
    expect(ai.ready).toBe(false);
  });

  it("never serializes an API key into the client-facing status", () => {
    const key = "sk-ant-EXAMPLE-not-a-real-key-0000000000";
    const status = buildWorkerStatus("disabled", undefined, undefined, {
      [AI_ENV.provider]: "anthropic",
      [AI_ENV.apiKey]: key,
    });
    expect(status.ai.configuredHere).toBe(true);
    expect(JSON.stringify(status)).not.toContain(key);
  });
});

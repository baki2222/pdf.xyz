import { describe, expect, it } from "vitest";
import {
  getProcessorEnvStatus,
  getProviderEnvStatus,
  getQueueEnvStatus,
  getStorageEnvStatus,
  getWorkerBackendStatus,
  isWorkerBackendConfigured,
  PROCESSOR_ENV,
  PROVIDER_ENV,
  QUEUE_ENV,
  REQUIRED_WORKER_ENV,
  STORAGE_ENV,
} from "./config";

const allSet = (): Record<string, string> =>
  Object.fromEntries(REQUIRED_WORKER_ENV.map((name) => [name, "configured"]));

describe("getWorkerBackendStatus", () => {
  it("reports not-configured when required vars are absent", () => {
    const status = getWorkerBackendStatus({});
    expect(status.configured).toBe(false);
    expect(status.missing).toEqual([...REQUIRED_WORKER_ENV]);
  });

  it("reports configured only when every required var is present", () => {
    expect(getWorkerBackendStatus(allSet()).configured).toBe(true);
    expect(isWorkerBackendConfigured(allSet())).toBe(true);
  });

  it("treats blank or whitespace values as missing", () => {
    const blank = Object.fromEntries(
      REQUIRED_WORKER_ENV.map((name) => [name, "   "]),
    );
    const status = getWorkerBackendStatus(blank);
    expect(status.configured).toBe(false);
    expect(status.missing).toEqual([...REQUIRED_WORKER_ENV]);
  });

  it("names the specific missing var when partially configured", () => {
    const partial = allSet();
    const [first] = REQUIRED_WORKER_ENV;
    delete partial[first];
    const status = getWorkerBackendStatus(partial);
    expect(status.configured).toBe(false);
    expect(status.missing).toEqual([first]);
  });

  it("only ever surfaces variable names, never values", () => {
    const status = getWorkerBackendStatus({ [REQUIRED_WORKER_ENV[0]]: "secret" });
    for (const name of status.missing) {
      expect(REQUIRED_WORKER_ENV).toContain(name);
    }
  });
});

describe("per-provider env decomposition", () => {
  it("REQUIRED_WORKER_ENV is exactly the union of the three provider groups", () => {
    expect([...REQUIRED_WORKER_ENV]).toEqual([
      ...PROCESSOR_ENV,
      ...STORAGE_ENV,
      ...QUEUE_ENV,
    ]);
    // The stable order the diagnostics list depends on: processor first.
    expect(REQUIRED_WORKER_ENV[0]).toBe("PDFXYZ_WORKER_URL");
  });

  it("maps each provider kind to its own env group", () => {
    expect(PROVIDER_ENV.storage).toEqual([...STORAGE_ENV]);
    expect(PROVIDER_ENV.queue).toEqual([...QUEUE_ENV]);
    expect(PROVIDER_ENV.processor).toEqual([...PROCESSOR_ENV]);
  });

  it("reports each provider independently from presence", () => {
    const env = { PDFXYZ_STORAGE_BUCKET: "b" };
    expect(getStorageEnvStatus(env).configured).toBe(true);
    expect(getQueueEnvStatus(env).configured).toBe(false);
    expect(getProcessorEnvStatus(env).configured).toBe(false);
    // Partial config: storage ready, whole backend still not configured.
    expect(getWorkerBackendStatus(env).configured).toBe(false);
  });

  it("getProviderEnvStatus names only the missing var for that provider", () => {
    const status = getProviderEnvStatus("queue", {});
    expect(status.configured).toBe(false);
    expect(status.missing).toEqual([...QUEUE_ENV]);
  });

  it("treats blank provider values as missing", () => {
    expect(getStorageEnvStatus({ PDFXYZ_STORAGE_BUCKET: "  " }).configured).toBe(
      false,
    );
  });
});

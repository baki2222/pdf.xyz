import { describe, expect, it } from "vitest";
import {
  getWorkerBackendStatus,
  isWorkerBackendConfigured,
  REQUIRED_WORKER_ENV,
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

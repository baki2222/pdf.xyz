import { describe, expect, it } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { isLocalDevWorker, resolveWorkerMode, WORKER_MODE_ENV } from "./mode";

const configuredEnv = (): Record<string, string> =>
  Object.fromEntries(REQUIRED_WORKER_ENV.map((name) => [name, "set"]));

describe("resolveWorkerMode", () => {
  it("defaults to disabled with an empty environment", () => {
    expect(resolveWorkerMode({})).toBe("disabled");
    expect(isLocalDevWorker({})).toBe(false);
  });

  it("is local-dev when the mode flag opts in (case/space-insensitive)", () => {
    expect(resolveWorkerMode({ [WORKER_MODE_ENV]: "local-dev" })).toBe(
      "local-dev",
    );
    expect(resolveWorkerMode({ [WORKER_MODE_ENV]: "  LOCAL-DEV " })).toBe(
      "local-dev",
    );
    expect(isLocalDevWorker({ [WORKER_MODE_ENV]: "local-dev" })).toBe(true);
  });

  it("is remote-configured when backend vars are present and no dev flag", () => {
    expect(resolveWorkerMode(configuredEnv())).toBe("remote-configured");
  });

  it("lets an explicit local-dev opt-in win over present backend vars", () => {
    expect(
      resolveWorkerMode({ ...configuredEnv(), [WORKER_MODE_ENV]: "local-dev" }),
    ).toBe("local-dev");
  });

  it("ignores an unrecognized mode value and falls through to presence", () => {
    expect(resolveWorkerMode({ [WORKER_MODE_ENV]: "production" })).toBe(
      "disabled",
    );
    expect(
      resolveWorkerMode({ ...configuredEnv(), [WORKER_MODE_ENV]: "nope" }),
    ).toBe("remote-configured");
  });
});

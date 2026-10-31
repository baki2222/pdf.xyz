// @vitest-environment node
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import {
  ATTEMPT_ABORTED_CODE,
  AttemptAbortedError,
  anySignal,
  isAttemptAbort,
  settleAttempt,
  throwIfAttemptAborted,
} from "./attempt-abort";
import { processorFail, processorOk } from "./processor/types";
import type { JobResults } from "@/lib/jobs";

/** Run a real child and return the error Node hands its callback. */
function childError(options: {
  signal?: AbortSignal;
  timeout?: number;
}): Promise<unknown> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["-e", "setTimeout(() => {}, 60000)"],
      options,
      (error) => resolve(error),
    );
  });
}

const USAGE = {
  ai: {
    usage: { inputTokens: 1200, outputTokens: 300 },
  },
} as unknown as JobResults;

describe("isAttemptAbort", () => {
  it("recognises Node's own AbortError from a killed child", async () => {
    const controller = new AbortController();
    const pending = childError({ signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    expect(isAttemptAbort(await pending)).toBe(true);
  });

  it("does NOT read a timeout kill as an abort (the control)", async () => {
    const error = await childError({ timeout: 100 });
    expect((error as { killed?: boolean }).killed).toBe(true);
    expect(isAttemptAbort(error)).toBe(false);
  });

  it("recognises ours, and nothing else", () => {
    expect(isAttemptAbort(new AttemptAbortedError())).toBe(true);
    expect(isAttemptAbort(new Error("boom"))).toBe(false);
    expect(isAttemptAbort(null)).toBe(false);
    expect(isAttemptAbort({ code: "ENOENT" })).toBe(false);
  });

  it("throwIfAttemptAborted throws only for an aborted signal", () => {
    const controller = new AbortController();
    expect(() => throwIfAttemptAborted(undefined)).not.toThrow();
    expect(() => throwIfAttemptAborted(controller.signal)).not.toThrow();
    controller.abort();
    expect(() => throwIfAttemptAborted(controller.signal)).toThrow(
      AttemptAbortedError,
    );
  });
});

describe("anySignal", () => {
  it("aborts when any member does; skips absent ones", () => {
    expect(anySignal(undefined, undefined)).toBeUndefined();
    const a = new AbortController();
    const b = new AbortController();
    expect(anySignal(a.signal, undefined)).toBe(a.signal);
    const both = anySignal(a.signal, b.signal)!;
    expect(both.aborted).toBe(false);
    b.abort();
    expect(both.aborted).toBe(true);
  });
});

describe("settleAttempt", () => {
  const ok = processorOk([
    {
      filename: "o.pdf",
      contentType: "application/pdf",
      bytes: new Uint8Array([1]),
    },
  ]);

  it("passes a result through untouched while the attempt owns the job", async () => {
    const controller = new AbortController();
    await expect(
      settleAttempt(controller.signal, async () => ok),
    ).resolves.toBe(ok);
    const fail = processorFail({ code: "x", message: "m", retryable: false });
    await expect(settleAttempt(undefined, async () => fail)).resolves.toBe(
      fail,
    );
  });

  it("an aborted attempt is attempt_aborted, whatever the engine made of its killed child", async () => {
    const controller = new AbortController();
    controller.abort();
    const misread = processorFail({
      code: "internal_error",
      message: "The engine could not process this file.",
      retryable: true,
    });
    const settled = await settleAttempt(controller.signal, async () => misread);
    expect(settled.ok).toBe(false);
    if (!settled.ok) expect(settled.error.code).toBe(ATTEMPT_ABORTED_CODE);
  });

  it("KEEPS the spent AI usage of an aborted attempt (rule 3: failure paths carry money)", async () => {
    const controller = new AbortController();
    controller.abort();
    const spent = processorFail(
      { code: "internal_error", message: "m", retryable: true },
      USAGE,
    );
    const settled = await settleAttempt(controller.signal, async () => spent);
    expect(settled.results).toEqual(USAGE);
    // Even a SUCCESS that lands after the abort keeps what it spent.
    const late = processorOk(ok.ok ? ok.artifacts : [], undefined, USAGE);
    const settledLate = await settleAttempt(
      controller.signal,
      async () => late,
    );
    expect(settledLate.ok).toBe(false);
    expect(settledLate.results).toEqual(USAGE);
  });

  it("a throw after the abort is attempt_aborted; a throw before it propagates", async () => {
    const controller = new AbortController();
    const boom = new Error("boom");
    await expect(
      settleAttempt(controller.signal, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    // An AbortError while the attempt still owns the job is not a lost lease.
    const foreign = Object.assign(new Error("aborted"), { name: "AbortError" });
    await expect(
      settleAttempt(controller.signal, async () => {
        throw foreign;
      }),
    ).rejects.toBe(foreign);
    controller.abort();
    const settled = await settleAttempt(controller.signal, async () => {
      throw new AttemptAbortedError();
    });
    expect(!settled.ok && settled.error.code).toBe(ATTEMPT_ABORTED_CODE);
  });
});

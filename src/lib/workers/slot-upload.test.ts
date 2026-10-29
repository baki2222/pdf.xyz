// @vitest-environment node
/**
 * The ONE browser upload to a presigned worker slot (`./slot-upload`).
 *
 * THE DEFECT (production, 2026-10-29, phone audit): PDF to Word and Unlock PDF
 * failed with "Uploading the file to the worker failed." after ~10 jobs from
 * one address. The PUT goes straight to object storage, which answers a
 * refusal in XML — so `readWorkerError` found no JSON error and returned only
 * its fallback. Nobody learned the status, the reader got no reason and no
 * next step, and a single transient 503 ended the run. Three clients carried
 * the same copy of the PUT, so all three behaved the same way.
 *
 * These tests drive the shared function with a fake fetch. They were written
 * before the module existed and failed on the missing import.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  uploadTimeoutMs,
  uploadToWorkerSlot,
  type SlotFetch,
  type SlotUploadInput,
} from "./slot-upload";
import {
  configureTelemetry,
  resetTelemetry,
  type RedactedEvent,
} from "@/lib/telemetry/track";

afterEach(() => resetTelemetry());

const SIGNED_1 =
  "https://storage.example/bucket/in/f1?X-Amz-Signature=deadbeef&X-Amz-Credential=AKIA";
const SIGNED_2 =
  "https://storage.example/bucket/in/f2?X-Amz-Signature=cafef00d&X-Amz-Credential=AKIA";
const FILENAME = "Bank Statement March.pdf";

type Reply =
  { status: number; retryAfter?: string } | "network" | "hang" | Error;

interface Recorded {
  url: string;
  method: string;
  body?: Uint8Array;
}

function response(status: number, body: unknown, retryAfter?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (typeof body === "string") throw new SyntaxError("not JSON");
      return body;
    },
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "retry-after" ? (retryAfter ?? null) : null,
    },
  };
}

/**
 * A routing fake: `/api/uploads` mints slot f1 and then f2; each PUT takes the
 * next scripted reply. R2's refusals are XML, which is what a non-ok PUT
 * answers here too.
 */
function harness(puts: Reply[], sessions: number[] = []) {
  const calls: Recorded[] = [];
  let sessionCount = 0;
  let putCount = 0;
  const fetchImpl: SlotFetch = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      ...(init?.body ? { body: new Uint8Array(init.body) } : {}),
    });
    if (url === "/api/uploads") {
      const status = sessions[sessionCount] ?? 200;
      sessionCount += 1;
      if (status !== 200) {
        return response(status, {
          error: { code: "rate_limited", message: "Too many uploads." },
        });
      }
      const n = sessionCount;
      return response(200, {
        sessionId: `s${n}`,
        slots: [
          {
            fileId: `f${n}`,
            filename: FILENAME,
            url: n === 1 ? SIGNED_1 : SIGNED_2,
            method: "PUT",
            headers: { "content-type": "application/pdf" },
          },
        ],
      });
    }
    const reply = puts[putCount] ?? { status: 200 };
    putCount += 1;
    if (reply === "network") throw new TypeError("Failed to fetch");
    if (reply instanceof Error) throw reply;
    if (reply === "hang") {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        );
      });
    }
    return response(
      reply.status,
      "<?xml version='1.0'?><Error><Code>X</Code></Error>",
      reply.retryAfter,
    );
  };
  const puts_ = () => calls.filter((c) => c.method === "PUT");
  const sessions_ = () => calls.filter((c) => c.url === "/api/uploads");
  return { fetchImpl, calls, puts: puts_, sessions: sessions_ };
}

function input(
  fetchImpl: SlotFetch,
  extra: Partial<SlotUploadInput> = {},
): SlotUploadInput & { slept: number[] } {
  const slept: number[] = [];
  return {
    tool: "pdf-to-word",
    filename: FILENAME,
    contentType: "application/pdf",
    bytes: new Uint8Array([37, 80, 68, 70, 45, 49]),
    fetchImpl,
    sleep: async (ms) => {
      slept.push(ms);
    },
    slept,
    ...extra,
  };
}

function expectNoSecrets(message: string) {
  expect(message).not.toContain("storage.example");
  expect(message).not.toContain("Signature");
  expect(message).not.toContain("http");
  expect(message).not.toContain("Bank Statement");
}

describe("uploadToWorkerSlot — transient outcomes are retried once", () => {
  it("retries a 503 to the same slot with the same bytes, then succeeds", async () => {
    const h = harness([{ status: 503 }, { status: 200 }]);
    const run = input(h.fetchImpl);
    const result = await uploadToWorkerSlot(run);
    expect(result).toMatchObject({ ok: true, slot: { fileId: "f1" } });
    const puts = h.puts();
    expect(puts.map((p) => p.url)).toEqual([SIGNED_1, SIGNED_1]);
    expect([...puts[0]!.body!]).toEqual([...run.bytes]);
    expect([...puts[1]!.body!]).toEqual([...run.bytes]);
    expect(h.sessions()).toHaveLength(1);
    expect(run.slept).toHaveLength(1);
  });

  it.each([408, 500, 502, 504])("retries a %i", async (status) => {
    const h = harness([{ status }, { status: 200 }]);
    const result = await uploadToWorkerSlot(input(h.fetchImpl));
    expect(result.ok).toBe(true);
    expect(h.puts()).toHaveLength(2);
  });

  it("retries ONCE: a second 503 fails with the status, a reason and a next step", async () => {
    const h = harness([{ status: 503 }, { status: 503 }, { status: 200 }]);
    const result = await uploadToWorkerSlot(input(h.fetchImpl));
    expect(h.puts()).toHaveLength(2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe(
      "We couldn't upload your file to our secure server (the storage service answered 503). Nothing was processed — please try again in a minute.",
    );
    expect(result.code).toBe("service_unavailable");
    expectNoSecrets(result.message);
  });

  it("a network error is retried, and a second one says the upload was interrupted", async () => {
    const h = harness(["network", "network"]);
    const result = await uploadToWorkerSlot(input(h.fetchImpl));
    expect(h.puts()).toHaveLength(2);
    expect(result).toEqual({
      ok: false,
      code: "network",
      message:
        "The upload was interrupted — check your connection and try again. Nothing was processed.",
    });
  });

  it("a network error then success is a success", async () => {
    const h = harness(["network", { status: 200 }]);
    expect((await uploadToWorkerSlot(input(h.fetchImpl))).ok).toBe(true);
  });
});

describe("uploadToWorkerSlot — refusals are not retried blindly", () => {
  it("does not retry a 400", async () => {
    const h = harness([{ status: 400 }, { status: 200 }]);
    const result = await uploadToWorkerSlot(input(h.fetchImpl));
    expect(h.puts()).toHaveLength(1);
    expect(h.sessions()).toHaveLength(1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("answered 400");
    expect(result.message).toContain("Nothing was processed");
    expectNoSecrets(result.message);
  });

  it("a 403 (expired-looking slot) reserves a FRESH slot once and uploads there", async () => {
    const h = harness([{ status: 403 }, { status: 200 }]);
    const result = await uploadToWorkerSlot(input(h.fetchImpl));
    // The job must be created from the slot that holds the bytes.
    expect(result).toMatchObject({ ok: true, slot: { fileId: "f2" } });
    expect(h.sessions()).toHaveLength(2);
    expect(h.puts().map((p) => p.url)).toEqual([SIGNED_1, SIGNED_2]);
  });

  it("a second 403 on the fresh slot is final", async () => {
    const h = harness([{ status: 403 }, { status: 403 }, { status: 200 }]);
    const result = await uploadToWorkerSlot(input(h.fetchImpl));
    expect(h.sessions()).toHaveLength(2);
    expect(h.puts()).toHaveLength(2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("answered 403");
    expectNoSecrets(result.message);
  });

  it("a refused renewal returns the server's own reason", async () => {
    const h = harness([{ status: 403 }], [200, 429]);
    const result = await uploadToWorkerSlot(input(h.fetchImpl));
    expect(result).toMatchObject({
      ok: false,
      code: "rate_limited",
      message: "Too many uploads.",
    });
  });
});

describe("uploadToWorkerSlot — Retry-After", () => {
  it("waits as long as a 429's Retry-After says, when it is short", async () => {
    const h = harness([{ status: 429, retryAfter: "3" }, { status: 200 }]);
    const run = input(h.fetchImpl);
    expect((await uploadToWorkerSlot(run)).ok).toBe(true);
    expect(run.slept).toEqual([3000]);
  });

  it("does not sit through a long Retry-After: it fails at once and says how long", async () => {
    const h = harness([{ status: 429, retryAfter: "120" }, { status: 200 }]);
    const run = input(h.fetchImpl);
    const result = await uploadToWorkerSlot(run);
    expect(h.puts()).toHaveLength(1);
    expect(run.slept).toEqual([]);
    expect(result).toMatchObject({
      ok: false,
      code: "rate_limited",
      retryAfterSeconds: 120,
    });
    if (result.ok) return;
    expect(result.message).toBe(
      "We couldn't upload your file to our secure server (the storage service answered 429). Nothing was processed — please try again in about 2 minutes.",
    );
  });

  it("a 429 with no Retry-After still backs off before its one retry", async () => {
    const h = harness([{ status: 429 }, { status: 200 }]);
    const run = input(h.fetchImpl);
    expect((await uploadToWorkerSlot(run)).ok).toBe(true);
    expect(run.slept).toHaveLength(1);
    expect(run.slept[0]).toBeGreaterThan(0);
    expect(run.slept[0]).toBeLessThanOrEqual(5000);
  });
});

describe("uploadToWorkerSlot — timeout", () => {
  it("aborts a stalled PUT, retries once, then says it took too long", async () => {
    const h = harness(["hang", "hang"]);
    const result = await uploadToWorkerSlot(
      input(h.fetchImpl, { timeoutMs: 15 }),
    );
    expect(h.puts()).toHaveLength(2);
    expect(result).toEqual({
      ok: false,
      code: "timeout",
      message:
        "The upload took too long and was stopped — check your connection and try again. Nothing was processed.",
    });
  });

  it("a stalled PUT then a quick one is a success", async () => {
    const h = harness(["hang", { status: 200 }]);
    const result = await uploadToWorkerSlot(
      input(h.fetchImpl, { timeoutMs: 15 }),
    );
    expect(result.ok).toBe(true);
  });

  it("the allowance is 60 s plus time for the bytes on a slow uplink", () => {
    expect(uploadTimeoutMs(0)).toBe(60_000);
    expect(uploadTimeoutMs(10 * 1024 * 1024)).toBe(140_000);
    expect(uploadTimeoutMs(100 * 1024 * 1024)).toBe(860_000);
  });

  it("the caller's own abort is NOT a timeout and is never retried", async () => {
    const h = harness(["hang", { status: 200 }]);
    const controller = new AbortController();
    const pending = uploadToWorkerSlot(
      input(h.fetchImpl, { signal: controller.signal, timeoutMs: 10_000 }),
    );
    await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(h.puts()).toHaveLength(1);
  });
});

describe("uploadToWorkerSlot — telemetry (the composed chain, at the sink)", () => {
  function capture(): RedactedEvent[] {
    const events: RedactedEvent[] = [];
    configureTelemetry((e) => events.push(e));
    return events;
  }

  it("a retried 503 sends one event per failed attempt with only the allowlisted fields", async () => {
    const events = capture();
    const h = harness([{ status: 503 }, { status: 200 }]);
    await uploadToWorkerSlot(input(h.fetchImpl));
    const sent = events.filter((e) => e.name === "upload_attempt_failed");
    expect(sent).toEqual([
      {
        name: "upload_attempt_failed",
        toolSlug: "pdf-to-word",
        status: 503,
        attempt: 1,
        retrying: true,
        size: "<100KB",
        duration: expect.any(String),
      },
    ]);
  });

  it("a final network failure is sent as status 'network', retrying false", async () => {
    const events = capture();
    const h = harness(["network", "network"]);
    await uploadToWorkerSlot(input(h.fetchImpl));
    const sent = events.filter((e) => e.name === "upload_attempt_failed");
    expect(sent.map((e) => [e.status, e.attempt, e.retrying])).toEqual([
      ["network", 1, true],
      ["network", 2, false],
    ]);
  });

  it("a timeout is sent as status 'timeout'", async () => {
    const events = capture();
    const h = harness(["hang", { status: 200 }]);
    await uploadToWorkerSlot(input(h.fetchImpl, { timeoutMs: 15 }));
    expect(
      events
        .filter((e) => e.name === "upload_attempt_failed")
        .map((e) => e.status),
    ).toEqual(["timeout"]);
  });

  it("no event carries the slot URL, its signature, the filename or a raw size", async () => {
    const events = capture();
    const h = harness([{ status: 403 }, { status: 503 }, { status: 503 }]);
    await uploadToWorkerSlot(input(h.fetchImpl));
    const sent = events.filter((e) => e.name === "upload_attempt_failed");
    // Health check: the assertion below is vacuous over an empty list.
    expect(sent.length).toBeGreaterThanOrEqual(2);
    const wire = JSON.stringify(sent);
    for (const leak of [
      "storage.example",
      "Signature",
      "AKIA",
      "Bank Statement",
      "f1",
      "f2",
    ]) {
      expect(wire).not.toContain(leak);
    }
    for (const e of sent) {
      expect(Object.keys(e).sort()).toEqual(
        [
          "attempt",
          "duration",
          "name",
          "retrying",
          "size",
          "status",
          "toolSlug",
        ].sort(),
      );
    }
  });

  it("a clean upload sends nothing", async () => {
    const events = capture();
    const h = harness([{ status: 200 }]);
    await uploadToWorkerSlot(input(h.fetchImpl));
    expect(events.filter((e) => e.name === "upload_attempt_failed")).toEqual(
      [],
    );
  });
});

describe("uploadToWorkerSlot — our own typed error is kept", () => {
  it("a slot served by this app (local-dev) keeps its JSON reason and code", async () => {
    const fetchImpl: SlotFetch = async (url) => {
      if (url === "/api/uploads") {
        return response(201, {
          slots: [
            {
              fileId: "f1",
              filename: FILENAME,
              url: "/api/uploads/local/f1",
              method: "PUT",
              headers: {},
            },
          ],
        });
      }
      return response(413, {
        error: { code: "payload_too_large", message: "Too large." },
      });
    };
    const result = await uploadToWorkerSlot(input(fetchImpl));
    expect(result).toEqual({
      ok: false,
      code: "payload_too_large",
      message: "Too large.",
    });
  });
});

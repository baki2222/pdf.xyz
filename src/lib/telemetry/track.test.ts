import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NOOP_SINK,
  configureTelemetry,
  createConsoleSink,
  defaultSinkFor,
  resetTelemetry,
  sanitizeEvent,
  track,
  type ProductEvent,
  type RedactedEvent,
} from "./track";

afterEach(() => {
  resetTelemetry();
  vi.restoreAllMocks();
});

describe("sanitizeEvent", () => {
  it("drops events whose name isn't on the allowlist", () => {
    expect(
      sanitizeEvent({ name: "not_a_real_event" } as unknown as ProductEvent),
    ).toBeNull();
    expect(sanitizeEvent(undefined as unknown as ProductEvent)).toBeNull();
  });

  it("preserves the trusted name and safe fields unchanged", () => {
    const out = sanitizeEvent({
      name: "worker_status_checked",
      mode: "local-dev",
      enabled: true,
    });
    expect(out).toEqual({
      name: "worker_status_checked",
      mode: "local-dev",
      enabled: true,
    });
  });

  it("redacts a filename that leaks into a field (defense in depth)", () => {
    const out = sanitizeEvent({
      name: "tool_viewed",
      toolSlug: "clientlist.pdf",
      capability: "in-browser",
    } as unknown as ProductEvent);
    expect(out?.toolSlug).toBe("[redacted].pdf");
    expect(JSON.stringify(out)).not.toContain("clientlist");
  });

  it("redacts a handoff token that leaks into a field", () => {
    const out = sanitizeEvent({
      name: "worker_contract_hit",
      capability: "secure-worker",
      ok: false,
      code: "h_abcDEF123456",
    } as unknown as ProductEvent);
    expect(out?.code).toBe("h_[redacted]");
  });
});

describe("track", () => {
  it("sends a validated, redacted payload to the configured sink", () => {
    const seen: RedactedEvent[] = [];
    configureTelemetry((e) => seen.push(e));

    track({
      name: "tool_viewed",
      toolSlug: "merge-pdf",
      capability: "in-browser",
    });

    expect(seen).toEqual([
      { name: "tool_viewed", toolSlug: "merge-pdf", capability: "in-browser" },
    ]);
  });

  it("does not send events with an unknown name", () => {
    const sink = vi.fn();
    configureTelemetry(sink);
    track({ name: "bogus_event" } as unknown as ProductEvent);
    expect(sink).not.toHaveBeenCalled();
  });

  it("never throws, even when the sink throws", () => {
    configureTelemetry(() => {
      throw new Error("sink blew up");
    });
    expect(() =>
      track({
        name: "worker_status_checked",
        mode: "disabled",
        enabled: false,
      }),
    ).not.toThrow();
  });

  it("stops sending after resetTelemetry restores the default", () => {
    const sink = vi.fn();
    configureTelemetry(sink);
    track({ name: "worker_status_checked", mode: "disabled", enabled: false });
    expect(sink).toHaveBeenCalledTimes(1);

    resetTelemetry(); // default sink is a no-op under test
    track({ name: "worker_status_checked", mode: "disabled", enabled: false });
    expect(sink).toHaveBeenCalledTimes(1);
  });
});

describe("defaultSinkFor", () => {
  it("is a no-op outside development", () => {
    expect(defaultSinkFor("production")).toBe(NOOP_SINK);
    expect(defaultSinkFor("test")).toBe(NOOP_SINK);
    expect(defaultSinkFor(undefined)).toBe(NOOP_SINK);
  });

  it("logs to the console in development", () => {
    const debug = vi.fn();
    const sink = defaultSinkFor("development", { debug });
    const event = { name: "tool_viewed" } as RedactedEvent;
    sink(event);
    expect(debug).toHaveBeenCalledWith("[telemetry]", event);
  });
});

describe("createConsoleSink", () => {
  it("falls back to console.log when debug is unavailable", () => {
    const log = vi.fn();
    const sink = createConsoleSink({ log });
    const event = { name: "tool_completed" } as RedactedEvent;
    sink(event);
    expect(log).toHaveBeenCalledWith("[telemetry]", event);
  });
});

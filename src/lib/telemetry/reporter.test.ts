import { afterEach, describe, expect, it } from "vitest";
import { newHandoffId } from "@/lib/handoff";
import { REDACTED } from "./redact";
import {
  __setTelemetryConfigForTests,
  __setTelemetryTransportForTests,
  buildErrorReport,
  buildWebVitalReport,
  reportClientError,
  reportWebVital,
  shouldSend,
  type ClientErrorReport,
  type TelemetryTransport,
} from "./reporter";
import type { TelemetryConfig } from "./config";

const ENABLED: TelemetryConfig = {
  enabled: true,
  endpoint: "/api/telemetry",
  sampleRate: 1,
};

/** Capture what the reporter would send, without touching the network. */
function captureTransport() {
  const sent: Array<{ endpoint: string; body: unknown }> = [];
  const transport: TelemetryTransport = (endpoint, body) =>
    sent.push({ endpoint, body: JSON.parse(body) });
  return { sent, transport };
}

afterEach(() => {
  __setTelemetryConfigForTests(null);
  __setTelemetryTransportForTests(null);
});

describe("buildErrorReport — redaction", () => {
  const env = { now: 1_700_000_000_000, url: "https://pdf.xyz/tools/merge-pdf?handoff=h_livetoken" };

  it("redacts the message, url, and stack; no token or filename survives", () => {
    const id = newHandoffId();
    const error = new Error(`claim ${id} failed for "Bank Statement.pdf"`);
    error.stack = `Error: claim ${id}\n  at open (/_next/static/chunks/main.js:1:1)`;
    const report = buildErrorReport(error, "boundary", { boundary: "tool-runner" }, env);
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain(id);
    expect(serialized).not.toContain("Bank Statement");
    expect(report.message).toContain("h_" + REDACTED);
    expect(report.message).toContain(`"${REDACTED}.pdf"`);
    // URL kept only as origin + path; the token-bearing query is gone.
    expect(report.url).toBe("https://pdf.xyz/tools/merge-pdf");
    expect(report.kind).toBe("boundary");
    expect(report.boundary).toBe("tool-runner");
    expect(report.name).toBe("Error");
    expect(report.ts).toBe(env.now);
  });

  it("deep-scrubs extra context and carries a digest", () => {
    const report = buildErrorReport(
      new Error("boom"),
      "route",
      { digest: "abc123", extra: { fileName: "secret.pdf", retries: 2 } },
      env,
    );
    expect(report.digest).toBe("abc123");
    expect(report.extra).toMatchObject({ fileName: REDACTED, retries: 2 });
  });

  it("handles non-Error thrown values", () => {
    const report = buildErrorReport("just a string", "manual", undefined, env);
    expect(report.name).toBe("string");
    expect(report.message).toBe("just a string");
    expect(report.stack).toBeUndefined();
  });
});

describe("buildWebVitalReport", () => {
  const env = { now: 42, url: "https://pdf.xyz/workspace?handoff=h_x" };

  it("keeps numeric metrics and redacts the url", () => {
    const report = buildWebVitalReport(
      { id: "v3-1", name: "LCP", value: 1234.5, rating: "good", delta: 10 },
      env,
    );
    expect(report).toMatchObject({
      type: "web-vital",
      name: "LCP",
      value: 1234.5,
      rating: "good",
      delta: 10,
      url: "https://pdf.xyz/workspace",
    });
  });

  it("normalizes a non-finite value to 0", () => {
    const report = buildWebVitalReport(
      { id: "x", name: "CLS", value: Number.NaN },
      env,
    );
    expect(report.value).toBe(0);
  });
});

describe("shouldSend", () => {
  it("never sends when disabled or endpoint missing", () => {
    expect(shouldSend({ enabled: false, endpoint: "/e", sampleRate: 1 }, 0)).toBe(false);
    expect(shouldSend({ enabled: true, endpoint: null, sampleRate: 1 }, 0)).toBe(false);
  });

  it("always sends at rate >= 1 and respects the roll otherwise", () => {
    expect(shouldSend(ENABLED, 0.99)).toBe(true);
    expect(shouldSend({ ...ENABLED, sampleRate: 0.5 }, 0.4)).toBe(true);
    expect(shouldSend({ ...ENABLED, sampleRate: 0.5 }, 0.6)).toBe(false);
  });
});

describe("reportClientError / reportWebVital — transport gating", () => {
  it("no-ops entirely when telemetry is disabled", () => {
    __setTelemetryConfigForTests({ enabled: false, endpoint: null, sampleRate: 0 });
    const { sent, transport } = captureTransport();
    __setTelemetryTransportForTests(transport);
    reportClientError(new Error("nope"));
    reportWebVital({ id: "1", name: "LCP", value: 1 });
    expect(sent).toHaveLength(0);
  });

  it("sends a redacted error payload when enabled", () => {
    __setTelemetryConfigForTests(ENABLED);
    const { sent, transport } = captureTransport();
    __setTelemetryTransportForTests(transport);

    const id = newHandoffId();
    reportClientError(new Error(`fail ${id} on report.pdf`), "manual", {
      extra: { fileName: "invoice.pdf" },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.endpoint).toBe("/api/telemetry");
    const body = sent[0]!.body as ClientErrorReport;
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(id);
    expect(serialized).not.toContain("invoice");
    expect(body.type).toBe("error");
    expect(body.extra).toMatchObject({ fileName: REDACTED });
  });

  it("sends web vitals when enabled", () => {
    __setTelemetryConfigForTests(ENABLED);
    const { sent, transport } = captureTransport();
    __setTelemetryTransportForTests(transport);
    reportWebVital({ id: "v3-2", name: "INP", value: 200 });
    expect(sent).toHaveLength(1);
    expect((sent[0]!.body as { name: string }).name).toBe("INP");
  });
});

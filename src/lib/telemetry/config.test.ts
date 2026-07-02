import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getTelemetryConfig,
  isTelemetryEnabled,
  resolveTelemetryConfig,
} from "./config";

describe("resolveTelemetryConfig — endpoint validation", () => {
  it("is disabled when no endpoint is set", () => {
    expect(resolveTelemetryConfig(undefined)).toEqual({
      enabled: false,
      endpoint: null,
      sampleRate: 0,
    });
    expect(resolveTelemetryConfig("")).toMatchObject({ enabled: false });
    expect(resolveTelemetryConfig("   ")).toMatchObject({ enabled: false });
  });

  it("accepts a same-origin path", () => {
    const config = resolveTelemetryConfig("/api/telemetry");
    expect(config).toMatchObject({ enabled: true, endpoint: "/api/telemetry" });
  });

  it("accepts absolute http(s) endpoints", () => {
    expect(resolveTelemetryConfig("https://ingest.example/e")).toMatchObject({
      enabled: true,
      endpoint: "https://ingest.example/e",
    });
    expect(resolveTelemetryConfig("http://localhost:4000/e")).toMatchObject({
      enabled: true,
    });
  });

  it("rejects protocol-relative, non-http, and non-URL values", () => {
    expect(resolveTelemetryConfig("//evil.example/e")).toMatchObject({
      enabled: false,
    });
    expect(resolveTelemetryConfig("javascript:alert(1)")).toMatchObject({
      enabled: false,
    });
    expect(resolveTelemetryConfig("ftp://x/y")).toMatchObject({ enabled: false });
    expect(resolveTelemetryConfig("not a url")).toMatchObject({ enabled: false });
  });
});

describe("resolveTelemetryConfig — sample rate", () => {
  it("defaults to 1 when unset or unparseable", () => {
    expect(resolveTelemetryConfig("/e").sampleRate).toBe(1);
    expect(resolveTelemetryConfig("/e", "abc").sampleRate).toBe(1);
  });

  it("parses and clamps to [0, 1]", () => {
    expect(resolveTelemetryConfig("/e", "0.25").sampleRate).toBe(0.25);
    expect(resolveTelemetryConfig("/e", "2").sampleRate).toBe(1);
    expect(resolveTelemetryConfig("/e", "-3").sampleRate).toBe(0);
  });

  it("treats a zero sample rate as disabled even with a valid endpoint", () => {
    expect(resolveTelemetryConfig("/e", "0")).toMatchObject({
      enabled: false,
      endpoint: "/e",
      sampleRate: 0,
    });
  });
});

describe("getTelemetryConfig — env wiring", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is disabled by default (no NEXT_PUBLIC endpoint)", () => {
    expect(getTelemetryConfig().enabled).toBe(false);
    expect(isTelemetryEnabled()).toBe(false);
  });

  it("reads the endpoint and rate from the environment", () => {
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_ENDPOINT", "https://ingest.example/e");
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_SAMPLE_RATE", "0.5");
    expect(getTelemetryConfig()).toMatchObject({
      enabled: true,
      endpoint: "https://ingest.example/e",
      sampleRate: 0.5,
    });
  });
});

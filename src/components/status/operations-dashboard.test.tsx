import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { collectWebOperationsSnapshot } from "@/lib/workers/observability";
import {
  configureTelemetry,
  resetTelemetry,
  type RedactedEvent,
} from "@/lib/telemetry/track";
import { WorkerOperationsDashboard } from "./operations-dashboard";

const NO_CONFIG = collectWebOperationsSnapshot({});
const DRAINABLE = collectWebOperationsSnapshot({
  PDFXYZ_STORAGE_PROVIDER: "s3",
  PDFXYZ_S3_ENDPOINT: "https://s3.example.com",
  PDFXYZ_S3_REGION: "auto",
  PDFXYZ_S3_BUCKET: "pdfxyz-store",
  PDFXYZ_S3_ACCESS_KEY_ID: "AKIAEXAMPLE123",
  PDFXYZ_S3_SECRET_ACCESS_KEY: "s3-secret-value-1234567890",
  PDFXYZ_QUEUE_PROVIDER: "redis",
  PDFXYZ_REDIS_REST_URL: "https://redis.example.com",
  PDFXYZ_REDIS_REST_TOKEN: "redis-rest-token-1234",
});

function mockFetchOnce(impl: () => Promise<unknown>) {
  const fn = vi.fn().mockImplementation(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WorkerOperationsDashboard", () => {
  it("shows a loading state while the snapshot is in flight", () => {
    mockFetchOnce(() => new Promise(() => {})); // never resolves
    render(<WorkerOperationsDashboard />);
    expect(
      screen.getByText(/reading the worker operations snapshot/i),
    ).toBeInTheDocument();
  });

  it("renders the no-config snapshot honestly: blocked, configure-providers, daemon caveat", async () => {
    mockFetchOnce(async () => ({ ok: true, json: async () => NO_CONFIG }));
    render(<WorkerOperationsDashboard />);

    expect(
      await screen.findByText("Configure the queue and storage"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /worker operations/i }),
    ).toBeInTheDocument();
    // The honest caveat: web can't observe a worker process.
    expect(
      screen.getByText(/can.?t see a running worker/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/cannot observe a separate worker process/i),
    ).toBeInTheDocument();
    // Health class surfaces.
    expect(screen.getAllByText("Blocked").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the drainable snapshot: declare-lifecycle, still no observed worker", async () => {
    mockFetchOnce(async () => ({ ok: true, json: async () => DRAINABLE }));
    render(<WorkerOperationsDashboard />);

    expect(
      await screen.findByText("Declare a retention backstop"),
    ).toBeInTheDocument();
    expect(screen.getByText(/can.?t see a running worker/i)).toBeInTheDocument();
  });

  it("shows a recoverable error and retries when the endpoint is unreachable", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ ok: true, json: async () => NO_CONFIG });
    vi.stubGlobal("fetch", fetchFn);

    render(<WorkerOperationsDashboard />);

    const retry = await screen.findByRole("button", { name: /retry/i });
    expect(
      screen.getByText(/couldn't reach the operations endpoint/i),
    ).toBeInTheDocument();
    // The error copy must not read as "worker down".
    expect(screen.getByText(/doesn't mean a worker is down/i)).toBeInTheDocument();

    retry.click();

    expect(
      await screen.findByText("Configure the queue and storage"),
    ).toBeInTheDocument();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("emits a privacy-safe worker_operations_checked event with only bounded enums", async () => {
    const seen: RedactedEvent[] = [];
    configureTelemetry((e) => seen.push(e));
    mockFetchOnce(async () => ({ ok: true, json: async () => NO_CONFIG }));

    render(<WorkerOperationsDashboard />);

    await screen.findByText("Configure the queue and storage");
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({
      name: "worker_operations_checked",
      mode: NO_CONFIG.mode,
      health: NO_CONFIG.health,
      recommendedAction: NO_CONFIG.recommendedAction,
      drainable: NO_CONFIG.drainable,
      daemonObserved: NO_CONFIG.daemonObserved,
    });
  });
});

describe("WorkerOperationsDashboard — accessibility", () => {
  it("nests the loading state as a live status inside a named landmark section", () => {
    mockFetchOnce(() => new Promise(() => {})); // never resolves
    render(<WorkerOperationsDashboard />);
    // The <section aria-labelledby> is an accessible region named by its heading.
    expect(
      screen.getByRole("region", { name: /worker operations/i }),
    ).toBeInTheDocument();
    // The in-flight state announces itself politely.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("exposes a failure as an alert with an accessibly-named retry button", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    render(<WorkerOperationsDashboard />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /retry/i }),
    ).toBeInTheDocument();
  });

  it("labels the ready state with a heading and a named refresh control", async () => {
    mockFetchOnce(async () => ({ ok: true, json: async () => NO_CONFIG }));
    render(<WorkerOperationsDashboard />);
    await screen.findByText("Configure the queue and storage");
    expect(
      screen.getByRole("heading", { name: /worker operations/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /refresh/i }),
    ).toBeInTheDocument();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  configureTelemetry,
  resetTelemetry,
  type RedactedEvent,
} from "@/lib/telemetry/track";
import { SystemStatus, type LocalToolRef } from "./system-status";

const DISABLED_STATUS: WorkerStatus = {
  mode: "disabled",
  enabled: false,
  localDevOnly: false,
  detail: "No secure worker is configured in this environment.",
  compress: { lossless: false, deep: false, engines: [] },
  ocr: { pdf: false, image: false, engines: [] },
};

const LOCAL_TOOLS: LocalToolRef[] = [
  { slug: "merge-pdf", name: "Merge PDF" },
  { slug: "split-pdf", name: "Split PDF" },
];

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

describe("SystemStatus", () => {
  it("lists the in-browser tools that always run on-device", async () => {
    mockFetchOnce(async () => ({ ok: true, json: async () => DISABLED_STATUS }));
    render(<SystemStatus localTools={LOCAL_TOOLS} />);

    expect(screen.getByText("Merge PDF")).toBeInTheDocument();
    expect(screen.getByText("Split PDF")).toBeInTheDocument();
    expect(screen.getByText(/2 tools run/i)).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
  });

  it("reads worker status and emits a privacy-safe worker_status_checked event", async () => {
    const seen: RedactedEvent[] = [];
    configureTelemetry((e) => seen.push(e));
    mockFetchOnce(async () => ({ ok: true, json: async () => DISABLED_STATUS }));

    render(<SystemStatus localTools={LOCAL_TOOLS} />);

    expect(await screen.findByText(DISABLED_STATUS.detail)).toBeInTheDocument();
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({
      name: "worker_status_checked",
      mode: "disabled",
      enabled: false,
    });
  });

  it("shows a recoverable error and retries when the endpoint is unreachable", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ ok: true, json: async () => DISABLED_STATUS });
    vi.stubGlobal("fetch", fetchFn);

    render(<SystemStatus localTools={LOCAL_TOOLS} />);

    const retry = await screen.findByRole("button", { name: /retry/i });
    expect(screen.getByText(/couldn't reach the status endpoint/i)).toBeInTheDocument();

    retry.click();

    expect(await screen.findByText(DISABLED_STATUS.detail)).toBeInTheDocument();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

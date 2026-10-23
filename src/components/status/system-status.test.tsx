// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import {
  configureTelemetry,
  resetTelemetry,
  type RedactedEvent,
} from "@/lib/telemetry/track";
import { buildOcrCapability } from "@/lib/workers/ocr";
import { describeOcrLanguage } from "@/lib/jobs/ocr";
import { SystemStatus, type LocalToolRef } from "./system-status";

const DISABLED_STATUS: WorkerStatus = {
  mode: "disabled",
  enabled: false,
  localDevOnly: false,
  detail: "No secure worker is configured in this environment.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: false, detail: "not scanned" },
  ocr: {
    available: false,
    engine: null,
    languages: [],
    detail: "OCR is unavailable in this environment.",
  },
  security: {
    available: false,
    operations: ["protect", "unlock"],
    detail: "PDF password protection is unavailable in this environment.",
  },
  providers: getProviderReadiness("disabled"),
  daemon: resolveDaemonReadiness({}),
  ai: resolveAiReadiness({}),
  pipeline: {
    verdict: "off",
    observed: false,
    drainable: false,
    detail: "no worker observed",
  },
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

/** The OCR row's language line, found the same way by both directions. */
function languagesLine(): HTMLElement | null {
  return screen.queryByText(
    (_, el) =>
      el?.tagName === "P" && (el.textContent ?? "").startsWith("Languages:"),
  );
}

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SystemStatus", () => {
  it("lists the in-browser tools that always run on-device", async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => DISABLED_STATUS,
    }));
    render(<SystemStatus localTools={LOCAL_TOOLS} />);

    expect(screen.getByText("Merge PDF")).toBeInTheDocument();
    expect(screen.getByText("Split PDF")).toBeInTheDocument();
    // Was "2 tools run entirely on your device, in your browser — your files
    // never leave the browser…" until the visitor's rewrite of 2026-10-23.
    expect(
      screen.getByText(/2 tools work right on your device/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
  });

  it("shows an honest OCR capability row read from the live status", async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => DISABLED_STATUS,
    }));
    render(<SystemStatus localTools={LOCAL_TOOLS} />);

    expect(await screen.findByText("OCR")).toBeInTheDocument();
    expect(screen.getByText(DISABLED_STATUS.ocr.detail)).toBeInTheDocument();
    // Disabled OCR shows its own "Not enabled" badge alongside the worker one.
    expect(screen.getAllByText("Not enabled").length).toBeGreaterThanOrEqual(2);
  });

  it("lists the languages its OCR detail says are listed", async () => {
    // The detail comes from the real capability builder, so the sentence and
    // the list it points at cannot be tested apart. Until 2026-09-27 the
    // detail said "The languages listed are the recognition packs that worker
    // actually has installed" above a row that listed none.
    const ocr = buildOcrCapability(
      "remote-configured",
      undefined,
      ["spa", "eng"],
      true,
    );
    expect(ocr.detail).toMatch(/languages listed/i);
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => ({ ...DISABLED_STATUS, ocr }),
    }));
    render(<SystemStatus localTools={LOCAL_TOOLS} />);

    expect(await screen.findByText(ocr.detail)).toBeInTheDocument();
    const list = languagesLine();
    expect(list).not.toBeNull();
    expect(list!.textContent).toBe(
      `Languages: ${ocr.languages.map(describeOcrLanguage).join(", ")}`,
    );
    expect(list!.textContent).toBe("Languages: English, Spanish");
  });

  it("lists no languages while OCR is not available (the mirror)", async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => DISABLED_STATUS,
    }));
    render(<SystemStatus localTools={LOCAL_TOOLS} />);
    expect(await screen.findByText("OCR")).toBeInTheDocument();
    expect(languagesLine()).toBeNull();
  });

  it("shows an honest AI capability row read from the live status", async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => DISABLED_STATUS,
    }));
    render(<SystemStatus localTools={LOCAL_TOOLS} />);

    expect(await screen.findByText("AI tools")).toBeInTheDocument();
    // With nothing declared the page states the absence rather than implying a
    // model is reachable because the worker pipeline exists.
    expect(screen.getByText(DISABLED_STATUS.ai.detail)).toBeInTheDocument();
    expect(DISABLED_STATUS.ai.ready).toBe(false);
  });

  it("shows AI as declared when the deployment names a provider family", async () => {
    const declared: WorkerStatus = {
      ...DISABLED_STATUS,
      ai: resolveAiReadiness({ PDFXYZ_AI_PROVIDER: "anthropic" }),
    };
    mockFetchOnce(async () => ({ ok: true, json: async () => declared }));
    render(<SystemStatus localTools={LOCAL_TOOLS} />);

    expect(await screen.findByText("AI tools")).toBeInTheDocument();
    expect(screen.getByText("Declared")).toBeInTheDocument();
    // INVERTED 2026-10-23. This asserted the row rendered `ai.detail` as
    // served — which names the model ("…the anthropic provider (model …)").
    // Nothing on /status needs the model, so the row now says the provider
    // is declared without it (`system-status.plain.test.tsx` holds the
    // absence, with a positive control on the detail).
    expect(declared.ai.detail).toMatch(/\(model /);
    expect(screen.queryByText(declared.ai.detail)).toBeNull();
    expect(
      screen.getByText(/An AI provider is declared for this deployment/),
    ).toBeInTheDocument();
  });

  it("shows the production pipeline providers, each honestly not configured", async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => DISABLED_STATUS,
    }));
    render(<SystemStatus localTools={LOCAL_TOOLS} />);

    expect(await screen.findByText("Production pipeline")).toBeInTheDocument();
    expect(screen.getByText("Object storage")).toBeInTheDocument();
    expect(screen.getByText("Job queue")).toBeInTheDocument();
    expect(screen.getByText("Processor")).toBeInTheDocument();
    // Storage, queue, and processor each render a "Not configured" badge.
    expect(screen.getAllByText("Not configured").length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it("reads worker status and emits a privacy-safe worker_status_checked event", async () => {
    const seen: RedactedEvent[] = [];
    configureTelemetry((e) => seen.push(e));
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => DISABLED_STATUS,
    }));

    render(<SystemStatus localTools={LOCAL_TOOLS} />);

    // The lead renders the pipeline summary now, not the web process's
    // in-process facet — that facet's string headlined /status over a live
    // worker on 2026-08-10.
    expect(
      await screen.findByText(DISABLED_STATUS.pipeline.detail),
    ).toBeInTheDocument();
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
    expect(
      screen.getByText(/couldn't reach the status endpoint/i),
    ).toBeInTheDocument();

    retry.click();

    // The lead renders the pipeline summary now, not the web process's
    // in-process facet — that facet's string headlined /status over a live
    // worker on 2026-08-10.
    expect(
      await screen.findByText(DISABLED_STATUS.pipeline.detail),
    ).toBeInTheDocument();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

// @vitest-environment jsdom
/**
 * Tool-run outcomes reach the sink — read at the sink, which is what GA4 is
 * handed, through the real hook, the real job client and the real page
 * component.
 *
 * `event-call-sites.test.ts` proves a sender EXISTS for every event; this file
 * proves the senders RUN and say the right thing: which tool, which coarse
 * reason, and never the error message.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { useEffect } from "react";
import {
  configureTelemetry,
  resetTelemetry,
  sanitizeEvent,
  TOOL_ERROR_REASONS,
  toolErrorReason,
  type ProductEvent,
  type RedactedEvent,
} from "./track";
import { ToolTelemetry } from "@/components/telemetry/tool-telemetry";
import { useAsyncRun } from "@/components/tools/runner/runner-kit";
import { PdfEngineError } from "@/lib/pdf/engine";
import {
  runSecurityJob,
  type FetchLike,
} from "@/lib/workers/pdf-security-client";

const SECRET = "clientlist-2026.pdf could not be read";

function sink(): RedactedEvent[] {
  const seen: RedactedEvent[] = [];
  configureTelemetry((e) => seen.push(e));
  return seen;
}

afterEach(() => {
  resetTelemetry();
});

describe("toolErrorReason", () => {
  it("maps every code into the fixed reasons, and unknowns to processing-error", () => {
    const codes = [
      "rate_limited",
      "worker_not_configured",
      "unsupported_file_type",
      "unprocessable_entity",
      "unsupported_tool",
      "internal_error",
      "network",
      "timeout",
      "something_new",
      undefined,
    ];
    const reasons = codes.map(toolErrorReason);
    for (const r of reasons)
      expect(TOOL_ERROR_REASONS as readonly string[]).toContain(r);
    expect(toolErrorReason("worker_not_configured")).toBe("worker-unavailable");
    expect(toolErrorReason("unprocessable_entity")).toBe("invalid-input");
    expect(toolErrorReason("something_new")).toBe("processing-error");
    expect(toolErrorReason(undefined)).toBe("processing-error");
  });

  it("sanitizeEvent drops a tool_failed whose reason is not a fixed category", () => {
    const bogus = {
      name: "tool_failed",
      toolSlug: "merge-pdf",
      capability: "in-browser",
      reason: SECRET,
    } as unknown as ProductEvent;
    expect(sanitizeEvent(bogus)).toBeNull();
    // Positive control: the same event with a real reason passes.
    expect(
      sanitizeEvent({
        name: "tool_failed",
        toolSlug: "merge-pdf",
        capability: "in-browser",
        reason: "invalid-input",
      }),
    ).not.toBeNull();
  });
});

describe("ToolTelemetry — tool_viewed reaches a sink that exists", () => {
  it("sends once when the sink is already configured", () => {
    const seen = sink();
    render(<ToolTelemetry toolSlug="merge-pdf" capability="in-browser" />);
    expect(seen.filter((e) => e.name === "tool_viewed")).toEqual([
      { name: "tool_viewed", toolSlug: "merge-pdf", capability: "in-browser" },
    ]);
  });

  it("sends once when the sink arrives AFTER the page mounted (consent effect order)", () => {
    render(<ToolTelemetry toolSlug="merge-pdf" capability="in-browser" />);
    const seen = sink();
    expect(seen.filter((e) => e.name === "tool_viewed")).toHaveLength(1);
    configureTelemetry((e) => seen.push(e));
    expect(
      seen.filter((e) => e.name === "tool_viewed"),
      "a re-configured sink must not count the view twice",
    ).toHaveLength(1);
  });
});

/** The real shared run hook, driven once. */
function Runner({ task }: { task: () => Promise<unknown> }) {
  const { run } = useAsyncRun<unknown>();
  useEffect(() => {
    void run(task);
  }, [run, task]);
  return null;
}

describe("browser runners — useAsyncRun reports the outcome", () => {
  it("a typed input refusal is tool_failed / invalid-input, without the message", async () => {
    const seen = sink();
    const task = async () => {
      throw new PdfEngineError(SECRET);
    };
    await act(async () => {
      render(
        <>
          <ToolTelemetry toolSlug="rotate-pdf" capability="in-browser" />
          <Runner task={task} />
        </>,
      );
    });
    const failed = seen.filter((e) => e.name === "tool_failed");
    expect(failed).toEqual([
      {
        name: "tool_failed",
        toolSlug: "rotate-pdf",
        capability: "in-browser",
        reason: "invalid-input",
      },
    ]);
    expect(JSON.stringify(seen)).not.toContain("clientlist");
  });

  it("an unexpected throw is processing-error; a success is tool_completed", async () => {
    const seen = sink();
    const boom = async () => {
      throw new Error("kaboom");
    };
    const ok = async () => new Uint8Array([1]);
    await act(async () => {
      render(
        <>
          <ToolTelemetry toolSlug="rotate-pdf" capability="in-browser" />
          <Runner task={boom} />
          <Runner task={ok} />
        </>,
      );
    });
    expect(seen.find((e) => e.name === "tool_failed")?.reason).toBe(
      "processing-error",
    );
    const done = seen.filter((e) => e.name === "tool_completed");
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({
      toolSlug: "rotate-pdf",
      capability: "in-browser",
    });
    expect(typeof done[0]!.duration).toBe("string");
    expect("outputSize" in done[0]!).toBe(false);
  });

  it("with no tool page mounted, nothing is sent — a run cannot name its tool", async () => {
    const seen = sink();
    await act(async () => {
      render(<Runner task={async () => 1} />);
    });
    expect(seen.filter((e) => e.name.startsWith("tool_"))).toEqual([]);
  });
});

async function textPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 300]).drawText("Quarterly revenue rose.", {
    x: 20,
    y: 150,
    size: 12,
    font,
  });
  return doc.save();
}

const notConfigured: FetchLike = async () => ({
  ok: false,
  status: 503,
  json: async () => ({
    error: { code: "worker_not_configured", message: SECRET },
  }),
  arrayBuffer: async () => new ArrayBuffer(0),
});

describe("worker panels — runSecurityJob reports the outcome", () => {
  it("a worker that is not configured is tool_failed / worker-unavailable", async () => {
    const seen = sink();
    render(<ToolTelemetry toolSlug="summarize-pdf" capability="ai" />);
    const result = await runSecurityJob(
      "summarize-pdf",
      "doc.pdf",
      await textPdf(),
      {},
      { fetchImpl: notConfigured },
    );
    expect(result.ok).toBe(false);
    expect(seen.filter((e) => e.name === "tool_failed")).toEqual([
      {
        name: "tool_failed",
        toolSlug: "summarize-pdf",
        capability: "ai",
        reason: "worker-unavailable",
      },
    ]);
    expect(JSON.stringify(seen)).not.toContain("clientlist");
  });

  it("a dropped connection is reported, and the error still reaches the caller", async () => {
    const seen = sink();
    render(<ToolTelemetry toolSlug="protect-pdf" capability="secure-worker" />);
    await expect(
      runSecurityJob(
        "protect-pdf",
        "doc.pdf",
        await textPdf(),
        {},
        {
          fetchImpl: async () => {
            throw new TypeError("Failed to fetch");
          },
        },
      ),
    ).rejects.toThrow("Failed to fetch");
    expect(seen.find((e) => e.name === "tool_failed")?.reason).toBe(
      "worker-unavailable",
    );
  });

  it("a job for a different tool than the page's is not attributed to the page", async () => {
    const seen = sink();
    render(<ToolTelemetry toolSlug="merge-pdf" capability="in-browser" />);
    await runSecurityJob(
      "protect-pdf",
      "doc.pdf",
      await textPdf(),
      {},
      {
        fetchImpl: notConfigured,
      },
    );
    expect(seen.filter((e) => e.name === "tool_failed")).toEqual([]);
  });
});

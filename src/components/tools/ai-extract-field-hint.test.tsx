// @vitest-environment jsdom
// @native-canvas
/**
 * Each field in AI Data Extraction's schema takes an optional hint (audit
 * ai-extract#4, 2026-11-07).
 *
 * The job contract accepted a per-field `description` and the engine put it
 * in the prompt (`- "total" (number) — the grand total…`), but the panel had
 * no input for it: its run code forwarded `f.description`, which nothing ever
 * set. The FAQ told a reader who got the wrong one of several similar figures
 * to cram the hint into the field NAME, which is then their JSON key.
 *
 * Driven through the real panel and the real browser job client over a
 * recording network (`stubJobNetwork`, not `vi.mock`, for the module-cache
 * reason it documents); what is asserted is the `POST /api/jobs` body — the
 * composed chain from the input to the wire, not the component's state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import { MAX_FIELD_DESCRIPTION_CHARS } from "@/lib/jobs/ai-extract";
import { canRunAiExtract } from "@/lib/workers/ai-extract-client";
import { resetTelemetry } from "@/lib/telemetry/track";
import { READY_WORKER_STATUS } from "@/tests/ready-worker-status";
import { stubJobNetwork } from "@/tests/stub-job-network";
import { AiExtractWorkerPanel } from "./ai-extract-worker-panel";

const tool = getToolBySlug("ai-extract")!;

afterEach(() => {
  cleanup();
  resetTelemetry();
  vi.unstubAllGlobals();
});

async function runWith(name: string, hint: string | null) {
  // Health: the stubbed status really is one the panel runs on.
  expect(canRunAiExtract(READY_WORKER_STATUS)).toBe(true);
  const network = stubJobNetwork(READY_WORKER_STATUS);
  const { container } = render(<AiExtractWorkerPanel tool={tool} />);
  fireEvent.change(
    await screen.findByRole("textbox", { name: "Field 1 name" }),
    { target: { value: name } },
  );
  if (hint !== null) {
    fireEvent.change(screen.getByRole("textbox", { name: "Field 1 hint" }), {
      target: { value: hint },
    });
  }
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error("the builder has no file input");
  fireEvent.change(input, {
    target: {
      files: [
        new File([new Uint8Array([1, 2, 3])], "invoice.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  const button = screen.getByRole("button", { name: /extract data/i });
  await waitFor(() =>
    expect(button).not.toHaveAttribute("aria-disabled", "true"),
  );
  fireEvent.click(button);
  await waitFor(() => expect(network.jobBodies).toHaveLength(1), {
    timeout: 10_000,
  });
  const options = network.jobBodies[0]!.options as {
    schema?: { name: string; type: string; description?: string }[];
  };
  return options.schema ?? [];
}

describe("AI Data Extraction: a hint per field reaches the job", () => {
  it("the hint typed under a field is sent as that field's description", async () => {
    const schema = await runWith(
      "total",
      "  the grand total including VAT, not the subtotal  ",
    );
    expect(schema).toEqual([
      {
        name: "total",
        type: "string",
        description: "the grand total including VAT, not the subtotal",
      },
    ]);
  }, 30_000);

  it("CONTROL: no hint sends no description, and the key stays the name", async () => {
    expect(await runWith("total", null)).toEqual([
      { name: "total", type: "string" },
    ]);
  }, 30_000);

  it("the hint stops at the contract's limit, so the worker never refuses it", async () => {
    render(<AiExtractWorkerPanel tool={tool} />);
    stubJobNetwork(READY_WORKER_STATUS);
    const hint = (await screen.findByRole("textbox", {
      name: "Field 1 hint",
    })) as HTMLInputElement;
    expect(hint.maxLength).toBe(MAX_FIELD_DESCRIPTION_CHARS);
    fireEvent.change(hint, {
      target: { value: "x".repeat(MAX_FIELD_DESCRIPTION_CHARS + 25) },
    });
    expect(hint.value).toHaveLength(MAX_FIELD_DESCRIPTION_CHARS);
  }, 30_000);
});

// @vitest-environment jsdom
/**
 * /status, read by a VISITOR (owner, 2026-10-23: "it reads as an operator
 * dashboard"). Until this change the first screen said "liveness
 * heartbeat", "out-of-band secure worker", "Worker daemon · Drainable",
 * "Production pipeline" and "AI is configured in this process with the
 * openai provider (model gpt-5.6-luna)", over a WORKER OPERATIONS section.
 *
 * Now: one overall line, three plain cards in the tool cards' words, and
 * every technical row one press away under "Technical details".
 *
 * PINNED AS RELATIONSHIPS, not strings (CLAUDE.md): each card's verdict is
 * the answer the TOOL PAGES give for the same status — `canRunPdfSecurity`
 * (every secure-server panel's base predicate), `ocr.available` (the OCR
 * panel's), `canRunAiTool` (the four AI panels') — over a set of statuses
 * built by the real derivation, so this page cannot say "available" while a
 * tool page keeps Run off, or the reverse. Health: the set holds both an
 * all-on and an all-off answer for every card, so neither direction is
 * vacuous.
 *
 * AND THE MODEL NAME IS GONE from the whole page, technical details too:
 * nothing a visitor or an operator does on this page needs it, and no guard
 * required it. `/api/worker/status` still serves it; the positive control
 * below proves the fixture's detail carried it, so its absence here is not
 * the absence of a string that was never there.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { buildWorkerStatus, type WorkerStatus } from "@/lib/workers/status";
import { canRunPdfSecurity } from "@/lib/workers/pdf-security-client";
import { canRunAiTool } from "@/lib/workers/ai-tool-availability";
import { resetTelemetry } from "@/lib/telemetry/track";
import { READY_WORKER_STATUS } from "@/tests/ready-worker-status";
import { SystemStatus } from "./system-status";

const MODEL = "model-placeholder-x9";

const PROD_ENV = {
  PDFXYZ_STORAGE_PROVIDER: "s3",
  PDFXYZ_S3_ENDPOINT: "https://s3.example.com",
  PDFXYZ_S3_REGION: "auto",
  PDFXYZ_S3_BUCKET: "pdfxyz-inputs",
  PDFXYZ_S3_ACCESS_KEY_ID: "AKIAEXAMPLE123",
  PDFXYZ_S3_SECRET_ACCESS_KEY: "inert-placeholder-secret",
  PDFXYZ_QUEUE_PROVIDER: "redis",
  PDFXYZ_REDIS_REST_URL: "https://redis.example.com",
  PDFXYZ_REDIS_REST_TOKEN: "inert-placeholder-token",
  PDFXYZ_AI_PROVIDER: "openai",
  PDFXYZ_AI_MODEL: MODEL,
} as const;

const SUBJECTS: Record<string, WorkerStatus> = {
  ready: READY_WORKER_STATUS,
  production: buildWorkerStatus(
    "disabled",
    undefined,
    undefined,
    PROD_ENV,
    undefined,
    true,
    true,
    true,
    ["eng", "ben"],
  ),
  configuredNotObserved: buildWorkerStatus(
    "disabled",
    undefined,
    undefined,
    PROD_ENV,
    undefined,
    false,
    false,
    false,
  ),
  noAi: buildWorkerStatus(
    "disabled",
    undefined,
    undefined,
    { ...PROD_ENV, PDFXYZ_AI_PROVIDER: undefined, PDFXYZ_AI_MODEL: undefined },
    undefined,
    true,
    true,
    true,
    ["eng"],
  ),
  allDead: buildWorkerStatus("disabled", undefined, undefined, {}),
  localDev: buildWorkerStatus("local-dev", undefined, undefined, {}),
};

/** Shown: no ancestor (or itself) carries `hidden`. */
function shown(el: Element): boolean {
  for (let at: Element | null = el; at; at = at.parentElement)
    if (at.hasAttribute("hidden")) return false;
  return true;
}

/** The verdict a card shows, from its `data-verdict`. */
function verdictOf(card: string): string | null {
  const el = document.querySelector(`[data-status-card="${card}"]`);
  return el?.getAttribute("data-verdict") ?? null;
}

async function renderWith(status: WorkerStatus) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => status })),
  );
  const view = render(<SystemStatus localTools={[]} />);
  await waitFor(() =>
    expect(
      document.querySelector("[data-overall]")?.getAttribute("data-overall"),
    ).not.toBe("loading"),
  );
  return view;
}

afterEach(() => {
  cleanup();
  resetTelemetry();
  vi.unstubAllGlobals();
});

describe("health: the subjects cover both answers of every card", () => {
  it("each predicate is true for some subject and false for another", () => {
    const all = Object.values(SUBJECTS);
    for (const pred of [
      canRunPdfSecurity,
      (s: WorkerStatus) => s.ocr.available,
      canRunAiTool,
    ]) {
      expect(all.some(pred)).toBe(true);
      expect(all.some((s) => !pred(s))).toBe(true);
    }
  });

  it("positive control: the declared fixture's detail names the model", () => {
    expect(SUBJECTS.production!.ai.detail).toContain(MODEL);
  });
});

describe("the cards say what the tool pages would", () => {
  it.each(Object.entries(SUBJECTS))("%s", async (_name, status) => {
    await renderWith(status);
    const server = canRunPdfSecurity(status);
    const ocr = status.ocr.available;
    const ai = canRunAiTool(status);
    expect(verdictOf("browser")).toBe("available");
    expect(verdictOf("server")).toBe(server ? "available" : "offline");
    expect(verdictOf("ai")).toBe(ai ? "available" : "offline");
    expect(
      document.querySelector("[data-overall]")?.getAttribute("data-overall"),
    ).toBe(server && ocr && ai ? "working" : "partial");
    expect(
      screen.getByText(
        server && ocr && ai ? "All systems working" : "Some tools are offline",
      ),
    ).toBeInTheDocument();
  });
});

describe("the first screen is a visitor's", () => {
  it("names the three kinds of tool in plain words", async () => {
    await renderWith(SUBJECTS.production!);
    for (const name of [
      "Tools that run in your browser",
      "Tools on our secure server",
      "AI tools",
    ])
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
  });

  it("keeps the OCR languages as a plain list", async () => {
    await renderWith(SUBJECTS.production!);
    const list = screen.getByRole("list", { name: /ocr languages/i });
    expect(shown(list)).toBe(true);
    expect(
      [...list.querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual(["English", "Bengali"]);
  });

  it("puts the technical rows behind one press, and shows none of them first", async () => {
    await renderWith(SUBJECTS.production!);
    const toggle = screen.getByRole("button", { name: "Technical details" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const region = document.getElementById(
      toggle.getAttribute("aria-controls") ?? "",
    )!;
    expect(region).not.toBeNull();
    expect(region.hasAttribute("hidden")).toBe(true);
    // The operator's words live in the region, and only there.
    for (const word of [
      "Production pipeline",
      "Worker daemon",
      "Object storage",
      SUBJECTS.production!.pipeline.detail,
    ]) {
      const hits = screen.queryAllByText(word, { exact: false });
      expect(hits.length, word).toBeGreaterThan(0);
      expect(hits.filter(shown), word).toEqual([]);
    }
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(region.hasAttribute("hidden")).toBe(false);
  });

  it("never names the AI model, technical details included", async () => {
    const { container } = await renderWith(SUBJECTS.production!);
    fireEvent.click(screen.getByRole("button", { name: "Technical details" }));
    expect(container.textContent).not.toContain(MODEL);
    // …while the AI row is still there, saying the provider is declared.
    expect(container.textContent).toMatch(/AI provider is declared/);
  });
});

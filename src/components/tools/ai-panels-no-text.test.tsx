// @vitest-environment jsdom
// @native-canvas
/**
 * An AI panel handed a scan: what the user is TOLD, read off the rendered
 * panel, and whether anything was uploaded.
 *
 * TRANSLATE PDF.
 * THE DEFECT: the panel counts text before uploading (the right idea), then
 * asked "does any page fit one provider call?" — and for a scan, whose text
 * pages list is empty, the answer is "no page fits". So it said
 *
 *   "This document has 0 characters of text, and Translate PDF can handle
 *    about 10,258 in one run … Split it into smaller files"
 *
 * a too-LONG verdict on a document with nothing in it, pointing the user at
 * the one remedy that cannot help. The worker's own answer — no selectable
 * text, run OCR PDF first — was never reached.
 *
 * SUMMARIZE PDF (and Chat, and AI Extract, which share its path) uploaded the
 * scan, reserved a third of the connection's daily AI allowance, and only
 * then heard the worker's refusal — which gives nothing back. The refusal now
 * happens in `runSecurityJob` before any request; this proves it reaches the
 * PANEL, i.e. that the panel renders the client's message rather than some
 * wrapper of its own. `ai-text-preflight.test.ts` covers every AI tool at the
 * client, over a corpus derived from the catalog.
 *
 * Driven through the real panels, real pdfjs extraction, and the real clients:
 * only `fetch` is stubbed, and every request it sees is recorded, so "nothing
 * was uploaded" is observed rather than assumed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getToolBySlug } from "@/lib/tools";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { NO_SELECTABLE_TEXT_MESSAGE } from "@/lib/jobs/ai-no-text";
import { resetTelemetry } from "@/lib/telemetry/track";
import type { Tool } from "@/lib/tools/types";
import { TranslateWorkerPanel } from "./translate-worker-panel";
import { SummarizeWorkerPanel } from "./summarize-worker-panel";

const providers = getProviderReadiness("remote-configured");

const READY: WorkerStatus = {
  mode: "remote-configured",
  enabled: true,
  localDevOnly: false,
  detail: "A worker backend is configured.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: false, detail: "not scanned" },
  ocr: {
    available: true,
    engine: "tesseract",
    languages: ["eng"],
    detail: "OCR runs on the worker.",
  },
  security: {
    available: true,
    operations: ["protect", "unlock"],
    detail: "qpdf runs on the worker.",
  },
  providers: {
    ...providers,
    storage: { ...providers.storage, ready: true },
    queue: { ...providers.queue, ready: true },
  },
  daemon: { ...resolveDaemonReadiness({}), drainable: true },
  ai: resolveAiReadiness({
    PDFXYZ_AI_PROVIDER: "openai",
    PDFXYZ_AI_MODEL: "gpt-5.6-luna",
  }),
  pipeline: {
    verdict: "off",
    observed: false,
    drainable: false,
    detail: "no worker observed",
  },
};

/** Status answers READY; every other request is recorded and refused. */
function stubFetch(): string[] {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (input === "/api/worker/status") {
        return { ok: true, status: 200, json: async () => READY };
      }
      requests.push(input);
      return {
        ok: false,
        status: 503,
        json: async () => ({
          error: { code: "worker_not_configured", message: "not configured" },
        }),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }),
  );
  return requests;
}

async function pdf(text: string | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  if (text !== null) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(text, { x: 20, y: 150, size: 12, font });
  }
  return doc.save();
}

const PANELS = {
  "translate-pdf": { Panel: TranslateWorkerPanel, button: /translate pdf/i },
  "summarize-pdf": { Panel: SummarizeWorkerPanel, button: /summarize pdf/i },
} as const;

async function run(slug: keyof typeof PANELS, bytes: Uint8Array) {
  const { Panel, button: name } = PANELS[slug];
  const tool: Tool = getToolBySlug(slug)!;
  render(<Panel tool={tool} />);
  const button = await screen.findByRole("button", { name });
  const input = document.querySelector('input[type="file"]')!;
  const file = new File([bytes.slice()], "doc.pdf", {
    type: "application/pdf",
  });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
}

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
});

describe.each(Object.keys(PANELS) as (keyof typeof PANELS)[])(
  "%s panel — a PDF with no selectable text",
  (slug) => {
    it("says run OCR first, not 'split it into smaller files', and uploads nothing", async () => {
      const requests = stubFetch();
      await run(slug, await pdf(null));

      // The worker's own sentence, first — a panel may add what is true of a
      // refusal before upload (Summarize's preflight adds "Nothing was
      // uploaded."), never replace it. Exact text until the integration of
      // wave1/l01-page-leak, where Summarize's own preflight met this check.
      expect(
        await screen.findByText((_, element) => {
          const opens = (node: Element) =>
            (node.textContent ?? "").startsWith(
              NO_SELECTABLE_TEXT_MESSAGE[slug],
            );
          // The innermost element that opens with it — not every ancestor.
          return Boolean(
            element && opens(element) && ![...element.children].some(opens),
          );
        }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/split it into smaller files/i)).toBeNull();
      expect(requests, "a scan was uploaded").toEqual([]);
    });

    it("positive control: a PDF with text goes on to the upload", async () => {
      const requests = stubFetch();
      await run(slug, await pdf("Bonjour tout le monde."));

      await waitFor(() => expect(requests[0]).toBe("/api/uploads"));
      expect(screen.queryByText(NO_SELECTABLE_TEXT_MESSAGE[slug])).toBeNull();
    });
  },
);

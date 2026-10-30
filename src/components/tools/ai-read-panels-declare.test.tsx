// @vitest-environment jsdom
// @native-canvas
/**
 * Every read-bound AI panel sends the character count of the PDF the user
 * dropped with its job — started where a user starts, with a real file in a
 * panel.
 *
 * THE GAP (review of 2026-09-28): the declaration fix wired
 * `declaredCharacters` through Summarize, Chat with PDF and AI Data Extraction,
 * and its chain test (`workers/ai-read-declaration.chain.test.ts`) begins at
 * the panel's counter plus the CLIENT. The only panel-level assertion checked that
 * the key was PRESENT, and a present key holding `undefined` passes it. A
 * reviewer set `declaredCharacters: undefined` in each panel, one at a time,
 * and nothing went red — while that chain test's own docblock says the defect
 * survived because no test started with a file in a panel. An undeclared job
 * reserves the fallback (a third of the day) whatever the document holds.
 *
 * WHERE EACH PANEL IS PROVED. Summarize is proved HERE, on the wire: the JSON
 * body of the `POST /api/jobs` request the real panel, real client and real
 * pdfjs extraction produce, with only `fetch` stubbed. AI Data Extraction and
 * Chat with PDF are proved in their own panel test files, at the driver seam
 * those files already mock — because importing those two panels into a file
 * that does NOT mock their clients re-imports a panel another file left cached
 * bound to its stub (`src/tests/mock-isolation.test.ts` refused the first
 * draft of this file for exactly that). The corpus test below finds all three
 * proofs by their assertion title, in both directions against
 * `READ_BOUND_AI_TOOLS`, so a fourth read-bound tool cannot ship unproved.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getToolBySlug } from "@/lib/tools";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { extractPdfText } from "@/lib/pdf/text";
import { AI_RUN_PRICING } from "@/lib/jobs/delivery-cap";
import { resetTelemetry } from "@/lib/telemetry/track";
import { SummarizeWorkerPanel } from "./summarize-worker-panel";

/**
 * The read-bound (per-call) AI tools, from the pricing table the route charges
 * by. This lane first typed them in `ai-read-declaration.ts`, subsumed at its
 * integration by the panels' own counters (`countDeclaredCharacters`,
 * `measureChatDocument`).
 */
const READ_BOUND_AI_TOOLS = Object.entries(AI_RUN_PRICING)
  .filter(([, pricing]) => pricing === "per-call")
  .map(([slug]) => slug);

const providers = getProviderReadiness("remote-configured");

const READY: WorkerStatus = {
  mode: "remote-configured",
  enabled: true,
  localDevOnly: false,
  detail: "A server backend is configured.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: false, detail: "not scanned" },
  ocr: {
    available: true,
    engine: "tesseract",
    languages: ["eng"],
    detail: "OCR runs on our secure server.",
  },
  security: {
    available: true,
    operations: ["protect", "unlock"],
    detail: "qpdf runs on our secure server.",
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
    detail: "no server observed",
  },
};

/** A real two-page PDF whose text the real extractor counts. */
async function textPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < 2; p += 1) {
    const page = doc.addPage([612, 792]);
    for (let l = 0; l < 6; l += 1) {
      page.drawText(`Invoice 2026-0412, line ${p + 1}.${l + 1}: total 1200.`, {
        x: 20,
        y: 760 - l * 18,
        size: 10,
        font,
      });
    }
  }
  return doc.save();
}

/** The assertion title every read-bound panel's declaration proof carries. */
const PROOF_TITLE =
  "sends the extracted character count with its job, not nothing";

/** slug → the test file holding that panel's proof (found by title below). */
const PROOFS: Record<string, string> = {
  "summarize-pdf": "ai-read-panels-declare.test.tsx",
  "ai-extract": "ai-extract-worker-panel.test.tsx",
  "chat-with-pdf": "chat-with-pdf-worker-panel.test.tsx",
};

/**
 * Status answers READY, the upload session and slot succeed, and the job
 * request is RECORDED and refused — so the panel stops there, having said
 * what it would reserve.
 */
function stubWire(): {
  jobBodies: Record<string, unknown>[];
  requested: string[];
} {
  const jobBodies: Record<string, unknown>[] = [];
  const requested: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: { body?: unknown }) => {
      requested.push(String(input));
      const ok = (body: unknown) => ({
        ok: true,
        status: 200,
        json: async () => body,
      });
      if (input === "/api/worker/status") return ok(READY);
      if (input === "/api/uploads") {
        return ok({
          slots: [
            {
              fileId: "f_abc123def456",
              url: "/test-upload-slot",
              method: "PUT",
              headers: {},
            },
          ],
        });
      }
      if (input === "/test-upload-slot") return ok({});
      if (input === "/api/jobs") {
        // The client sends its JSON as an ArrayBuffer (`jsonBody`).
        jobBodies.push(
          JSON.parse(
            new TextDecoder().decode(new Uint8Array(init?.body as ArrayBuffer)),
          ) as Record<string, unknown>,
        );
      }
      return {
        ok: false,
        status: 503,
        json: async () => ({
          error: { code: "worker_not_configured", message: "stop here" },
        }),
      };
    }),
  );
  return { jobBodies, requested };
}

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
});

describe("the corpus", () => {
  it("every read-bound tool has a panel declaration proof, and nothing else does", () => {
    expect(Object.keys(PROOFS).sort()).toEqual([...READ_BOUND_AI_TOOLS].sort());
    for (const [slug, file] of Object.entries(PROOFS)) {
      const source = readFileSync(
        path.join(process.cwd(), "src", "components", "tools", file),
        "utf8",
      );
      // The proof is found by its assertion title, and it is about THIS tool.
      expect(source, `${file} carries no "${PROOF_TITLE}" test`).toContain(
        `"${PROOF_TITLE}"`,
      );
      expect(source, `${file} never names ${slug}`).toContain(`"${slug}"`);
    }
  });
});

describe("summarize-pdf panel — a real PDF dropped by a user", () => {
  it(PROOF_TITLE, async () => {
    const bytes = await textPdf();
    const counted = (await extractPdfText(bytes)).characterCount;
    // Health: a real count, so equality below means "this document's count".
    // (It also stayed under this lane's per-day clamp, which was not kept at
    // integration: the route clamps the charge, never the count.)
    expect(counted).toBeGreaterThan(100);

    const { jobBodies, requested } = stubWire();
    render(<SummarizeWorkerPanel tool={getToolBySlug("summarize-pdf")!} />);
    const input = await waitFor(() => {
      const found = document.querySelector('input[type="file"]');
      expect(found).not.toBeNull();
      return found!;
    });
    fireEvent.change(input, {
      target: {
        files: [
          new File([bytes.slice()], "invoice.pdf", { type: "application/pdf" }),
        ],
      },
    });
    const button = await screen.findByRole("button", {
      name: /summarize pdf/i,
    });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);

    await waitFor(() =>
      expect(jobBodies, `requests: ${requested.join(", ")}`).toHaveLength(1),
    );
    // Health: this IS the summarize job — not some other request.
    expect(jobBodies[0]!.tool).toBe("summarize-pdf");
    expect(
      jobBodies[0]!.declaredCharacters,
      `the job went out declaring ${String(jobBodies[0]!.declaredCharacters)} ` +
        "— an undeclared job reserves a third of the day whatever it holds",
    ).toBe(counted);
  });
});

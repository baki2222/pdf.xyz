// @vitest-environment node
/**
 * An AI tool refuses a PDF with no selectable text IN THE BROWSER, before a
 * byte is uploaded or a character of the allowance is reserved.
 *
 * THE DEFECT (audit at 67e8d0f): Summarize, Chat and AI Extract uploaded the
 * whole file, the route reserved a third of the connection's daily AI
 * allowance, and only then did the worker say "no selectable text — run OCR
 * first". A worker-side failure gives nothing back, so three scanned PDFs
 * locked the connection out of AI for the day. Translate counted text first,
 * but on a scan it answered "This document has 0 characters of text … split it
 * into smaller files" — a too-LONG message for a document with nothing in it.
 *
 * The check lives in `runSecurityJob`, the one lifecycle every AI client goes
 * through, so no panel can forget it. Everything here reads what the CONSUMER
 * receives: the result object a panel renders, and whether `fetch` was called.
 *
 * CORPUS: the catalog's AI-capability tools — derived, never typed — must be
 * exactly the tools with a no-text message, in both directions.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { tools } from "@/lib/tools";
import { capabilityForMode } from "@/lib/jobs";
import {
  NO_SELECTABLE_TEXT_MESSAGE,
  readsOnlySelectableText,
} from "@/lib/jobs/ai-no-text";
import { extractPdfText, pdfHasSelectableText } from "@/lib/pdf/text";
import { embedRasterImage } from "@/lib/pdf/pdf-lib";
import { runSecurityJob, type FetchLike } from "./pdf-security-client";

const AI_TOOLS = tools
  .filter((tool) => capabilityForMode(tool.processing) === "ai")
  .map((tool) => tool.slug)
  .sort();

const NON_AI_TOOLS = tools
  .filter((tool) => capabilityForMode(tool.processing) !== "ai")
  .map((tool) => tool.slug);

/** A fetch that records every call and refuses, so nothing proceeds far. */
function spyFetch() {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    calls.push(input);
    return {
      ok: false,
      status: 503,
      json: async () => ({
        error: { code: "worker_not_configured", message: "not configured" },
      }),
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  };
  return { calls, fetchImpl };
}

async function pdf(
  pages: (string | null)[],
  opts: { image?: boolean } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([300, 300]);
    if (text !== null) page.drawText(text, { x: 20, y: 150, size: 12, font });
    if (opts.image) {
      // A 1×1 PNG drawn full-page: what a scanner produces, minus the pixels.
      const png = await embedRasterImage(
        doc,
        Uint8Array.from(
          atob(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==",
          ),
          (c) => c.charCodeAt(0),
        ),
        "png",
      );
      page.drawImage(png, { x: 0, y: 0, width: 300, height: 300 });
    }
  }
  return doc.save();
}

describe("the corpus: which tools refuse a text-less PDF", () => {
  it("is exactly the catalog's AI tools, in both directions", () => {
    expect(
      AI_TOOLS.length,
      "no AI tools found — asking nothing",
    ).toBeGreaterThanOrEqual(4);
    expect(Object.keys(NO_SELECTABLE_TEXT_MESSAGE).sort()).toEqual(AI_TOOLS);
  });

  it("never includes a non-AI tool — OCR's whole input is a text-less PDF", () => {
    expect(NON_AI_TOOLS.length).toBeGreaterThan(10);
    expect(NON_AI_TOOLS.filter(readsOnlySelectableText)).toEqual([]);
  });
});

describe("pdfHasSelectableText agrees with the full extraction", () => {
  it("on every fixture shape, including text that only starts on page 3", async () => {
    const fixtures: Record<string, Uint8Array> = {
      text: await pdf(["Quarterly revenue rose."]),
      blank: await pdf([null]),
      imageOnly: await pdf([null, null], { image: true }),
      whitespaceOnly: await pdf(["   "]),
      textOnPageThree: await pdf([null, null, "Late text."]),
    };
    const seen = new Set<boolean>();
    for (const [name, bytes] of Object.entries(fixtures)) {
      const quick = await pdfHasSelectableText(bytes);
      const full = (await extractPdfText(bytes)).hasText;
      expect(quick, name).toBe(full);
      seen.add(full);
    }
    // Health: the corpus has both answers, or agreement proves nothing.
    expect([...seen].sort()).toEqual([false, true]);
  });
});

describe("runSecurityJob — a text-less PDF never leaves the browser for an AI tool", () => {
  it("refuses with the tool's own message and makes no request", async () => {
    const scan = await pdf([null, null], { image: true });
    for (const slug of AI_TOOLS) {
      const { calls, fetchImpl } = spyFetch();
      const result = await runSecurityJob(
        slug,
        "scan.pdf",
        scan,
        {},
        {
          fetchImpl,
        },
      );
      expect(result.ok, slug).toBe(false);
      expect(
        !result.ok && result.message,
        `${slug} did not give the worker's own no-text answer`,
      ).toBe(
        NO_SELECTABLE_TEXT_MESSAGE[
          slug as keyof typeof NO_SELECTABLE_TEXT_MESSAGE
        ],
      );
      expect(
        calls,
        `${slug} uploaded a PDF with no selectable text, which reserves the ` +
          "AI allowance for a job the worker will refuse",
      ).toEqual([]);
    }
  });

  it("positive control: a PDF WITH text proceeds to the upload", async () => {
    const withText = await pdf(["Quarterly revenue rose."]);
    for (const slug of AI_TOOLS) {
      const { calls, fetchImpl } = spyFetch();
      const result = await runSecurityJob(
        slug,
        "doc.pdf",
        withText,
        {},
        {
          fetchImpl,
        },
      );
      expect(calls[0], slug).toBe("/api/uploads");
      expect(!result.ok && result.message).not.toMatch(/no selectable text/);
    }
  });

  it("control: a non-AI tool uploads a text-less PDF as before", async () => {
    const scan = await pdf([null], { image: true });
    for (const slug of NON_AI_TOOLS) {
      const { calls, fetchImpl } = spyFetch();
      await runSecurityJob(slug, "scan.pdf", scan, {}, { fetchImpl });
      expect(calls[0], slug).toBe("/api/uploads");
    }
  });

  it("a file the browser cannot parse is left to the worker, not refused", async () => {
    // An encrypted or damaged PDF throws in pdfjs. Refusing it here would
    // invent a verdict the browser never reached.
    const { calls, fetchImpl } = spyFetch();
    await runSecurityJob(
      AI_TOOLS[0]!,
      "odd.pdf",
      new Uint8Array([1, 2, 3]),
      {},
      { fetchImpl },
    );
    expect(calls[0]).toBe("/api/uploads");
  });
});

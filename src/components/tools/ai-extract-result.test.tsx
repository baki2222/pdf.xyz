// @vitest-environment jsdom
/**
 * AI Data Extraction's result offers a CSV of the extracted fields (audit
 * ai-extract#3), built in the browser from the package — the headline use,
 * keying invoices into accounts payable, means a spreadsheet, and until
 * 2026-11-07 the FAQ said outright there was no CSV.
 *
 * The package is made by the REAL engine; the download is caught at
 * `URL.createObjectURL`, and the Blob read back, so the test checks the bytes
 * a reader saves, not a string the component merely computed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { extractionOutputName } from "@/lib/jobs/ai-extract";
import { runAiExtract } from "@/lib/workers/ai-extract/engine";
import { CSV_BOM } from "@/lib/workers/ooxml/csv";
import { AiExtractResultBody } from "./ai-extract-worker-panel";

const ZIP = extractionOutputName("invoice.pdf");

async function realPackage(reply: unknown): Promise<Uint8Array> {
  const text = "Invoice INV-7, total 120.50.";
  const extracted: ExtractedPdfText = {
    pageCount: 1,
    pages: [],
    text,
    characterCount: text.length,
    hasText: true,
  };
  const run = await runAiExtract(
    new Uint8Array([1, 2, 3]),
    {
      mode: "schema",
      schema: [
        { name: "invoice_number", type: "string" },
        { name: "total", type: "number" },
      ],
    },
    {
      extract: async () => extracted,
      provider: {
        id: "anthropic",
        model: "claude-sonnet-5",
        async complete() {
          return {
            ok: true,
            text: JSON.stringify(reply),
            model: "claude-sonnet-5",
            usage: { inputTokens: 10, outputTokens: 10 },
          };
        },
      },
    },
  );
  if (!run.ok) throw new Error(`engine refused the fixture: ${run.kind}`);
  return run.output;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AI Data Extraction result — Download CSV", () => {
  it("saves the fields as a one-row CSV named after the ZIP", async () => {
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return "blob:test";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });

    render(
      <AiExtractResultBody
        output={await realPackage({ invoice_number: "INV-7", total: 120.5 })}
        filename={ZIP}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Download CSV (invoice-extraction.csv)",
      }),
    );
    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(names).toEqual(["invoice-extraction.csv"]);
    const bytes = new Uint8Array(await blobs[0]!.arrayBuffer());
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe(
      `${CSV_BOM}invoice_number,total\r\nINV-7,120.5`,
    );
    // Positive control: the ZIP is still offered beside it.
    expect(
      screen.getByRole("button", { name: `Download ${ZIP}` }),
    ).toBeTruthy();
  });

  it("bytes with no extraction.json offer the ZIP only, and no CSV", async () => {
    render(
      <AiExtractResultBody output={new Uint8Array([9, 9, 9])} filename={ZIP} />,
    );
    await screen.findByRole("button", { name: `Download ${ZIP}` });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("button", { name: /Download CSV/ })).toBeNull();
  });
});

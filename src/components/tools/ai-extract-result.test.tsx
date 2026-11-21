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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { extractionOutputName } from "@/lib/jobs/ai-extract";
import { MAX_DISPLAY_FILENAME_LENGTH } from "@/lib/jobs/filenames";
import { runAiExtract } from "@/lib/workers/ai-extract/engine";
import { CSV_BOM } from "@/lib/workers/ooxml/csv";
import { AiExtractResultBody } from "./ai-extract-worker-panel";

const ZIP = extractionOutputName("invoice.pdf");

// 4000 ms: the button sits behind a lazy chunk (ai-result-views) and a
// JSZip read; the slowest CI run of this file's first test, package
// building included, was 387 ms (run 44331878323, ci-durations.tsv, 12
// passing runs of 11-18), so > 10x; and it stays under the 5 s test
// timeout, so a missing button fails with the role message.
const CSV_WAIT = { timeout: 4_000 } as const;

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
      await screen.findByRole("button", { name: "Download CSV" }, CSV_WAIT),
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

  it("a 128-character name never lands in a label that cannot wrap", async () => {
    // buttonVariants is whitespace-nowrap: a filename inside the CSV button
    // spills out of a phone-width card. The ZIP button (DownloadCta) wraps.
    const longZip = extractionOutputName(
      `${"Quarterly-financial-report-2026-final-".repeat(4)}.pdf`,
    );
    expect(longZip.length).toBe(MAX_DISPLAY_FILENAME_LENGTH);
    const stem = longZip.replace(/-extraction\.zip$/, "");
    const { container } = render(
      <AiExtractResultBody
        output={await realPackage({ invoice_number: "INV-7", total: 120.5 })}
        filename={longZip}
      />,
    );
    await screen.findByRole("button", { name: "Download CSV" }, CSV_WAIT);
    const nowrap = [...container.querySelectorAll<HTMLElement>("*")].filter(
      (el) => /(^|\s)whitespace-nowrap(\s|$)/.test(el.className),
    );
    // Health check: the scan sees the CSV button it is meant to judge.
    expect(nowrap.length).toBeGreaterThanOrEqual(1);
    for (const el of nowrap) expect(el.textContent).not.toContain(stem);
    // Positive control: the name IS on the page, on the button that wraps.
    expect(
      screen.getByRole("button", { name: `Download ${longZip}` }).className,
    ).not.toMatch(/whitespace-nowrap/);
  });

  /**
   * The read the body starts on mount, run again by the test on the same
   * bytes, AFTER the body's: the body's import and read were queued first,
   * so they settle first — through any macrotask a future read adds, since
   * the test's copy waits on the same one queued behind it. One act flush
   * then draws what the body read. A FIFO barrier, not a sleep: until
   * 2026-11-21 a 20 ms sleep stood here, blind whenever the read took one
   * macrotask longer (or the test ran alone, cold).
   */
  async function afterTheBodysRead(bytes: Uint8Array) {
    const views = await import("./ai-result-views");
    const read = await views.readExtraction(bytes);
    await act(async () => {});
    return read;
  }

  it("bytes with no extraction.json offer the ZIP only, and no CSV", async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    render(<AiExtractResultBody output={bytes} filename={ZIP} />);
    screen.getByRole("button", { name: `Download ${ZIP}` });
    const read = await afterTheBodysRead(bytes);
    expect(screen.queryByRole("button", { name: /Download CSV/ })).toBeNull();
    // Health: the read really found nothing, so no CSV is the answer.
    expect(read).toBeNull();
  });

  it("control: after the same barrier, a readable package's CSV is already drawn", async () => {
    // The barrier is long enough: with no wait of its own after it, the
    // body has read a real package and drawn its one CSV button.
    const bytes = await realPackage({ invoice_number: "INV-7", total: 120.5 });
    render(<AiExtractResultBody output={bytes} filename={ZIP} />);
    expect(await afterTheBodysRead(bytes)).not.toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Download CSV" }),
    ).toHaveLength(1);
  });
});

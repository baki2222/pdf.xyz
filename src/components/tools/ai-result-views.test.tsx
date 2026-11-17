// @vitest-environment jsdom
/**
 * AI results ON THE PAGE (competitor audit #4 and #16, 2026-11-17).
 *
 * AI Data Extraction: the result body is driven with a package built by the
 * REAL engine, through the lazy chunk and the one package reader, and every
 * output is read back where a reader receives it: the clipboard's text, the
 * saved Blob's bytes (the XLSX decoded by the workbook reader), the DOM.
 * Chat with PDF's conversation builders and the capped long-text box are
 * held to literal expectations here; the panels' own tests drive them.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import JSZip from "jszip";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { extractionOutputName } from "@/lib/jobs/ai-extract";
import type { ExtractOptions } from "@/lib/jobs/ai-extract";
import { runAiExtract } from "@/lib/workers/ai-extract/engine";
import { readWorkbookSheets } from "@/lib/workers/ooxml/workbook-read";
import { AiExtractResultBody } from "./ai-extract-worker-panel";
import { AI_RESULT_CHUNK } from "./ai-result-chunk";
import { PAGE_ROW_LIMIT, PAGE_TEXT_LIMIT } from "./ai-result-limits";
import {
  LongText,
  conversationFileName,
  conversationMarkdown,
  conversationText,
  cutForPage,
  type ConversationEntry,
} from "./ai-result-views";

const ZIP = extractionOutputName("invoice.pdf");
const HTML_VALUE = '<img src=x onerror="alert(1)">';
const FORMULA = '=HYPERLINK("http://x.test","click")';

async function realPackage(
  reply: unknown,
  options: ExtractOptions,
): Promise<Uint8Array> {
  const text = "Invoice INV-7, total 120.50.";
  const extracted: ExtractedPdfText = {
    pageCount: 1,
    pages: [],
    text,
    characterCount: text.length,
    hasText: true,
  };
  const run = await runAiExtract(new Uint8Array([1, 2, 3]), options, {
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
  });
  if (!run.ok) throw new Error(`engine refused the fixture: ${run.kind}`);
  return run.output;
}

const SCHEMA: ExtractOptions = {
  mode: "schema",
  schema: [
    { name: "invoice_number", type: "string" },
    { name: "total", type: "number" },
    { name: "note", type: "string" },
    { name: "link", type: "string" },
  ],
};
const PROMPT: ExtractOptions = {
  mode: "prompt",
  prompt: "List every line item.",
};

function stubClipboard() {
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

function catchDownloads() {
  const saved: { name: string; blob: Blob }[] = [];
  let last: Blob | null = null;
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    last = blob as Blob;
    return "blob:test";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ name: this.download, blob: last! });
  });
  return saved;
}

async function extractionJsonOf(output: Uint8Array): Promise<unknown> {
  const zip = await JSZip.loadAsync(output);
  return JSON.parse(await zip.file("extraction.json")!.async("string"));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AI Data Extraction shows the extracted data on the page", () => {
  const reply = {
    invoice_number: "INV-7",
    total: 120.5,
    note: HTML_VALUE,
    link: FORMULA,
  };

  it("one record reads as an accessible Field | Value table, every value as text", async () => {
    const { container } = render(
      <AiExtractResultBody
        output={await realPackage(reply, SCHEMA)}
        filename={ZIP}
      />,
    );
    const table = await screen.findByRole("table");
    expect(within(table).getByText("The fields the AI extracted").tagName).toBe(
      "CAPTION",
    );
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Field", "Value"]);
    expect(
      within(table)
        .getAllByRole("rowheader")
        .map((th) => th.textContent),
    ).toEqual(["invoice_number", "total", "note", "link"]);
    // The markup a PDF can carry is drawn as characters, never parsed.
    expect(container.querySelector("img")).toBeNull();
    // Positive control: that value IS on the page, as its own text.
    expect(within(table).getByText(HTML_VALUE).tagName).toBe("TD");
    // The region scrolls and is named; the chunk is the lazy one.
    const region = screen.getByRole("region", { name: "Extracted data" });
    expect(region).toHaveAttribute("data-chunk", AI_RESULT_CHUNK);
    expect(region).toHaveAttribute("tabindex", "0");
    expect(screen.queryByText(/^Showing the first/)).toBeNull();
  });

  it("Copy as table copies tab-separated rows with the formula neutralised; Copy JSON copies extraction.json", async () => {
    const writeText = stubClipboard();
    const output = await realPackage(reply, SCHEMA);
    render(<AiExtractResultBody output={output} filename={ZIP} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Copy as table" }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]![0]).toBe(
      [
        "invoice_number\ttotal\tnote\tlink",
        `INV-7\t120.5\t"${HTML_VALUE.replace(/"/g, '""')}"\t"'${FORMULA.replace(/"/g, '""')}"`,
      ].join("\r\n"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    const copied = writeText.mock.calls[1]![0];
    expect(JSON.parse(copied)).toEqual(await extractionJsonOf(output));
    expect(copied).toBe(
      JSON.stringify(await extractionJsonOf(output), null, 2),
    );
  });

  it("Download XLSX saves a workbook of the same rows, the formula stored as text", async () => {
    const saved = catchDownloads();
    render(
      <AiExtractResultBody
        output={await realPackage(reply, SCHEMA)}
        filename={ZIP}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Download XLSX" }),
    );
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toBe("invoice-extraction.xlsx");
    expect(saved[0]!.blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const bytes = new Uint8Array(await saved[0]!.blob.arrayBuffer());
    const [sheet] = await readWorkbookSheets(bytes);
    expect(sheet!.name).toBe("Extraction");
    const rows = sheet!.sheet.rows.map((r) => r.cells.map((c) => c.value));
    expect(rows).toEqual([
      ["invoice_number", "total", "note", "link"],
      ["INV-7", "120.5", HTML_VALUE, FORMULA],
    ]);
    const link = sheet!.sheet.rows[1]!.cells[3]!;
    expect(link.type).toBe("text");
    // Positive control: the total IS a number cell, so "text" above is a
    // reading of the cell, not the reader's only answer.
    expect(sheet!.sheet.rows[1]!.cells[1]!.type).toBe("number");
  });

  it(`a long list draws ${PAGE_ROW_LIMIT} rows and says so; the copy and the workbook hold all of them`, async () => {
    const writeText = stubClipboard();
    const saved = catchDownloads();
    const items = Array.from({ length: 250 }, (_, i) => ({
      line: i + 1,
      item: `Item ${i + 1}`,
    }));
    render(
      <AiExtractResultBody
        output={await realPackage(items, PROMPT)}
        filename={ZIP}
      />,
    );
    const table = await screen.findByRole("table");
    const body = table.querySelector("tbody")!;
    expect(body.querySelectorAll("tr")).toHaveLength(PAGE_ROW_LIMIT);
    expect(within(table).queryByText("Item 101")).toBeNull();
    // Positive control: the last row drawn is there.
    expect(within(table).getByText("Item 100")).toBeTruthy();
    expect(
      screen.getByText(
        "Showing the first 100 of 250 rows. Copying or downloading gives you all of it.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy as table" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const lines = writeText.mock.calls[0]![0].split("\r\n");
    expect(lines).toHaveLength(251);
    expect(lines.at(-1)).toBe("250\tItem 250");

    fireEvent.click(screen.getByRole("button", { name: "Download XLSX" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const [sheet] = await readWorkbookSheets(
      new Uint8Array(await saved[0]!.blob.arrayBuffer()),
    );
    expect(sheet!.sheet.rows).toHaveLength(251);
  });

  it("a list of records draws keys and values as text too", async () => {
    // Found by mutation (2026-11-17): only the one-record layout held markup
    // to text, so a list's cells could have been parsed as HTML unseen.
    const KEY = "<i>vendor</i>";
    const { container } = render(
      <AiExtractResultBody
        output={await realPackage(
          [
            { [KEY]: HTML_VALUE, total: "1" },
            { [KEY]: "Acme", total: "2" },
          ],
          PROMPT,
        )}
        filename={ZIP}
      />,
    );
    const table = await screen.findByRole("table");
    expect(
      within(table).getByText("The records the AI extracted, one per row")
        .tagName,
    ).toBe("CAPTION");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual([KEY, "total"]);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("i")).toBeNull();
    // Positive control: both are on the page, as text in their cells.
    expect(within(table).getByText(HTML_VALUE).tagName).toBe("TD");
    expect(within(table).getByText(KEY).tagName).toBe("TH");
  });

  it("data with no table shape offers Copy JSON and the ZIP, and no table", async () => {
    stubClipboard();
    render(
      <AiExtractResultBody
        output={await realPackage(["INV-7", "INV-8"], PROMPT)}
        filename={ZIP}
      />,
    );
    await screen.findByRole("button", { name: "Copy JSON" });
    expect(screen.queryByRole("table")).toBeNull();
    for (const name of ["Copy as table", "Download XLSX", "Download CSV"])
      expect(screen.queryByRole("button", { name })).toBeNull();
    expect(
      screen.getByRole("button", { name: `Download ${ZIP}` }),
    ).toBeTruthy();
  });
});

describe("the capped long-text box", () => {
  const ASTRAL = String.fromCodePoint(0x1f600);

  it("never ends inside a surrogate pair", () => {
    const text = `${"a".repeat(PAGE_TEXT_LIMIT - 1)}${ASTRAL}tail`;
    const { shown, cut } = cutForPage(text);
    expect(cut).toBe(true);
    expect(shown).toBe("a".repeat(PAGE_TEXT_LIMIT - 1));
    // Positive control: a pair that fits whole is kept whole.
    const fits = `${"a".repeat(PAGE_TEXT_LIMIT - 2)}${ASTRAL}tail`;
    expect(cutForPage(fits).shown.endsWith(ASTRAL)).toBe(true);
    // At the limit exactly nothing is cut.
    expect(cutForPage("b".repeat(PAGE_TEXT_LIMIT)).cut).toBe(false);
  });

  it("counts the note in characters a reader sees, not UTF-16 units", () => {
    // 60,000 emoji: 120,000 UTF-16 units, 60,000 characters.
    const text = ASTRAL.repeat(60_000);
    render(<LongText text={text} className="" />);
    expect(
      screen.getByText(
        "Only the first 25,000 of 60,000 characters are shown here. Copying or downloading gives you all of it.",
      ),
    ).toBeTruthy();
  });
});

describe("Chat with PDF's conversation, built in the page", () => {
  const ENTRIES: ConversationEntry[] = [
    {
      question: "What is the total?",
      answer: "The total is $1,240.00 [p.1], with tax on [pp. 2-3].",
      filename: "invoice-answer.zip",
      pageCount: 3,
    },
    {
      question: "Who signed it?",
      answer: null,
      filename: "invoice-answer.zip",
      pageCount: 3,
    },
    {
      question: "And the date?",
      answer: "30 June 2026 [p.9].",
      filename: "invoice-answer.zip",
      pageCount: null,
    },
  ];

  it("Copy conversation's text: questions, answers and cited pages", () => {
    expect(conversationText(ENTRIES)).toBe(
      [
        "Q: What is the total?",
        "",
        "A: The total is $1,240.00 [p.1], with tax on [pp. 2-3].",
        "Cited pages: [p.1], [p.2], [p.3]",
        "",
        "Q: Who signed it?",
        "",
        "A: This answer could not be read here. It is in invoice-answer.zip.",
        "",
        "Q: And the date?",
        "",
        "A: 30 June 2026 [p.9].",
      ].join("\n"),
    );
  });

  it("the Markdown download and its name", () => {
    expect(conversationFileName(ENTRIES)).toBe("invoice-conversation.md");
    expect(conversationMarkdown(ENTRIES)).toBe(
      [
        "# Chat with PDF: invoice",
        "## Question 1",
        "What is the total?",
        "**Answer**",
        "The total is $1,240.00 [p.1], with tax on [pp. 2-3].",
        "Cited pages: [p.1], [p.2], [p.3]",
        "## Question 2",
        "Who signed it?",
        "**Answer**",
        "This answer could not be read here. It is in invoice-answer.zip.",
        "## Question 3",
        "And the date?",
        "**Answer**",
        "30 June 2026 [p.9].",
      ].join("\n\n") + "\n",
    );
  });
});

/**
 * The views are a LAZY chunk: every source that uses them reaches them
 * through `import()`, and none imports them statically (a static import
 * would put them in that page's first load; `lazy-chunks.test.ts` holds the
 * same on the build). The importers are DISCOVERED by walking `src`, and
 * compared with the four results the chunk was made for, both ways.
 */
describe("the AI result views are only ever imported lazily", () => {
  function sources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) sources(full, out);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test."))
        out.push(full);
    }
    return out;
  }

  it("dynamic importers are the four results, and no source imports it statically", () => {
    const root = path.join(process.cwd(), "src");
    const files = sources(root);
    // Health check: the walk saw the codebase, not a corner of it.
    expect(files.length).toBeGreaterThan(500);
    const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");
    const lazy: string[] = [];
    const eager: string[] = [];
    for (const file of files) {
      // The views module itself names its import() in its docblock.
      if (rel(file) === "components/tools/ai-result-views.tsx") continue;
      const text = readFileSync(file, "utf8");
      if (
        /import\(\s*["'][./]+(?:[\w-]+\/)*ai-result-views["']\s*\)/.test(text)
      )
        lazy.push(rel(file));
      // A value import; `import type` and `typeof import()` are erased.
      if (
        /^import\s+(?!type\b)[^;]*?from\s+["'][^"']*ai-result-views["']/m.test(
          text,
        )
      )
        eager.push(rel(file));
    }
    expect(eager).toEqual([]);
    expect(lazy.sort()).toEqual(
      [
        "components/tools/ai-extract-worker-panel.tsx",
        "components/tools/chat-with-pdf-worker-panel.tsx",
        "components/tools/runner/pdf-to-text-runner.tsx",
        "components/tools/summarize-worker-panel.tsx",
      ].sort(),
    );
  });

  it("positive control: the static-import pattern catches a static import", () => {
    const pattern =
      /^import\s+(?!type\b)[^;]*?from\s+["'][^"']*ai-result-views["']/m;
    expect(pattern.test('import { LongText } from "./ai-result-views";')).toBe(
      true,
    );
    expect(pattern.test('import type { X } from "./ai-result-views";')).toBe(
      false,
    );
  });
});

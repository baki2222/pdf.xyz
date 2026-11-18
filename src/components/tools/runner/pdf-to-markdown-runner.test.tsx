// @vitest-environment jsdom
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { resetAnnouncer } from "@/components/a11y/live-region";
import {
  DEFAULT_PAGE_HEADINGS,
  DEFAULT_REMOVE_REPEATED_LINES,
} from "@/lib/pdf/pdf-to-markdown";
import * as reader from "@/lib/pdf/pdf-to-markdown-read";
import { PdfToMarkdownEditor } from "./pdf-to-markdown-runner";

/**
 * The two Options checkboxes reach the converter. Until the review of
 * pdf-to-markdown#5/#6 nothing checked that path: the converter's tests
 * proved each option works, and a source-string `toContain` in
 * tool-faq-substance matched the runner's text, so replacing
 * `removeRepeatedLines,` with `removeRepeatedLines: true,` in the call kept
 * 1980 tests green while unticking the box did nothing.
 */

// A spy on the module's own export, not `vi.mock`: under `isolate: false`
// a mock would leave this runner cached bound to the stub for every later
// file that imports it (src/tests/mock-isolation.test.ts). The spy is
// restored after the file, so the shared instance is the real one again.
const convert = vi
  .spyOn(reader, "pdfToMarkdown")
  .mockImplementation(() => new Promise<never>(() => {}));

afterEach(() => {
  cleanup();
  resetAnnouncer();
  convert.mockClear();
});

afterAll(() => {
  convert.mockRestore();
});

const REPEATED = "Leave out repeated headers and footers";
const HEADINGS = "Start each page with a Page heading";

function renderEditor(pageCount: number) {
  const bytes = new Uint8Array([37, 80, 68, 70]);
  render(
    <PdfToMarkdownEditor
      pdf={{
        file: new File([bytes], "report.pdf", { type: "application/pdf" }),
        bytes,
        pageCount,
        rotations: Array.from({ length: pageCount }, () => 0 as const),
        digitalSignatures: 0,
      }}
      onReset={() => {}}
    />,
  );
}

/** The options the converter was called with, after pressing Run once. */
function runAndReadOptions() {
  fireEvent.click(screen.getByRole("button", { name: /Create Markdown/ }));
  expect(convert).toHaveBeenCalledTimes(1);
  return convert.mock.calls[0]![1] as {
    sourceName: string;
    removeRepeatedLines: boolean;
    includePageHeadings: boolean;
  };
}

describe("PDF to Markdown's options reach the converter", () => {
  it("with no clicks, both options are on, as the defaults say", () => {
    // Health: the defaults this test assumes are the shipped ones.
    expect(DEFAULT_REMOVE_REPEATED_LINES).toBe(true);
    expect(DEFAULT_PAGE_HEADINGS).toBe(true);
    renderEditor(3);
    expect(
      screen.getByRole("checkbox", { name: new RegExp(REPEATED) }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: new RegExp(HEADINGS) }),
    ).toBeChecked();
    const options = runAndReadOptions();
    expect(options.sourceName).toBe("report.pdf");
    expect(options.removeRepeatedLines).toBe(true);
    expect(options.includePageHeadings).toBe(true);
  });

  it("unticking “Leave out repeated headers and footers” passes removeRepeatedLines: false", () => {
    renderEditor(3);
    fireEvent.click(
      screen.getByRole("checkbox", { name: new RegExp(REPEATED) }),
    );
    const options = runAndReadOptions();
    expect(options.removeRepeatedLines).toBe(false);
    expect(options.includePageHeadings).toBe(true);
  });

  it("unticking “Start each page with a Page heading” passes includePageHeadings: false", () => {
    renderEditor(3);
    fireEvent.click(
      screen.getByRole("checkbox", { name: new RegExp(HEADINGS) }),
    );
    const options = runAndReadOptions();
    expect(options.includePageHeadings).toBe(false);
    expect(options.removeRepeatedLines).toBe(true);
  });

  it("a 1-page PDF shows no page-heading box, and still offers the header option", () => {
    renderEditor(1);
    expect(
      screen.queryByRole("checkbox", { name: new RegExp(HEADINGS) }),
    ).toBeNull();
    expect(
      screen.getByRole("checkbox", { name: new RegExp(REPEATED) }),
    ).toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });
});

/**
 * The Markdown preview scrolls (max-h-72 overflow-auto), so a keyboard must
 * be able to reach it, and a screen reader must hear what it is. Until
 * 2026-11-18 it was a bare <div>: axe scrollable-region-focusable on the
 * live result, the sibling PDF to Text had been fixed a day earlier.
 */
describe("PDF to Markdown's preview", () => {
  it("is a named region a keyboard can reach", async () => {
    const markdown = "# Page 1\n\nHello\n\n# Page 2\n\nWorld\n";
    convert.mockImplementationOnce(async () => ({
      markdown,
      pageCount: 2,
      characterCount: markdown.length,
      hasMarkdown: true,
      linkCount: 0,
      tableCount: 0,
      removedLineCount: 0,
    }));
    renderEditor(2);
    fireEvent.click(screen.getByRole("button", { name: /Create Markdown/ }));
    const preview = await screen.findByRole("region", {
      name: "Markdown preview",
    });
    expect(preview).toHaveAttribute("tabindex", "0");
    expect(preview.className).toMatch(/\boverflow-auto\b/);
    // Positive control: the region IS the box showing the Markdown.
    expect(preview.textContent).toBe(markdown);
  });
});

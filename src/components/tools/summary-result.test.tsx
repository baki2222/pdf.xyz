// @vitest-environment jsdom
/**
 * Summarize PDF shows the summary ON THE PAGE (audit summarize-pdf#1).
 *
 * Until 2026-11-07 the result card held a ready sentence and one button for
 * the ZIP: to read a few paragraphs a user had to download, unzip and open
 * summary.md — on a phone, close to impossible — while the catalogue listed
 * TXT and MD as outputs nobody could save on their own.
 *
 * The package here is made by the REAL engine (`runSummarize` with a fixed
 * provider), not by a hand-built ZIP, so the chain under test is the one a
 * reader gets: worker package -> bytes in the page -> what the card shows.
 * A hand-built ZIP would certify entry names the worker does not write.
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
import JSZip from "jszip";
import { runSummarize } from "@/lib/workers/summarize/engine";
import { SUMMARY_PACKAGE_FILES } from "@/lib/workers/summarize-package";
import { summaryOutputName } from "@/lib/jobs/summarize-pdf";
import { MAX_DISPLAY_FILENAME_LENGTH } from "@/lib/jobs/filenames";
import { COPY_STATUS } from "./copy-text-button";
import { SummaryResultBody } from "./summarize-worker-panel";
import { PAGE_TEXT_LIMIT } from "./ai-result-limits";

const SUMMARY =
  "The lease runs for three years.\n\n- Rent is due on the first.\n- Notice is ninety days.";
/** SUMMARY as the box draws it: formatted, so the `- ` marks are gone. */
const SHOWN =
  "The lease runs for three years.Rent is due on the first.Notice is ninety days.";

async function realPackage(summary = SUMMARY): Promise<Uint8Array> {
  const text = "A long lease agreement with plenty of selectable text in it.";
  const extracted: ExtractedPdfText = {
    pageCount: 2,
    pages: [],
    text,
    characterCount: text.length,
    hasText: true,
  };
  const run = await runSummarize(
    new Uint8Array([1, 2, 3]),
    { length: "standard", format: "bullets" },
    {
      extract: async () => extracted,
      provider: {
        id: "anthropic",
        model: "claude-sonnet-5",
        async complete() {
          return {
            ok: true,
            text: summary,
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

const ZIP = summaryOutputName("lease.pdf");

/** Every download the page starts: the Blob handed to the URL, and the name. */
function catchDownloads(): { blobs: Blob[]; names: string[] } {
  const blobs: Blob[] = [];
  const names: string[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return "blob:test";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
  return { blobs, names };
}

/** An entry of the package as the WORKER wrote it, read independently. */
async function entry(pkg: Uint8Array, name: string): Promise<string> {
  const file = (await JSZip.loadAsync(pkg)).file(name);
  if (!file) throw new Error(`the engine's package has no ${name}`);
  return file.async("string");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The card's `data-summary-read`: pending, shown or unavailable. */
const readState = (container: HTMLElement) =>
  container
    .querySelector("[data-summary-read]")
    ?.getAttribute("data-summary-read");

describe("Summarize PDF result — the summary is on the page", () => {
  it("shows the model's summary text, read from the worker's own package", async () => {
    const { container } = render(
      <SummaryResultBody output={await realPackage()} filename={ZIP} />,
    );
    const region = await screen.findByRole("region", { name: "Summary" });
    // The other value of the read's vocabulary (the fallback test waits on
    // "unavailable"): both directions are exercised.
    expect(readState(container)).toBe("shown");
    // Health check: the region holds THE summary, not merely some text.
    // INVERTED 2026-11-17 (competitor audit #4): this asserted
    // `textContent === SUMMARY`, the Markdown source, which pinned the defect
    // (the reader saw the model's `- ` marks). The summary is now drawn
    // formatted: its paragraph, then its two points as a list.
    expect(region.textContent).toBe(SHOWN);
    expect([...region.querySelectorAll("p")].map((p) => p.textContent)).toEqual(
      ["The lease runs for three years."],
    );
    expect(
      [...region.querySelectorAll("ul > li")].map((li) => li.textContent),
    ).toEqual(["Rent is due on the first.", "Notice is ninety days."]);
    expect(screen.getByText(/read it below/)).toBeTruthy();
  });

  it("Copy summary copies the Markdown source, marks and all", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<SummaryResultBody output={await realPackage()} filename={ZIP} />);
    await screen.findByRole("region", { name: "Summary" });
    fireEvent.click(screen.getByRole("button", { name: "Copy summary" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]![0]).toBe(SUMMARY);
    // Positive control: the source is not what the box shows.
    expect(SUMMARY).not.toBe(SHOWN);
  });

  it("offers Copy, .txt, .md and the full ZIP, each by a visible name", async () => {
    render(<SummaryResultBody output={await realPackage()} filename={ZIP} />);
    await screen.findByRole("region", { name: "Summary" });
    expect(screen.getByRole("button", { name: "Copy summary" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download TXT" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Download Markdown" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: `Download ${ZIP}` }),
    ).toBeTruthy();
  });

  it("Download TXT saves exactly the summary as lease-summary.txt", async () => {
    const { blobs, names } = catchDownloads();
    render(<SummaryResultBody output={await realPackage()} filename={ZIP} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /^Download TXT/ }),
    );
    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(names).toEqual(["lease-summary.txt"]);
    expect(blobs[0]!.type).toBe("text/plain;charset=utf-8");
    expect(await blobs[0]!.text()).toBe(SUMMARY);
  });

  it("Download Markdown saves the engine's summary.md, header included, as lease-summary.md", async () => {
    const pkg = await realPackage();
    const markdown = await entry(pkg, SUMMARY_PACKAGE_FILES.markdown);
    // Health check: the Markdown is NOT the bare summary, so a swap with the
    // TXT cannot pass by coincidence.
    expect(markdown).not.toBe(SUMMARY);
    expect(markdown).toContain(SUMMARY);
    const { blobs, names } = catchDownloads();
    render(<SummaryResultBody output={pkg} filename={ZIP} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /^Download Markdown/ }),
    );
    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(names).toEqual(["lease-summary.md"]);
    expect(blobs[0]!.type).toBe("text/markdown;charset=utf-8");
    expect(await blobs[0]!.text()).toBe(markdown);
  });

  it("the two downloads differ: TXT is the bare summary, Markdown carries the header", async () => {
    const { blobs, names } = catchDownloads();
    render(<SummaryResultBody output={await realPackage()} filename={ZIP} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /^Download TXT/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Download Markdown/ }));
    await waitFor(() => expect(blobs).toHaveLength(2));
    expect(names).toEqual(["lease-summary.txt", "lease-summary.md"]);
    const [txt, md] = await Promise.all(blobs.map((b) => b.text()));
    expect(txt).not.toBe(md);
  });

  it("a new result never shows the previous summary, then shows its own", async () => {
    const OTHER = "The invoice totals 120 and is due in thirty days.";
    const [first, second] = await Promise.all([
      realPackage(),
      realPackage(OTHER),
    ]);
    const { rerender } = render(
      <SummaryResultBody output={first} filename={ZIP} />,
    );
    const region = await screen.findByRole("region", { name: "Summary" });
    expect(region.textContent).toBe(SHOWN);
    rerender(<SummaryResultBody output={second} filename={ZIP} />);
    // Synchronously after the new bytes arrive: the old summary is gone.
    expect(screen.queryByText(/three years/)).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Summary" }).textContent).toBe(
        OTHER,
      ),
    );
    expect(screen.queryByText(/three years/)).toBeNull();
  });

  it("a 128-character name never lands in a label that cannot wrap", async () => {
    // A phone column is ~343px; a button styled by buttonVariants is
    // whitespace-nowrap, so a filename inside it spills out of the card. The
    // property: no non-wrapping element carries the file's name, whatever its
    // length. The ZIP button (DownloadCta) wraps, and names the file.
    const longZip = summaryOutputName(
      `${"Quarterly-financial-report-2026-final-".repeat(4)}.pdf`,
    );
    expect(longZip.length).toBe(MAX_DISPLAY_FILENAME_LENGTH);
    const stem = longZip.replace(/-summary\.zip$/, "");
    const { container } = render(
      <SummaryResultBody output={await realPackage()} filename={longZip} />,
    );
    await screen.findByRole("region", { name: "Summary" });
    expect(screen.getByRole("button", { name: "Download TXT" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Download Markdown" }),
    ).toBeTruthy();
    const nowrap = [...container.querySelectorAll<HTMLElement>("*")].filter(
      (el) => /(^|\s)whitespace-nowrap(\s|$)/.test(el.className),
    );
    // Health check: the scan sees the file buttons it is meant to judge.
    expect(nowrap.length).toBeGreaterThanOrEqual(2);
    for (const el of nowrap) expect(el.textContent).not.toContain(stem);
    // Positive control: the name IS on the page, on the button that wraps.
    expect(
      screen.getByRole("button", { name: `Download ${longZip}` }).className,
    ).not.toMatch(/whitespace-nowrap/);
  });

  it("Copy puts exactly the summary on the clipboard and says so", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<SummaryResultBody output={await realPackage()} filename={ZIP} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Copy summary" }),
    );
    await waitFor(() =>
      expect(screen.getByText(COPY_STATUS.copied)).toBeTruthy(),
    );
    expect(writeText).toHaveBeenCalledWith(SUMMARY);
  });

  it("a browser that refuses the clipboard is told so, never 'Copied'", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("NotAllowedError");
        },
      },
      configurable: true,
    });
    render(<SummaryResultBody output={await realPackage()} filename={ZIP} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Copy summary" }),
    );
    await waitFor(() =>
      expect(screen.getByText(COPY_STATUS.failed)).toBeTruthy(),
    );
    expect(screen.queryByText(COPY_STATUS.copied)).toBeNull();
  });

  it("bytes that are not a summary package fall back to the ZIP alone, claiming no summary", async () => {
    const { container } = render(
      <SummaryResultBody output={new Uint8Array([9, 9, 9])} filename={ZIP} />,
    );
    // The ZIP button is there — from the first render, read or not, so it
    // says nothing about the read having settled.
    screen.getByRole("button", { name: `Download ${ZIP}` });
    // The read's own outcome, not a sleep: until 2026-11-21 a 20 ms tick
    // stood here, and a reader that claimed a summary 50 ms later stayed
    // green at any speed. 3000 ms: this file's slowest CI test, a real
    // package read included, took 316 ms (failed run 42669105530, the max
    // over 33 CI runs of 11-09..11-21; 310 ms among the 12 passing runs of
    // 11-18, run 44299285879), so > 9x; under the 5 s test timeout, so
    // the wait's own message wins.
    await waitFor(() => expect(readState(container)).toBe("unavailable"), {
      timeout: 3_000,
    });
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy summary" })).toBeNull();
    expect(screen.queryByText(/read it below/)).toBeNull();
  });
});

/**
 * Competitor audit #16 (2026-11-17): the Summary box draws at most
 * PAGE_TEXT_LIMIT characters; Copy summary and the TXT still carry all of it.
 */
describe("Summary box caps the page, never the copy", () => {
  it("a summary past the cap is cut in the box, said so, and copied and saved whole", async () => {
    const tail = "END-OF-THE-SUMMARY";
    const long = `${"word ".repeat(PAGE_TEXT_LIMIT / 4)}${tail}`;
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const pkg = await realPackage(long);
    const whole = await entry(pkg, SUMMARY_PACKAGE_FILES.text);
    // Health check: what the worker wrote is past the cap, tail and all.
    expect(whole.indexOf(tail)).toBeGreaterThan(PAGE_TEXT_LIMIT);
    const { blobs } = catchDownloads();
    render(<SummaryResultBody output={pkg} filename={ZIP} />);
    const box = await screen.findByRole("region", { name: "Summary" });
    expect(box.textContent!.length).toBe(PAGE_TEXT_LIMIT);
    expect(box.textContent).not.toContain(tail);
    expect(
      screen.getByText(
        /^Only the first 50,000 of [\d,]+ characters are shown here\./,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy summary" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]![0]).toContain(tail);
    fireEvent.click(screen.getByRole("button", { name: "Download TXT" }));
    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(await blobs[0]!.text()).toContain(tail);
  });
});

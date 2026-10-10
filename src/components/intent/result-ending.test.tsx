// @vitest-environment jsdom
/**
 * The end of a run, driven: the receipt re-opens and counts what was made,
 * says when the count disagrees, and does not count what it cannot; and
 * "Continue with" offers only what this output can open, carries it with its
 * provenance, and says so when it could not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { useEffect, type ReactElement } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PDFDocument } from "pdf-lib";
import {
  ToolRunProvider,
  useToolRun,
  type ToolRunInfo,
} from "@/components/tools/runner/tool-context";
import {
  __setHandoffStoreForTests,
  claimHandoff,
  HandoffStore,
  MemoryHandoffBackend,
} from "@/lib/handoff";
import { continueTargetsFor } from "@/lib/intent/next-steps";
import { outputFile } from "@/lib/intent/run-output";
import { MAX_PDF_BYTES } from "@/lib/pdf/files";
import { getToolBySlug, tools } from "@/lib/tools";
import { formatBytes } from "@/lib/utils";
import { ContinueWith } from "./continue-with";
import { OutputFacts } from "./output-facts";
import { TicketRail } from "./ticket-rail";

async function pdfOf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return doc.save();
}

function job(slug: string) {
  const tool = getToolBySlug(slug)!;
  const info: ToolRunInfo = {
    slug: tool.slug,
    name: tool.name,
    category: tool.category,
  };
  return { info, plan: continueTargetsFor(tool, tools) };
}

function onPage(
  slug: string,
  ui: ReactElement,
  push = vi.fn(),
): { push: ReturnType<typeof vi.fn> } {
  const { info, plan } = job(slug);
  render(
    <AppRouterContext.Provider
      value={{ push, replace: vi.fn(), prefetch: vi.fn() } as never}
    >
      <ToolRunProvider tool={info} plan={plan}>
        {ui}
      </ToolRunProvider>
    </AppRouterContext.Provider>,
  );
  return { push };
}

beforeEach(() => {
  __setHandoffStoreForTests(
    new HandoffStore({ backend: new MemoryHandoffBackend() }),
  );
});
afterEach(() => {
  cleanup();
  __setHandoffStoreForTests(null);
});

describe("the receipt", () => {
  it("re-opens the PDF and counts it: the figure and its proof", async () => {
    const bytes = await pdfOf(5);
    render(<OutputFacts output={outputFile(bytes, "merged.pdf")} />);
    expect(screen.getByText("counting…")).toBeTruthy();
    expect(
      await screen.findByText(
        /re-opened and counted in this browser: 5 pages\./i,
      ),
    ).toBeTruthy();
    expect(screen.getByText(formatBytes(bytes.byteLength))).toBeTruthy();
  });

  it("says so when the count is not what the tool meant to write", async () => {
    const bytes = await pdfOf(4);
    render(
      <OutputFacts
        output={outputFile(bytes, "merged.pdf")}
        expectedPages={5}
      />,
    );
    const warning = await screen.findByRole("status");
    expect(warning.textContent).toMatch(
      /expected 5 pages, counted 4 — check the file before you share it/i,
    );
  });

  it("POSITIVE CONTROL: no warning when the count agrees", async () => {
    const bytes = await pdfOf(5);
    render(
      <OutputFacts
        output={outputFile(bytes, "merged.pdf")}
        expectedPages={5}
      />,
    );
    await screen.findByText(/counted in this browser: 5 pages/i);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not re-open a file over the reader's ceiling, and says so", async () => {
    const big = {
      name: "huge.pdf",
      type: "application/pdf",
      size: MAX_PDF_BYTES + 1,
      bytes: async () => new Uint8Array(),
      file: () => new File([], "huge.pdf"),
    };
    render(<OutputFacts output={big} />);
    expect(
      await screen.findByText(
        `not re-counted (over ${formatBytes(MAX_PDF_BYTES, 0)})`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/re-opened and counted/i)).toBeNull();
  });

  it("an output that is not a PDF gets its type and size, and no count", () => {
    const text = new Blob(["hello"], { type: "text/plain" });
    render(<OutputFacts output={outputFile(text, "notes.txt")} />);
    expect(screen.getByText("TXT")).toBeTruthy();
    expect(screen.queryByText(/counting|counted/i)).toBeNull();
  });

  it("draws the optimize tools' before and after to one scale, and says it in words", async () => {
    const bytes = await pdfOf(1);
    render(
      <OutputFacts
        output={outputFile(bytes, "small.pdf")}
        inputBytes={bytes.byteLength * 4}
        optimize
      />,
    );
    const figure = document.querySelector("[data-size-compare]")!;
    const lines = figure.querySelectorAll<HTMLElement>("[data-dimension-line]");
    expect(lines).toHaveLength(2);
    expect(lines[0]!.style.width).toBe("100%");
    expect(lines[1]!.style.width).toBe("25%");
    expect(figure.textContent).toMatch(/75% smaller/);
    // The text equivalent, for a reader who does not see the lines.
    expect(figure.textContent).toContain(
      `${formatBytes(bytes.byteLength * 4)} to ${formatBytes(bytes.byteLength)}`,
    );
  });
});

describe("Continue with", () => {
  it("offers what the output opens, never the tool itself, at most four", async () => {
    const bytes = await pdfOf(2);
    onPage(
      "merge-pdf",
      <ContinueWith output={outputFile(bytes, "merged.pdf")} />,
    );
    const group = screen.getByRole("group", { name: "Continue with" });
    const links = within(group).getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(links.length).toBeLessThanOrEqual(4);
    // Named by its words: the tool, where it runs, and what it carries.
    expect(links[0]!.textContent).toMatch(
      /^Continue with Compress PDF.*carries merged\.pdf$/,
    );
    expect(links[0]!.getAttribute("href")).toBe("/tools/compress-pdf");
    expect(links.map((l) => l.getAttribute("href"))).not.toContain(
      "/tools/merge-pdf",
    );
  });

  it("carries the output, with its provenance and the job's trail", async () => {
    const bytes = await pdfOf(2);
    const { push } = onPage(
      "merge-pdf",
      <ContinueWith output={outputFile(bytes, "merged.pdf")} />,
    );
    const compress = screen.getByRole("link", { name: /compress pdf/i });
    await act(async () => {
      fireEvent.click(compress);
    });
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const href = push.mock.calls[0]![0] as string;
    expect(href).toMatch(/^\/tools\/compress-pdf\?handoff=/);
    const id = new URL(href, "http://x").searchParams.get("handoff")!;
    const record = await claimHandoff(id);
    expect(record?.files.map((f) => f.name)).toEqual(["merged.pdf"]);
    expect(record?.origin).toEqual({ kind: "result", fromSlug: "merge-pdf" });
    expect(record?.trail).toEqual(["merge-pdf"]);
  });

  it("a modified click is the browser's: no hand-off, the plain page", async () => {
    const bytes = await pdfOf(1);
    const { push } = onPage(
      "merge-pdf",
      <ContinueWith output={outputFile(bytes, "merged.pdf")} />,
    );
    const link = screen.getByRole("link", { name: /compress pdf/i });
    fireEvent.click(link, { ctrlKey: true });
    expect(push).not.toHaveBeenCalled();
  });

  it("several outputs go only to the tool that combines them", async () => {
    const [a, b] = await Promise.all([pdfOf(1), pdfOf(1)]);
    onPage(
      "compress-pdf",
      <ContinueWith
        output={[outputFile(a, "a-optimized.pdf"), outputFile(b, "b.pdf")]}
      />,
    );
    const links = within(
      screen.getByRole("group", { name: "Continue with" }),
    ).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/tools/merge-pdf",
    ]);
    expect(links[0]!.textContent).toMatch(/carries 2 files/);
  });

  it("an output only an inverse opens offers nothing", () => {
    const text = new Blob(["x"], { type: "text/plain" });
    onPage("pdf-to-text", <ContinueWith output={outputFile(text, "a.txt")} />);
    expect(screen.queryByRole("group", { name: "Continue with" })).toBeNull();
  });

  it("says so, with the plain link, when the browser will not store the file", async () => {
    __setHandoffStoreForTests(
      new HandoffStore({
        backend: {
          put: async () => {
            throw new Error("QuotaExceededError");
          },
          get: async () => undefined,
          delete: async () => {},
          getAll: async () => [],
          clear: async () => {},
        },
      }),
    );
    const bytes = await pdfOf(1);
    const { push } = onPage(
      "merge-pdf",
      <ContinueWith output={outputFile(bytes, "merged.pdf")} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: /compress pdf/i }));
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(
      /couldn't carry the file — this browser's storage is unavailable\. download it, then open compress pdf/i,
    );
    expect(
      within(alert).getByRole("link", { name: "Compress PDF" }),
    ).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});

/** A runner whose hand-off came from `trail`, and that may finish. */
function Arrived({ trail, done = false }: { trail: string[]; done?: boolean }) {
  const run = useToolRun();
  useEffect(() => {
    run?.arrived(trail);
    if (done) run?.finished(true);
    // Once, as a claim reports it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

describe("the job's steps", () => {
  it("draws nothing for a visit that did not continue from a result", () => {
    onPage("compress-pdf", <TicketRail />);
    expect(screen.queryByRole("navigation", { name: "Job steps" })).toBeNull();
  });

  it("names each step the files came through, ticked, then this one as current", () => {
    onPage(
      "page-numbers",
      <>
        <TicketRail />
        <Arrived trail={["merge-pdf", "compress-pdf"]} />
      </>,
    );
    const rail = screen.getByRole("navigation", { name: "Job steps" });
    const steps = within(rail).getAllByRole("listitem");
    expect(steps.map((s) => s.textContent)).toEqual([
      "Merge PDF (done)",
      "Compress PDF (done)",
      "Add Page Numbers",
    ]);
    expect(steps[2]!.getAttribute("aria-current")).toBe("step");
  });

  it("ticks this step too once its result is on screen", () => {
    onPage(
      "compress-pdf",
      <>
        <TicketRail />
        <Arrived trail={["merge-pdf"]} done />
      </>,
    );
    const current = screen
      .getByRole("navigation", { name: "Job steps" })
      .querySelector('[aria-current="step"]')!;
    expect(current.textContent).toBe("Compress PDF (done)");
  });

  it("Continue with does not offer a step the job already went through", async () => {
    const bytes = await pdfOf(1);
    onPage(
      "compress-pdf",
      <>
        <Arrived trail={["merge-pdf"]} />
        <ContinueWith output={outputFile(bytes, "merged-optimized.pdf")} />
      </>,
    );
    const hrefs = within(screen.getByRole("group", { name: "Continue with" }))
      .getAllByRole("link")
      .map((l) => l.getAttribute("href"));
    expect(hrefs).not.toContain("/tools/merge-pdf");
    expect(hrefs.length).toBeGreaterThanOrEqual(2);
  });
});

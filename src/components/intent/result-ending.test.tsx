// @vitest-environment jsdom
/**
 * The end of a run, driven: the receipt re-opens and counts what was made,
 * says when the count disagrees, and does not count what it cannot; and
 * "Continue with" offers only what this output can open, carries it with its
 * provenance, and says so when it could not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { useEffect, type ReactElement } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PDFDocument } from "pdf-lib";
import {
  ToolRunProvider,
  useToolRun,
  type ToolRunInfo,
} from "@/components/tools/runner/tool-context";
import { HandoffLoading } from "@/components/tools/runner/handoff-notice";
import {
  __setHandoffStoreForTests,
  claimHandoff,
  HandoffStore,
  MemoryHandoffBackend,
} from "@/lib/handoff";
import { HANDOFF_MAX_TOTAL_BYTES } from "@/lib/handoff/record";
import { continueTargetsFor, NO_CONTINUE } from "@/lib/intent/next-steps";
import { outputFile, type OutputFile } from "@/lib/intent/run-output";
import { MAX_PDF_BYTES } from "@/lib/pdf/files";
import { getToolBySlug, tools } from "@/lib/tools";
import { formatBytes } from "@/lib/utils";
import { ContinueWith } from "./continue-with";
import { CountMismatch, OutputFacts } from "./output-facts";
import { TicketRail } from "./ticket-rail";

/** An output of `size` bytes that is never read — sizes past what a test can allocate. */
function sized(name: string, size: number): OutputFile {
  return {
    name,
    type: "application/pdf",
    size,
    bytes: async () => new Uint8Array(),
    file: () => new File([], name, { type: "application/pdf" }),
  };
}

const MB = 1024 * 1024;

/** Text as a line reads: the ring between figure and words is a space each side. */
const flat = (text: string | null | undefined) =>
  text?.replace(/\s+/g, " ").trim();

/** The Pages fact's cell, and the state it shows now. */
const pagesCell = () =>
  document.querySelector<HTMLElement>("[data-receipt] [data-settles]");
const shown = () =>
  flat(
    pagesCell()?.querySelector<HTMLElement>(":scope > [data-current]")
      ?.textContent,
  );

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
  it("re-opens the PDF and counts it: ONE statement — the figure, its ring and its words", async () => {
    const bytes = await pdfOf(5);
    render(<OutputFacts output={outputFile(bytes, "merged.pdf")} />);
    expect(shown()).toBe("counting in this browser…");
    await waitFor(() =>
      expect(pagesCell()!.getAttribute("data-settles")).toBe("counted"),
    );
    // Heard as "5, re-opened and counted in this browser"; the ring between
    // is drawn, and hidden from assistive tech (its words are beside it).
    expect(shown()).toBe("5, re-opened and counted in this browser");
    const receipt = document.querySelector<HTMLElement>("[data-receipt]")!;
    // Once: not again in a line of its own, and the ring drawn once.
    expect(
      receipt.textContent!.match(/counted in this browser/gi),
    ).toHaveLength(1);
    expect(receipt.querySelectorAll("svg circle")).toHaveLength(1);
    expect(receipt.textContent).not.toMatch(/: 5 pages\./);
    expect(screen.getByText(formatBytes(bytes.byteLength))).toBeTruthy();
  });

  it("draws every state the count can settle to in one cell, from the first render", () => {
    // The cell is sized by the largest of them, so the count settling
    // repaints inside a box that was already its size (the e2e measures the
    // Download button not moving; this holds the structure that does it).
    render(
      <OutputFacts output={sized("merged.pdf", 4096)} expectedPages={5} />,
    );
    const cell = pagesCell()!;
    expect(cell.getAttribute("data-settles")).toBe("counting");
    const states = [...cell.children] as HTMLElement[];
    expect(states.map((s) => flat(s.textContent))).toEqual([
      "counting in this browser…",
      // Sized with the figure the runner expects, before it is counted.
      "5, re-opened and counted in this browser",
      "not re-counted",
    ]);
    for (const state of states) {
      expect(state.style.gridArea).toBe("1 / 1");
      const current = state.hasAttribute("data-current");
      expect(state.classList.contains("invisible")).toBe(!current);
      expect(state.getAttribute("aria-hidden")).toBe(current ? null : "true");
    }
    expect(states.filter((s) => s.hasAttribute("data-current"))).toHaveLength(
      1,
    );
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

  it("the result panel's split: the facts without the warning, the warning on its own — one count", async () => {
    const bytes = await pdfOf(4);
    const output = outputFile(bytes, "merged.pdf");
    render(
      <>
        <OutputFacts output={output} expectedPages={5} mismatch={false} />
        <hr data-download-row="" />
        <CountMismatch output={output} expectedPages={5} />
      </>,
    );
    const warning = await screen.findByRole("status");
    // Drawn where the panel puts it — after the Download row — and only once.
    expect(
      document
        .querySelector("[data-download-row]")!
        .compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(shown()).toBe("4, re-opened and counted in this browser");
  });

  it("POSITIVE CONTROL: no warning when the count agrees", async () => {
    const bytes = await pdfOf(5);
    render(
      <OutputFacts
        output={outputFile(bytes, "merged.pdf")}
        expectedPages={5}
      />,
    );
    await waitFor(() =>
      expect(shown()).toBe("5, re-opened and counted in this browser"),
    );
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
    // Known before anything is re-opened: said at once, and never changes.
    expect(
      screen.getByText(
        `not re-counted (over ${formatBytes(MAX_PDF_BYTES, 0)})`,
      ),
    ).toBeTruthy();
    expect(pagesCell()).toBeNull();
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

  /**
   * ONE FILE CARRIED: a tool that needs several (Merge PDF, `combines`)
   * comes after every tool that works on the one file, so it never takes a
   * row one of them would have had (2026-10-17). Until then a single-file
   * Compress offered "Remove pages, Add page numbers, Sign PDF, Merge PDF" —
   * a tool that opens with one file and asks for another, ahead of
   * Watermark, Organize, Split and Rotate (batch C review). Every tool page
   * whose plan has such a target is read, not a named few.
   */
  it("one file carried: a tool that combines several comes after every tool that opens the one file", async () => {
    const bytes = await pdfOf(1);
    const read: string[] = [];
    let mattered = 0;
    for (const tool of tools) {
      const { plan } = job(tool.slug);
      const first = plan.targets.findIndex((t) => t.combines);
      if (first < 0) continue;
      if (plan.targets.slice(first + 1).some((t) => !t.combines)) mattered++;
      onPage(tool.slug, <ContinueWith output={outputFile(bytes, "one.pdf")} />);
      const group = screen.queryByRole("group", { name: "Continue with" });
      const shown = group
        ? within(group)
            .getAllByRole("link")
            .map((l) => l.getAttribute("href")!.replace("/tools/", ""))
        : [];
      const combines = new Set(
        plan.targets.filter((t) => t.combines).map((t) => t.slug),
      );
      const at = shown.findIndex((slug) => combines.has(slug));
      read.push(`${tool.slug}: ${shown.join(" ")}`);
      if (at >= 0)
        expect(
          shown.slice(at).every((slug) => combines.has(slug)),
          `${tool.slug} offers ${shown.join(", ")}`,
        ).toBe(true);
      cleanup();
    }
    // Health: the plans this reads have a combining target ahead of a
    // one-file one — the case where its rank decides a row — and the set
    // is not implausibly small.
    expect(read.length, read.join("\n")).toBeGreaterThanOrEqual(10);
    expect(mattered, read.join("\n")).toBeGreaterThanOrEqual(3);
  });

  it("CONTROL: several files carried still go to the tool that combines them, first", async () => {
    const [a, b] = await Promise.all([pdfOf(1), pdfOf(1)]);
    onPage(
      "rotate-pdf",
      <ContinueWith
        output={[outputFile(a, "a-rotated.pdf"), outputFile(b, "b.pdf")]}
      />,
    );
    const links = within(
      screen.getByRole("group", { name: "Continue with" }),
    ).getAllByRole("link");
    expect(links[0]!.getAttribute("href")).toBe("/tools/merge-pdf");
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

  it("a file over the targets' ceiling is not offered to them, and the figure is said", () => {
    // A merge of two 60 MB PDFs: every PDF tool here opens 100 MB at most,
    // and each would refuse this on arrival.
    onPage(
      "merge-pdf",
      <ContinueWith output={sized("merged.pdf", 120 * MB)} />,
    );
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    const note = document.querySelector("[data-continue-refused]")!;
    expect(note.textContent).toMatch(
      new RegExp(
        `^Not offered: merged\\.pdf is ${formatBytes(120 * MB).replace(".", "\\.")} — .+ open files up to ${formatBytes(MAX_PDF_BYTES, 0)}\\. Download it to keep it\\.$`,
      ),
    );
    expect(note.textContent).not.toMatch(/storage/i);
  });

  it("CONTROL: the same output under the ceiling is offered as before", () => {
    onPage("merge-pdf", <ContinueWith output={sized("merged.pdf", 90 * MB)} />);
    const links = within(
      screen.getByRole("group", { name: "Continue with" }),
    ).getAllByRole("link");
    expect(links[0]!.getAttribute("href")).toBe("/tools/compress-pdf");
    expect(document.querySelector("[data-continue-refused]")).toBeNull();
  });

  it("past what one hand-off carries, nothing is offered — and the reason is the budget, not storage", () => {
    // A compress batch of four 80 MB PDFs: each fits Merge PDF's ceiling,
    // together they are over the 300 MB a hand-off carries, and the stash
    // would refuse them before storage was ever asked.
    const four = [1, 2, 3, 4].map((i) => sized(`part-${i}.pdf`, 80 * MB));
    onPage("compress-pdf", <ContinueWith output={four} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    const note = document.querySelector("[data-continue-refused]")!;
    expect(note.textContent).toBe(
      `At ${formatBytes(320 * MB)}, these files are more than the ${formatBytes(HANDOFF_MAX_TOTAL_BYTES, 0)} this browser carries from one tool to the next. Download them, then open them in the next tool.`,
    );
    expect(note.textContent).not.toMatch(/storage/i);
  });

  it("CONTROL: the same batch under the budget goes to Merge PDF", () => {
    const three = [1, 2, 3].map((i) => sized(`part-${i}.pdf`, 80 * MB));
    onPage("compress-pdf", <ContinueWith output={three} />);
    const links = within(
      screen.getByRole("group", { name: "Continue with" }),
    ).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/tools/merge-pdf",
    ]);
    expect(document.querySelector("[data-continue-refused]")).toBeNull();
  });

  it("after a tool whose output nothing here should open, the reason is said where the row would be", async () => {
    const bytes = await pdfOf(1);
    for (const slug of Object.keys(NO_CONTINUE)) {
      onPage(slug, <ContinueWith output={outputFile(bytes, "out.pdf")} />);
      const reason = document.querySelector("[data-no-continue]");
      expect(reason?.textContent, slug).toBe(NO_CONTINUE[slug]);
      expect(screen.queryByRole("group", { name: "Continue with" })).toBeNull();
      cleanup();
    }
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

  /**
   * INVERTED 2026-10-17. This was "holds its row while files are brought
   * over, before the job is known — and lets it go with them when there is
   * none": the row went WITH the block, in the same commit, on a hand-off
   * with no job. That commit moved the runner's stage back up 32 px, and the
   * browser counted it (a guide drop: 0.0303 at 390, PR #180 review). The
   * row now stays for the visit; the history is in `TicketRail`.
   */
  it("holds its row while files are brought over, before the job is known — and keeps it, empty, when there is none", () => {
    const { rerender } = render(
      <ToolRunProvider
        tool={job("compress-pdf").info}
        plan={job("compress-pdf").plan}
      >
        <TicketRail />
        <HandoffLoading />
      </ToolRunProvider>,
    );
    const slot = () => document.querySelector("[data-ticket-rail-slot]");
    // The block and the row arrive in one commit; the row is empty.
    expect(slot()).not.toBeNull();
    expect(slot()!.childElementCount).toBe(0);
    // The files came with no job (a home-page drop): the block goes, the
    // row stays where it is, empty.
    rerender(
      <ToolRunProvider
        tool={job("compress-pdf").info}
        plan={job("compress-pdf").plan}
      >
        <TicketRail />
      </ToolRunProvider>,
    );
    expect(slot()).not.toBeNull();
    expect(slot()!.childElementCount).toBe(0);
  });

  /** The address this page is at, for the two below; put back after. */
  function at(search: string) {
    const before = window.location.href;
    window.history.replaceState(null, "", `/tools/compress-pdf${search}`);
    return () => window.history.replaceState(null, "", before);
  }

  it("an address that carries a hand-off holds the row from the first commit, before the runner says anything", () => {
    const back = at("?handoff=h_0123456789abcdef");
    try {
      render(
        <ToolRunProvider
          tool={job("compress-pdf").info}
          plan={job("compress-pdf").plan}
        >
          <TicketRail />
        </ToolRunProvider>,
      );
      expect(document.querySelector("[data-ticket-rail-slot]")).not.toBeNull();
    } finally {
      back();
    }
  });

  it("CONTROL: an address with no hand-off holds nothing", () => {
    const back = at("?q=merge");
    try {
      render(
        <ToolRunProvider
          tool={job("compress-pdf").info}
          plan={job("compress-pdf").plan}
        >
          <TicketRail />
        </ToolRunProvider>,
      );
      expect(document.querySelector("[data-ticket-rail-slot]")).toBeNull();
    } finally {
      back();
    }
  });

  it("the job fills the held row, and the row stays when the block goes", () => {
    const { info, plan } = job("compress-pdf");
    const { rerender } = render(
      <ToolRunProvider tool={info} plan={plan}>
        <TicketRail />
        <HandoffLoading />
        <Arrived trail={["merge-pdf"]} />
      </ToolRunProvider>,
    );
    const rail = () =>
      document.querySelector("[data-ticket-rail-slot] [data-ticket-rail]");
    expect(rail()).not.toBeNull();
    rerender(
      <ToolRunProvider tool={info} plan={plan}>
        <TicketRail />
        <Arrived trail={["merge-pdf"]} />
      </ToolRunProvider>,
    );
    expect(rail()).not.toBeNull();
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

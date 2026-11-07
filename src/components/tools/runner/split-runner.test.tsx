// @vitest-environment jsdom
// @native-canvas
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import { SPLIT_MODE_LABEL } from "@/lib/pdf/offered-kinds";
import { SplitEditor } from "./split-runner";

afterEach(() => {
  cleanup();
  resetAnnouncer();
});

async function pdfWithPages(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage([300, 400]);
  return doc.save();
}

function loaded(bytes: Uint8Array, name: string, pageCount: number) {
  return {
    file: new File([new Uint8Array(bytes)], name, { type: "application/pdf" }),
    bytes,
    pageCount,
    rotations: Array.from({ length: pageCount }, () => 0 as const),
    digitalSignatures: countDigitalSignatures(bytes),
  };
}

/**
 * Audit #22 (2026-11-06): the "Pages per file" field coerced an empty value
 * back to 1 on every keystroke, so a person who pressed Backspace and typed 5
 * got 15 — and a split into far fewer files than they asked for. Typing is
 * simulated the way a browser reports it: each change carries the whole field.
 */
describe("Split PDF · Every N pages field", () => {
  it("can be cleared and retyped: Backspace then 5 means 5 pages per file", async () => {
    const source = await pdfWithPages(30);
    render(
      <SplitEditor pdf={loaded(source, "deck.pdf", 30)} onReset={() => {}} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: SPLIT_MODE_LABEL.everyN }),
    );
    const input = screen.getByRole("spinbutton", {
      name: /pages per file/i,
    }) as HTMLInputElement;
    expect(input.value).toBe("1");

    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    // An empty field names no split, so nothing runs on a guess.
    expect(screen.getByRole("button", { name: /split into/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    fireEvent.change(input, { target: { value: `${input.value}5` } });
    expect(input.value).toBe("5");
    expect(
      screen.getByRole("button", { name: /split into 6 files/i }),
    ).not.toHaveAttribute("aria-disabled");
  });

  it("refuses a value that names no split instead of guessing one", async () => {
    const source = await pdfWithPages(30);
    render(
      <SplitEditor pdf={loaded(source, "deck.pdf", 30)} onReset={() => {}} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: SPLIT_MODE_LABEL.everyN }),
    );
    const input = screen.getByRole("spinbutton", { name: /pages per file/i });
    fireEvent.change(input, { target: { value: "0" } });
    expect(screen.getByText(/whole number of pages/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /split into/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});

/**
 * Audit #46 (2026-11-06): the parts a person downloads carried the source
 * name raw, ':' and '?' included, while the ZIP itself was sanitised.
 */
describe("Split PDF · part names", () => {
  it("lists each part under a name every file system can hold", async () => {
    const source = await pdfWithPages(3);
    render(
      <SplitEditor
        pdf={loaded(source, "Q3: plan?.pdf", 3)}
        onReset={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: SPLIT_MODE_LABEL.perPage }),
    );
    expect(screen.getByText("Q3 plan-1-page-1.pdf")).toBeInTheDocument();
    // The header still names the source as it is; no PART carries it raw.
    expect(screen.queryByText(/^Q3: plan\?-/)).toBeNull();
  });
});

/**
 * Audit split-pdf#6 (2026-11-07): no way to separate a duplex scan's fronts
 * from its backs short of typing "1, 3, 5, …" with Merge ticked. The
 * "odd and even pages" mode makes two files in one press: pages 1, 3, 5 …
 * and pages 2, 4, 6 ….
 */
describe("Split PDF · odd and even pages", () => {
  it("previews two files, the odd pages and the even pages, and splits into them", async () => {
    const label = SPLIT_MODE_LABEL.oddEven;
    // Health: the mode exists by its label, so the click below is real.
    expect(label).toBeTruthy();
    const source = await pdfWithPages(5);
    render(
      <SplitEditor pdf={loaded(source, "scan.pdf", 5)} onReset={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: label }));
    const odd = screen.getByText("scan-odd-pages.pdf").closest("li")!;
    const even = screen.getByText("scan-even-pages.pdf").closest("li")!;
    expect(odd).toHaveTextContent("3 pages");
    expect(even).toHaveTextContent("2 pages");
    fireEvent.click(
      screen.getByRole("button", { name: /split into 2 files/i }),
    );
    expect(
      await screen.findByText(/2 files created/, undefined, {
        timeout: 10_000,
      }),
    ).toBeInTheDocument();
  });

  it("a one-page PDF has no even pages: one file, said plainly", async () => {
    const source = await pdfWithPages(1);
    render(
      <SplitEditor pdf={loaded(source, "one.pdf", 1)} onReset={() => {}} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: SPLIT_MODE_LABEL.oddEven }),
    );
    expect(screen.getByText("one-odd-pages.pdf")).toBeInTheDocument();
    expect(screen.queryByText("one-even-pages.pdf")).toBeNull();
  });
});

/**
 * Audit split-pdf#5 (2026-11-07): By bookmarks showed each part's bookmark
 * title in the preview, then downloaded it as <name>-03-pages-41-80.pdf, so
 * a report split into chapters had to be renamed file by file. Each file is
 * now named after its bookmark unless "Name each file after its bookmark" is
 * unticked.
 */
describe("Split PDF · By bookmarks names files after their bookmarks", () => {
  async function bookmarked(): Promise<Uint8Array> {
    const { PDFName, PDFString, PDFNumber } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    for (let i = 0; i < 5; i++) doc.addPage([300, 400]);
    const ctx = doc.context;
    const outlines = ctx.nextRef();
    const starts = [1, 3];
    const refs = starts.map(() => ctx.nextRef());
    starts.forEach((start, i) => {
      ctx.assign(
        refs[i]!,
        ctx.obj({
          Title: PDFString.of(i === 0 ? "Chapter: One?" : "Appendix"),
          Parent: outlines,
          Dest: ctx.obj([doc.getPage(start).ref, PDFName.of("Fit")]),
          ...(i > 0 ? { Prev: refs[i - 1] } : {}),
          ...(i < starts.length - 1 ? { Next: refs[i + 1] } : {}),
        }),
      );
    });
    ctx.assign(
      outlines,
      ctx.obj({
        Type: PDFName.of("Outlines"),
        First: refs[0],
        Last: refs[refs.length - 1],
        Count: PDFNumber.of(starts.length),
      }),
    );
    doc.catalog.set(PDFName.of("Outlines"), outlines);
    return doc.save();
  }

  it("previews each bookmarked part under its title, and the box turns it off", async () => {
    const source = await bookmarked();
    render(
      <SplitEditor pdf={loaded(source, "report.pdf", 5)} onReset={() => {}} />,
    );
    const mode = screen.getByRole("button", {
      name: SPLIT_MODE_LABEL.bookmarks,
    });
    fireEvent.click(mode);
    // Health: the outline was read (the preview shows the bookmark label).
    expect(
      await screen.findByText("Appendix", undefined, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("report-3-Appendix.pdf", undefined, {
        timeout: 5_000,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("report-2-Chapter One.pdf")).toBeInTheDocument();
    // Pages before the first bookmark have no title: the page span stays.
    expect(screen.getByText("report-1-page-1.pdf")).toBeInTheDocument();
    const box = screen.getByRole("checkbox", {
      name: /name each file after its bookmark/i,
    });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(screen.getByText("report-3-pages-4-5.pdf")).toBeInTheDocument();
    expect(screen.queryByText("report-3-Appendix.pdf")).toBeNull();
  }, 20_000);
});

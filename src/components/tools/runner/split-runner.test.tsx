// @vitest-environment jsdom
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

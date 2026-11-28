// @vitest-environment jsdom
// @native-canvas
/**
 * Every match is reachable past the 500 a Find or Detect lists (audit
 * redact-pdf#4), through the editor a person uses: Detect on a PDF with
 * 1,200 email addresses lists the first 500 and offers "Find more from page
 * N"; two presses list the rest; "Remove text under boxes" then redacts them
 * all, and the SAVED file — read back with pdf.js, as a person searching it
 * would — holds none of the 1,200.
 *
 * The witness is the count at each hop: 1,200 in the fixture's text, 1,200
 * in the review list, 1,200 boxes, 0 left in the output. A positive control
 * below the cap shows no "Find more" at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { MAX_FOUND } from "@/lib/pdf/redact-categories";
import { extractPdfText, type PdfTextReader } from "@/lib/pdf/text";
import { RedactEditor } from "./redact-runner";

const legacy: PdfTextReader = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Awaited<
    ReturnType<PdfTextReader>
  >;

const PER_PAGE = 40;
const EMAIL = /person\d+@mail\.test/g;

let saved: Blob | null = null;

beforeEach(() => {
  saved = null;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    saved = blob;
    return "blob:redact-test";
  });
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  resetAnnouncer();
  vi.restoreAllMocks();
});

async function emailsPdf(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let start = 0; start < count; start += PER_PAGE) {
    const page = doc.addPage([595, 842]);
    for (let i = start; i < Math.min(count, start + PER_PAGE); i++)
      page.drawText(`person${i}@mail.test`, {
        x: 56,
        y: 800 - (i - start) * 19,
        size: 11,
        font,
      });
  }
  return doc.save();
}

async function emailsIn(bytes: Uint8Array): Promise<number> {
  const { pages } = await extractPdfText(bytes, legacy);
  return pages.reduce((n, p) => n + (p.text.match(EMAIL)?.length ?? 0), 0);
}

async function openEditor(count: number) {
  const bytes = await emailsPdf(count);
  // Health: the fixture's own text holds every address.
  expect(await emailsIn(bytes)).toBe(count);
  const pageCount = Math.ceil(count / PER_PAGE);
  render(
    <RedactEditor
      pdf={{
        file: new File([new Uint8Array(bytes)], "export.pdf", {
          type: "application/pdf",
        }),
        bytes,
        pageCount,
        rotations: Array.from({ length: pageCount }, () => 0),
        digitalSignatures: 0,
      }}
      onReset={() => {}}
    />,
  );
  await screen.findByText(/^Page 1 is 595 × 842 pt$/, {}, { timeout: 15000 });
}

const review = () => screen.getByText(/^Review · /).textContent;

async function redactAndRead(): Promise<Uint8Array> {
  fireEvent.click(
    screen.getByRole("radio", { name: "Remove text under boxes" }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Redact PDF/ }));
  fireEvent.click(
    await screen.findByRole(
      "button",
      { name: "Download redacted PDF" },
      { timeout: 170000 },
    ),
  );
  expect(saved).not.toBeNull();
  return new Uint8Array(await saved!.arrayBuffer());
}

describe("Redact PDF reaches every match past the cap", () => {
  it("1,200 addresses: Detect, Find more twice, Remove — none left in the saved file", async () => {
    await openEditor(1200);
    fireEvent.click(screen.getByRole("button", { name: /^Detect$/ }));
    await screen.findByText(
      new RegExp(
        `Detect stopped at the first ${MAX_FOUND} \\(up to page 13\\)`,
      ),
      {},
      { timeout: 30000 },
    );
    expect(review()).toBe(
      `Review · ${MAX_FOUND} of ${MAX_FOUND} will be redacted`,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Find more from page 13" }),
    );
    // The second step stopped on page 25 (1,000 is 25 full pages).
    const more = await screen.findByRole(
      "button",
      { name: /^Find more from page 2[56]$/ },
      { timeout: 30000 },
    );
    expect(review()).toBe("Review · 1000 of 1000 will be redacted");
    fireEvent.click(more);
    await screen.findByText(/That is all of them\./, {}, { timeout: 30000 });
    expect(screen.queryByRole("button", { name: /^Find more/ })).toBeNull();
    expect(review()).toBe("Review · 1200 of 1200 will be redacted");

    const out = await redactAndRead();
    expect(await emailsIn(out)).toBe(0);
  }, 300000);

  /*
   * Review 2026-11-28 finding 6: only Detect went through the panel, so
   * deleting the Find-text `setMore` left every test green. The search path
   * is driven here the same way, counted at each hop.
   */
  it("Find text past the cap: Find more twice lists all 1,200 matches", async () => {
    await openEditor(1200);
    fireEvent.change(screen.getByLabelText("Search the text"), {
      target: { value: "mail.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Find$/ }));
    await screen.findByText(
      new RegExp(`\\(the first ${MAX_FOUND}\\)`),
      {},
      { timeout: 30000 },
    );
    expect(review()).toBe(
      `Review · ${MAX_FOUND} of ${MAX_FOUND} will be redacted`,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Find more from page 13" }),
    );
    const more = await screen.findByRole(
      "button",
      { name: /^Find more from page 2[56]$/ },
      { timeout: 30000 },
    );
    expect(review()).toBe("Review · 1000 of 1000 will be redacted");
    fireEvent.click(more);
    await screen.findByText(
      /more matches for “mail\.test” found .* That is all of them\./,
      {},
      { timeout: 30000 },
    );
    expect(screen.queryByRole("button", { name: /^Find more/ })).toBeNull();
    expect(review()).toBe("Review · 1200 of 1200 will be redacted");
  }, 120000);

  /*
   * Review 2026-11-28 finding 13: "Clear list" left "Find more" offering to
   * continue a list that was gone, an edited query still continued the old
   * search under the button, and Detect's capped status said "anything
   * after them was not searched" above a button that searches them.
   */
  it("Detect's capped status points at Find more instead of saying the rest was not searched", async () => {
    await openEditor(1200);
    fireEvent.click(screen.getByRole("button", { name: /^Detect$/ }));
    const status = await screen.findByText(
      new RegExp(`Detect stopped at the first ${MAX_FOUND}`),
      {},
      { timeout: 30000 },
    );
    expect(screen.getByRole("button", { name: /^Find more/ })).toBeTruthy();
    expect(status.textContent).not.toMatch(/not searched/);
    expect(status.textContent).toMatch(/Find more/);
  }, 120000);

  it("Clear list drops Find more and the old status", async () => {
    await openEditor(1200);
    fireEvent.click(screen.getByRole("button", { name: /^Detect$/ }));
    await screen.findByRole(
      "button",
      { name: "Find more from page 13" },
      { timeout: 30000 },
    );
    fireEvent.click(screen.getByRole("button", { name: /Clear list/ }));
    expect(screen.queryByRole("button", { name: /^Find more/ })).toBeNull();
    expect(screen.queryByText(/Detect stopped at the first/)).toBeNull();
  }, 120000);

  it("editing the query drops a Find more that would carry on the old search", async () => {
    await openEditor(1200);
    const box = screen.getByLabelText("Search the text");
    fireEvent.change(box, { target: { value: "mail.test" } });
    fireEvent.click(screen.getByRole("button", { name: /^Find$/ }));
    await screen.findByRole(
      "button",
      { name: "Find more from page 13" },
      { timeout: 30000 },
    );
    fireEvent.change(box, { target: { value: "person1" } });
    expect(screen.queryByRole("button", { name: /^Find more/ })).toBeNull();
    // Control: a Detect continuation survives a query edit, since it does
    // not depend on the query.
    fireEvent.click(screen.getByRole("button", { name: /^Detect$/ }));
    await screen.findByText(
      new RegExp(`Detect stopped at the first ${MAX_FOUND}`),
      {},
      { timeout: 30000 },
    );
    fireEvent.change(box, { target: { value: "person2" } });
    expect(screen.getByRole("button", { name: /^Find more/ })).toBeTruthy();
  }, 120000);

  it("control: 300 addresses offer no Find more, and all 300 go", async () => {
    await openEditor(300);
    fireEvent.click(screen.getByRole("button", { name: /^Detect$/ }));
    await screen.findByText(/^300 items found/, {}, { timeout: 30000 });
    expect(screen.queryByRole("button", { name: /^Find more/ })).toBeNull();
    expect(review()).toBe("Review · 300 of 300 will be redacted");
    const out = await redactAndRead();
    expect(await emailsIn(out)).toBe(0);
  }, 120000);
});

// @vitest-environment jsdom
// @native-canvas
/**
 * Redact PDF's find panel, judged on what a person reads.
 *
 * Audit #13 (2026-11-06) gave `readRedactText` a `notSearched` report and
 * `detectPersonalData` a `capped` flag, both tested in the library. The
 * review found nothing checked that the PANEL shows them: removing the
 * `<NotSearchedNote>` line or the capped branch failed no test. Here the panel
 * reads a real PDF (no module is mocked) and the text on screen is asserted.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_FOUND } from "@/lib/pdf/redact-categories";
import { RedactFindPanel } from "./redact-find-panel";

afterEach(cleanup);

function renderPanel(bytes: Uint8Array) {
  return render(
    <RedactFindPanel
      bytes={bytes}
      found={[]}
      chosen={new Set()}
      onFound={() => {}}
      onToggle={() => {}}
      onToggleAll={() => {}}
      onClear={() => {}}
    />,
  );
}

describe("RedactFindPanel says what Find and Detect could not see", () => {
  it("names the pages with filled form fields and with comments", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const line of ["First page text", "Second page text"]) {
      doc.addPage([595, 842]).drawText(line, { x: 56, y: 780, size: 12, font });
    }
    const field = doc.getForm().createTextField("guardian");
    field.setText("Guardian John Roe");
    field.addToPage(doc.getPage(1), { x: 56, y: 100, width: 200, height: 20 });
    doc.getPage(0).node.set(
      PDFName.of("Annots"),
      doc.context.obj([
        doc.context.register(
          doc.context.obj({
            Type: "Annot",
            Subtype: "Text",
            Rect: [400, 40, 420, 60],
            Contents: PDFString.of("Call John Roe back"),
          }),
        ),
      ]),
    );
    renderPanel(await doc.save());
    fireEvent.change(screen.getByLabelText("Search the text"), {
      target: { value: "John Roe" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Find$/ }));
    expect(
      await screen.findByText(
        /No matches for “John Roe”/,
        {},
        { timeout: 15000 },
      ),
    ).toBeTruthy();
    const note = screen.getByText(/Find and Detect do not search inside them/);
    expect(note.textContent?.replace(/\s+/g, " ")).toBe(
      "Page 2 has filled form fields; Page 1 has comments. Find and Detect do not search inside them, so cover them with areas by position.",
    );
  }, 30000);

  it("a plain PDF gets no such note (the note is not always there)", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc
      .addPage([595, 842])
      .drawText("Plain", { x: 56, y: 780, size: 12, font });
    renderPanel(await doc.save());
    fireEvent.change(screen.getByLabelText("Search the text"), {
      target: { value: "Plain" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Find$/ }));
    expect(
      await screen.findByText(/1 match for “Plain”/, {}, { timeout: 15000 }),
    ).toBeTruthy();
    expect(screen.queryByText(/do not search inside them/)).toBeNull();
  }, 30000);

  it("Detect says when it stopped at the cap, and on which page", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const perPage = 10;
    const pages = Math.ceil((MAX_FOUND + 100) / perPage);
    for (let p = 0; p < pages; p++) {
      const page = doc.addPage([595, 842]);
      for (let i = 0; i < perPage; i++) {
        page.drawText(`person${p}x${i}@mail.test`, {
          x: 56,
          y: 780 - i * 24,
          size: 12,
          font,
        });
      }
    }
    renderPanel(await doc.save());
    fireEvent.click(screen.getByRole("button", { name: /^Detect$/ }));
    const status = await screen.findByText(
      /items found/,
      {},
      { timeout: 25000 },
    );
    expect(status.textContent).toBe(
      `More than ${MAX_FOUND} items found. Detect stopped at the first ${MAX_FOUND} (up to page ${MAX_FOUND / perPage}) and added them to the list below; anything after them was not searched.`,
    );
  }, 60000);
});

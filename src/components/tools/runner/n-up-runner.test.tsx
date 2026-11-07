// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PDFBool, PDFDocument, PDFHexString, PDFName } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { NUpEditor } from "./n-up-runner";

/**
 * What a person using Multiple Pages per Sheet is TOLD about a form value
 * that did not reach the sheets — the rendered result panel, not what
 * `nUpPdf` returns. The FAQ promises such a value "is named on the result
 * instead"; before this file, deleting the panel's status block left every
 * test green (audit #24 review, CLAUDE.md rule 5). The real engine runs, so
 * the chain from the file to the sentence is what is checked.
 */

afterEach(() => {
  cleanup();
  resetAnnouncer();
});

/** A 2-page PDF whose page 1 holds a text field `bn.name` set to Bengali. */
async function bengaliForm({
  stored,
}: {
  stored: boolean;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  doc.addPage([400, 400]);
  const form = doc.getForm();
  const field = form.createTextField("bn.name");
  field.addToPage(doc.getPage(0), { x: 20, y: 200, width: 200, height: 30 });
  field.setText("STORED");
  form.updateFieldAppearances();
  field.acroField.dict.set(PDFName.of("V"), PDFHexString.fromText("আমার"));
  if (!stored) {
    for (const widget of field.acroField.getWidgets()) {
      widget.dict.delete(PDFName.of("AP"));
    }
  }
  form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
  return doc.save({ updateFieldAppearances: false });
}

async function runOn(bytes: Uint8Array): Promise<void> {
  const file = new File([new Uint8Array(bytes)], "form.pdf", {
    type: "application/pdf",
  });
  render(
    <NUpEditor
      pdf={{
        file,
        bytes,
        pageCount: 2,
        rotations: [0, 0],
        digitalSignatures: 0,
      }}
      onReset={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /create sheets/i }));
  await screen.findByRole("group", { name: /sheets created/i });
}

function missingValueNotes(): HTMLElement[] {
  return screen
    .queryAllByRole("status")
    .filter((el) => /not on the sheets/i.test(el.textContent ?? ""));
}

describe("n-up result panel: a form value left off the sheets", () => {
  it("names the field in a status when its value has no drawing at all", async () => {
    await runOn(await bengaliForm({ stored: false }));
    const notes = missingValueNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.textContent).toContain("bn.name");
  });

  it("CONTROL: says nothing when the stored appearance carries the value", async () => {
    await runOn(await bengaliForm({ stored: true }));
    expect(missingValueNotes()).toEqual([]);
  });
});

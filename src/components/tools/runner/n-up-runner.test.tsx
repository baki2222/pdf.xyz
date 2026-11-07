// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  PDFArray,
  PDFBool,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import { N_UP_RTL_LABEL } from "@/lib/pdf/n-up";
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

describe("n-up: right to left reaches the sheets (audit n-up-pdf#4)", () => {
  /** The x of each drawn page on sheet 1, in drawing order (page order). */
  async function drawnXs(bytes: Uint8Array): Promise<number[]> {
    const doc = await PDFDocument.load(bytes);
    const contents = doc.getPage(0).node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((r) => doc.context.lookup(r))
        : [contents];
    const text = streams
      .map((st) =>
        new TextDecoder().decode(
          decodePDFRawStream(st as PDFRawStream).decode(),
        ),
      )
      .join("\n");
    // pdf-lib's drawPage: q, "1 0 0 1 x y cm", …, "/Name Do", Q.
    return [...text.matchAll(/1 0 0 1 ([\d.-]+) [\d.-]+ cm[\s\S]*?Do/g)].map(
      (m) => Number(m[1]),
    );
  }

  async function sheetBytes(rtl: boolean): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 2; i += 1) {
      // Portrait pages, so 2 per sheet on Auto sets them side by side.
      doc.addPage([300, 400]).drawText(`P${i}`, { x: 20, y: 300, font });
    }
    const bytes = await doc.save();
    const blobs: Blob[] = [];
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      if (obj instanceof Blob) blobs.push(obj);
      return "blob:n-up-test";
    };
    URL.revokeObjectURL = () => {};
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    try {
      render(
        <NUpEditor
          pdf={{
            file: new File([new Uint8Array(bytes)], "deck.pdf", {
              type: "application/pdf",
            }),
            bytes,
            pageCount: 2,
            rotations: [0, 0],
            digitalSignatures: 0,
          }}
          onReset={() => {}}
        />,
      );
      const box = screen.getByRole("checkbox", { name: N_UP_RTL_LABEL });
      if (rtl) fireEvent.click(box);
      fireEvent.click(screen.getByRole("button", { name: /create sheets/i }));
      fireEvent.click(
        await screen.findByRole("button", { name: /download pdf/i }),
      );
      expect(blobs).toHaveLength(1);
      return new Uint8Array(await blobs[0]!.arrayBuffer());
    } finally {
      URL.createObjectURL = create;
      URL.revokeObjectURL = revoke;
      click.mockRestore();
      cleanup();
    }
  }

  it("ticked, page 2 is drawn LEFT of page 1; unticked (control), right of it", async () => {
    const ltr = await drawnXs(await sheetBytes(false));
    expect(ltr, "health: two pages drawn on sheet 1").toHaveLength(2);
    expect(ltr[1]!).toBeGreaterThan(ltr[0]!);
    const rtl = await drawnXs(await sheetBytes(true));
    expect(rtl).toHaveLength(2);
    expect(rtl[1]!).toBeLessThan(rtl[0]!);
  });
});

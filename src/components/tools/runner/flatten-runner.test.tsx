// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  PDFBool,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
} from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { DYNAMIC_XFA_MESSAGE } from "@/lib/pdf/flatten";
import { FlattenEditor, SIGNED_PDF_WARNING } from "./flatten-runner";

/**
 * What a person using Flatten PDF is told and handed — the rendered runner and
 * the NAME of the file it downloads — not what the engine returns. The engine
 * can report `flattenedFields: 0` correctly and the page can still say
 * "Download flattened PDF" over a green check and save "contract-flattened.pdf";
 * that is exactly what shipped for a PDF with no form fields.
 */

let downloads: string[] = [];

beforeEach(() => {
  downloads = [];
  // jsdom has no object URLs and no real downloads: record the file NAME the
  // anchor carried at the moment it was clicked, which is what the browser
  // saves the file as.
  URL.createObjectURL = vi.fn(() => "blob:flatten-test");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  cleanup();
  resetAnnouncer();
  vi.restoreAllMocks();
});

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  return doc.save();
}

async function formPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  const name = form.createTextField("profile.name");
  name.setText("Ada Lovelace");
  name.addToPage(page, { x: 50, y: 700, width: 200, height: 24 });
  const agree = form.createCheckBox("profile.agree");
  agree.check();
  agree.addToPage(page, { x: 50, y: 660, width: 18, height: 18 });
  return doc.save();
}

/** A filled text field plus a SIGNED signature field with an appearance. */
async function signedFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  const name = form.createTextField("applicant.name");
  name.setText("Ada Lovelace");
  name.addToPage(page, { x: 50, y: 700, width: 300, height: 24 });
  const ctx = doc.context;
  const sig = ctx.obj({
    FT: "Sig",
    T: PDFString.of("Signature1"),
    Type: "Annot",
    Subtype: "Widget",
    Rect: [50, 560, 250, 600],
    F: 4,
    P: page.ref,
    V: ctx.register(
      ctx.obj({
        Type: "Sig",
        Filter: "Adobe.PPKLite",
        Contents: PDFHexString.of("00"),
      }),
    ),
    AP: {
      N: ctx.register(ctx.formXObject([], { BBox: [0, 0, 200, 40] })),
    },
  });
  const ref = ctx.register(sig);
  page.node.addAnnot(ref);
  form.acroForm.addField(ref);
  return doc.save();
}

async function dynamicXfaPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  const ctx = doc.context;
  const xfa = ctx.register(ctx.stream("<xdp:xdp></xdp:xdp>"));
  doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [], XFA: xfa }));
  doc.catalog.set(PDFName.of("NeedsRendering"), PDFBool.True);
  return doc.save();
}

function mount(bytes: Uint8Array, name: string) {
  const file = new File([new Uint8Array(bytes)], name, {
    type: "application/pdf",
  });
  render(
    <FlattenEditor
      pdf={{ file, bytes, pageCount: 1, rotations: [0] }}
      onReset={() => {}}
    />,
  );
}

/** Wait for the inspection to finish, then press the one primary action. */
async function runTool(action: RegExp) {
  const button = await screen.findByRole("button", { name: action });
  fireEvent.click(button);
}

describe("Flatten PDF runner — what the user is told and handed", () => {
  it("a PDF with no form fields is re-saved under a neutral panel and a name that does not say 'flattened'", async () => {
    mount(await blankPdf(), "contract.pdf");
    await screen.findByText(/no fillable acroform fields were detected/i);
    await runTool(/^re-save pdf$/i);

    const panel = await screen.findByRole("group", { name: /pdf re-saved/i });
    expect(panel).toHaveAttribute("data-tone", "neutral");
    expect(
      screen.queryByRole("button", { name: /download flattened pdf/i }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^download pdf$/i }));
    expect(downloads).toEqual(["contract-resaved.pdf"]);
  });

  it("control: a real form is flattened under a success panel and downloads as '-flattened'", async () => {
    mount(await formPdf(), "form.pdf");
    await screen.findByText(/found 2 fillable form fields/i);
    await runTool(/flatten form fields/i);

    const panel = await screen.findByRole("group", {
      name: /form fields flattened/i,
    });
    expect(panel).toHaveAttribute("data-tone", "ok");
    fireEvent.click(
      screen.getByRole("button", { name: /download flattened pdf/i }),
    );
    expect(downloads).toEqual(["form-flattened.pdf"]);
  });

  it("a signed PDF is warned about before the run, and its signature field is reported as left as-is", async () => {
    mount(await signedFormPdf(), "signed.pdf");
    await screen.findByText(/found 1 fillable form field\./i);
    expect(
      screen.getByText(/1 signature field\s*will be left\s*as-is/i),
    ).toBeInTheDocument();
    expect(screen.getByText(SIGNED_PDF_WARNING)).toBeInTheDocument();
    await runTool(/flatten form fields/i);

    await screen.findByRole("group", { name: /form fields flattened/i });
    expect(screen.getByText(/flattened 1 of 2 form fields/i)).toBeVisible();
    expect(screen.getByText(/left as-is, still interactive/i)).toBeVisible();
    expect(screen.getByText(/^Signature1 \(/)).toBeVisible();
    expect(screen.getByText(SIGNED_PDF_WARNING)).toBeVisible();
  });

  it("a dynamic XFA form is explained and cannot be run", async () => {
    mount(await dynamicXfaPdf(), "tax-form.pdf");
    await screen.findByText(DYNAMIC_XFA_MESSAGE);
    const button = screen.getByRole("button", { name: /re-save pdf/i });
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    // Nothing ran: no result panel, nothing to download.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("group", { name: /re-saved|flattened/i })).toBe(
      null,
    );
    expect(downloads).toEqual([]);
  });
});

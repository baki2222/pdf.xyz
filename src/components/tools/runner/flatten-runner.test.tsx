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
import { ENDING_WAIT_MS } from "./runner-kit";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import { getToolBySlug } from "@/lib/tools";
import { pageFaq, pageIntro, pageSteps, stepText } from "@/lib/tools/page-copy";

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
      pdf={{
        file,
        bytes,
        pageCount: 1,
        rotations: [0],
        digitalSignatures: countDigitalSignatures(bytes),
      }}
      onReset={() => {}}
    />,
  );
}

/**
 * Everything the Flatten PDF page says about itself, as served: the intro,
 * the steps (also the HowTo) and the FAQ (also FAQPage JSON-LD).
 */
function servedCopy(): string {
  const tool = getToolBySlug("flatten-pdf");
  if (!tool) throw new Error("flatten-pdf is not in the catalogue");
  return [
    ...pageIntro(tool),
    ...pageSteps(tool).map(stepText),
    ...pageFaq(tool).flatMap((entry) => [entry.question, entry.answer]),
  ].join(" ");
}

/** The title of the result panel, as rendered (the first labelling id). */
function panelTitle(panel: HTMLElement): string {
  const id = panel.getAttribute("aria-labelledby")?.split(" ")[0] ?? "";
  return document.getElementById(id)?.textContent?.trim() ?? "";
}

/** What a download name adds to the source's base name: "-resaved". */
function addedSuffix(download: string, source: string): string {
  const base = source.replace(/\.pdf$/i, "");
  expect(download.startsWith(base), `${download} does not extend ${base}`).toBe(
    true,
  );
  return download.slice(base.length).replace(/\.pdf$/i, "");
}

/**
 * The page names, in quotes, every label the visitor was just shown. Read off
 * the RENDERED runner, not the runner's source: the step that said "the button
 * and the -flattened file name stay the same" was beside a panel that showed
 * "Download PDF" and saved "-resaved", and nothing compared the two.
 */
function expectServedNames(labels: readonly string[]) {
  const served = servedCopy();
  // Health: an empty label is contained in every string.
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    expect(
      label.trim().length,
      "an empty label proves nothing",
    ).toBeGreaterThan(0);
    expect(served, `the page never names "${label}"`).toContain(`"${label}"`);
  }
}

// Every wait in this file: the inspection (pdf-lib and loadPdf's guard
// imports, cold in this worker on first use), then a run whose result is
// held for the result-ending chunk for up to ENDING_WAIT_MS by design. The
// 1 s default left ~2.1x against the slowest CI run of a whole test here
// (483 ms on main run 44931945692, the max over 33 CI runs of
// 11-09..11-21, failed runs included; 448 ms among the 12 passing runs of
// 11-18, run 44299285879), and the cap alone could reach it. 2800 ms:
// 5.8x the CI max and 2.2x the designed worst case (cap plus
// run), under the 5 s test timeout. A numeric literal, not an expression
// of the cap, so CI's wait-headroom report can read it from source and
// judge each wait against it; the test "the UI wait still covers..."
// below reddens if the cap grows past it.
const UI_MS = 2_800;
const UI = { timeout: UI_MS };

it("the UI wait still covers the result-ending cap plus 2 s", () => {
  expect(UI_MS).toBeGreaterThanOrEqual(ENDING_WAIT_MS + 2_000);
});

/** Wait for the inspection to finish, then press the one primary action. */
async function runTool(action: RegExp) {
  const button = await screen.findByRole("button", { name: action }, UI);
  fireEvent.click(button);
}

describe("Flatten PDF runner — what the user is told and handed", () => {
  it("a PDF with no form fields is re-saved under a neutral panel and a name that does not say 'flattened'", async () => {
    mount(await blankPdf(), "contract.pdf");
    await screen.findByText(
      /no fillable acroform fields were detected/i,
      {},
      UI,
    );
    const run = await screen.findByRole(
      "button",
      { name: /^re-save pdf$/i },
      UI,
    );
    fireEvent.click(run);
    // Positive control for the XFA test's probe: a press that runs is busy
    // INSIDE the click (setBusy precedes the task's first await), so the
    // probe there, read at the same moment, is not blind.
    expect(run).toHaveAttribute("aria-busy", "true");
    expect(run).toHaveTextContent(/^saving\u2026$/i);

    const panel = await screen.findByRole(
      "group",
      { name: /pdf re-saved/i },
      UI,
    );
    expect(panel).toHaveAttribute("data-tone", "neutral");
    expect(
      screen.queryByRole("button", { name: /download flattened pdf/i }),
    ).toBeNull();
    const button = screen.getByRole("button", { name: /^download pdf$/i });
    fireEvent.click(button);
    expect(downloads).toEqual(["contract-resaved.pdf"]);
    expectServedNames([
      panelTitle(panel),
      button.textContent ?? "",
      addedSuffix(downloads[0]!, "contract.pdf"),
    ]);
  });

  it("control: a real form is flattened under a success panel and downloads as '-flattened'", async () => {
    mount(await formPdf(), "form.pdf");
    await screen.findByText(/found 2 fillable form fields/i, {}, UI);
    await runTool(/flatten form fields/i);

    const panel = await screen.findByRole(
      "group",
      { name: /form fields flattened/i },
      UI,
    );
    expect(panel).toHaveAttribute("data-tone", "ok");
    const button = screen.getByRole("button", {
      name: /download flattened pdf/i,
    });
    fireEvent.click(button);
    expect(downloads).toEqual(["form-flattened.pdf"]);
    expectServedNames([
      panelTitle(panel),
      button.textContent ?? "",
      addedSuffix(downloads[0]!, "form.pdf"),
    ]);
  });

  it("a signed PDF is warned about before the run, and its signature field is reported as left as-is", async () => {
    mount(await signedFormPdf(), "signed.pdf");
    await screen.findByText(/found 1 fillable form field\./i, {}, UI);
    expect(
      screen.getByText(/1 signature field\s*will be left\s*as-is/i),
    ).toBeInTheDocument();
    expect(screen.getByText(SIGNED_PDF_WARNING)).toBeInTheDocument();
    await runTool(/flatten form fields/i);

    await screen.findByRole("group", { name: /form fields flattened/i }, UI);
    const partial = screen.getByText(/flattened 1 of 2 form fields/i);
    expect(partial).toBeVisible();
    const leftAsIs = screen.getByText(/left as-is, still interactive/i);
    expect(leftAsIs).toBeVisible();
    expect(screen.getByText(/^Signature1 \(/)).toBeVisible();
    expect(screen.getByText(SIGNED_PDF_WARNING)).toBeVisible();

    // The page describes this outcome in the words the panel used. The
    // heading as rendered, without its colon; the partial summary as a SHAPE
    // (its counts are this fixture's), cut at the " · <size>" it ends with.
    expectServedNames([(leftAsIs.textContent ?? "").replace(/:\s*$/, "")]);
    const summary = (partial.textContent ?? "").split(" · ")[0]!.trim();
    expect(summary).toMatch(/\d/);
    const escaped = summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const shape = new RegExp(`"${escaped.replace(/\d+/g, "\\d+")}"`);
    expect(servedCopy(), `the page never shows "${summary}"`).toMatch(shape);
  });

  it("two skipped fields sharing a name are BOTH listed, without a React key collision", async () => {
    // Malformed forms repeat field names. Keyed by name, React warns and may
    // drop or reuse one of the rows, so the list stops matching the count.
    const doc = await PDFDocument.load(await formPdf());
    const page = doc.getPage(0);
    const form = doc.getForm();
    for (const y of [560, 500]) {
      const ref = doc.context.register(
        doc.context.obj({
          FT: "Sig",
          T: PDFString.of("Signature1"),
          Type: "Annot",
          Subtype: "Widget",
          Rect: [50, y, 250, y + 40],
          F: 4,
          P: page.ref,
        }),
      );
      page.node.addAnnot(ref);
      form.acroForm.addField(ref);
    }
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mount(await doc.save(), "dupes.pdf");
    await runTool(/flatten form fields/i);

    await screen.findByRole("group", { name: /form fields flattened/i }, UI);
    expect(screen.getAllByText(/^Signature1 \(/)).toHaveLength(2);
    const keyWarnings = errors.mock.calls.filter((args) =>
      args.some((arg) => /same key/i.test(String(arg))),
    );
    expect(keyWarnings).toEqual([]);
  });

  it("a dynamic XFA form is explained and cannot be run", async () => {
    mount(await dynamicXfaPdf(), "tax-form.pdf");
    await screen.findByText(DYNAMIC_XFA_MESSAGE, {}, UI);
    const button = screen.getByRole("button", { name: /re-save pdf/i });
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    // Nothing started, read at the moment a press that runs is already busy
    // (test 1 proves that moment): until 2026-11-21 this waited 50 ms, and a
    // blocked press that ran anyway ended in an alert, never a group, so it
    // stayed green at any speed. "false", not "not true": a button that
    // stopped saying aria-busy would turn this blind, and red is better.
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(screen.queryByText(/saving\u2026|flattening\u2026/i)).toBeNull();
    // Nothing ran: no result panel, nothing to download.
    expect(screen.queryByRole("group", { name: /re-saved|flattened/i })).toBe(
      null,
    );
    expect(downloads).toEqual([]);
  });
});

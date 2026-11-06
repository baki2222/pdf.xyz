// @vitest-environment jsdom
/**
 * The Fill Forms runner, driven the way a person drives it, and judged on what
 * they read and the file they download.
 *
 * The defect (audit 2026-09-27): "Flatten after filling" promises values that
 * "can't be edited or cleared in a viewer". When pdf-lib threw inside the
 * flatten, the engine fell back to the filled-but-editable bytes — correctly —
 * and the runner still showed a green "Form filled", mentioning the flatten
 * only by the ABSENCE of a " · flattened to static content" suffix. The user
 * sends a form they believe is locked. Nothing caught it: the engine's tests
 * only ever flattened forms that flatten, and no test rendered this runner.
 *
 * The file that fails is a real structure (`src/tests/unflattenable-form-pdf.ts`
 * — an orphan widget no page lists), not a stubbed `flatten()`. No module is
 * mocked (see `src/tests/mock-isolation.test.ts`); the download is caught
 * where the browser would receive it, at `URL.createObjectURL`, and decoded.
 *
 * Three cases, because the warning must follow the RELATIONSHIP "asked for a
 * flatten, did not get one" — not either half alone:
 *   asked + failed    → warned, and the download is still a live form
 *   asked + succeeded → positive control: no warning, and no fields remain
 *   not asked         → no warning, although the same file cannot flatten
 */
import type { ReactNode } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { inspectFormFields, type FormInspection } from "@/lib/pdf/forms";
import { dropSheetsLive } from "@/tests/drop-sheets-live";
import {
  ORPHAN_FIELD,
  VISIBLE_FIELD,
  formPdf,
} from "@/tests/unflattenable-form-pdf";
import { FillFormsRunner } from "./fill-forms-runner";

const router = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};

const withRouter = (children: ReactNode) => (
  <AppRouterContext.Provider value={router as never}>
    {children}
  </AppRouterContext.Provider>
);

const URL_STATICS = ["createObjectURL", "revokeObjectURL"] as const;
const ORIGINAL_URL_STATICS = URL_STATICS.map(
  (key) => [key, Object.getOwnPropertyDescriptor(URL, key)] as const,
);

afterEach(() => {
  vi.restoreAllMocks();
  for (const [key, descriptor] of ORIGINAL_URL_STATICS) {
    if (descriptor) Object.defineProperty(URL, key, descriptor);
    else Reflect.deleteProperty(URL, key);
  }
});

/** The text input on the row that names `field`. */
function inputFor(field: string): HTMLInputElement {
  let node: HTMLElement | null = screen.getByTitle(field);
  while (node && node.querySelectorAll('input[type="text"]').length !== 1) {
    node = node.parentElement;
  }
  const input = node?.querySelector<HTMLInputElement>('input[type="text"]');
  if (!input) throw new Error(`no text input for ${field}`);
  return input;
}

const TYPED = { [VISIBLE_FIELD]: "Ada Lovelace", [ORPHAN_FIELD]: "REF-7" };

/**
 * Drop the form, type a value into every field, set the flatten box, run it,
 * press Download, and hand back the result panel and the decoded download.
 */
async function fillAndDownload({
  orphan,
  flatten,
}: {
  orphan: boolean;
  flatten: boolean;
}): Promise<{ panel: HTMLElement; download: FormInspection }> {
  const bytes = await formPdf({ orphan });
  const { container } = render(withRouter(<FillFormsRunner />));
  await dropSheetsLive(container);
  const picker = container.querySelector('input[type="file"]');
  expect(picker, "the runner offers a file picker").not.toBeNull();
  fireEvent.drop(picker!.closest("label")!, {
    dataTransfer: {
      files: [
        new File([bytes.slice().buffer as ArrayBuffer], "intake.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  await screen.findByTitle(VISIBLE_FIELD, undefined, { timeout: 10_000 });

  for (const [field, value] of Object.entries(TYPED)) {
    fireEvent.change(inputFor(field), { target: { value } });
  }
  const box = screen.getByRole("checkbox", { name: /flatten after filling/i });
  if ((box as HTMLInputElement).checked !== flatten) fireEvent.click(box);
  expect((box as HTMLInputElement).checked).toBe(flatten);

  const blobs: Blob[] = [];
  // Plain writable stubs, put back exactly as found in afterEach: under
  // `isolate: false` the jsdom globals outlive this file.
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      blobs.push(blob);
      return "blob:fill-forms-runner-test";
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  fireEvent.click(screen.getByRole("button", { name: /^fill form$/i }));
  const button = await screen.findByRole(
    "button",
    { name: /download filled pdf/i },
    { timeout: 10_000 },
  );
  const panel = button.closest<HTMLElement>('[role="group"]');
  if (!panel) throw new Error("the download button is not in a result panel");
  fireEvent.click(button);
  await waitFor(() => expect(blobs).toHaveLength(1));

  const download = await inspectFormFields(
    new Uint8Array(await blobs[0]!.arrayBuffer()),
  );
  return { panel, download };
}

const WARNING = /couldn.t be flattened.*still editable/i;

describe("Fill Forms: Flatten after filling", { timeout: 30_000 }, () => {
  it("asked, and the flatten failed: the panel says the fields are still editable", async () => {
    const { panel, download } = await fillAndDownload({
      orphan: true,
      flatten: true,
    });

    // What the file IS: a live form, carrying what was typed.
    expect(download.hasFields, "the download is still editable").toBe(true);
    for (const [field, value] of Object.entries(TYPED)) {
      expect(download.fields.find((f) => f.name === field)?.text).toBe(value);
    }

    // What the person reads must agree with that.
    const heading = within(panel).getByRole("heading");
    expect(heading).toHaveTextContent(/not flattened/i);
    expect(panel).toHaveTextContent(WARNING);
    expect(panel).not.toHaveTextContent(/flattened to static content/i);
    // The headline is also what gets announced: it must not read as success.
    expect(panel).toHaveAccessibleName(/not flattened/i);
    // Flatten PDF runs the same pdf-lib flatten, so it fails on this file too.
    expect(
      within(panel)
        .queryAllByRole("link")
        .filter((a) => a.getAttribute("href")?.includes("flatten")),
      "no remedy that fails on the same file",
    ).toEqual([]);
  });

  it("positive control: asked, and it flattened — no warning, and no fields remain", async () => {
    const { panel, download } = await fillAndDownload({
      orphan: false,
      flatten: true,
    });
    expect(download.hasFields, "the download is flattened").toBe(false);
    expect(within(panel).getByRole("heading")).toHaveTextContent(
      /^form filled$/i,
    );
    expect(panel).toHaveTextContent(/flattened to static content/i);
    expect(panel).not.toHaveTextContent(WARNING);
  });

  it("not asked: the same unflattenable file is filled with no warning", async () => {
    const { panel, download } = await fillAndDownload({
      orphan: true,
      flatten: false,
    });
    expect(download.hasFields).toBe(true);
    expect(within(panel).getByRole("heading")).toHaveTextContent(
      /^form filled$/i,
    );
    expect(panel).not.toHaveTextContent(WARNING);
    expect(panel).not.toHaveTextContent(/flatten/i);
  });
});

/**
 * Audit #15 (2026-11-06): the runner sent EVERY editable field back, changed
 * or not, so `applyFormValues` rewrote each one — and pdf-lib redrew it in
 * Helvetica over the author's font. A form whose ID boxes are set in Courier
 * came back with every text field restyled after one answer was typed.
 */
async function courierFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  const name = form.createTextField("applicant.name");
  name.addToPage(page, { x: 50, y: 700, width: 300, height: 24 });
  const serial = form.createTextField("applicant.serial");
  serial.setText("AB-12");
  serial.addToPage(page, { x: 50, y: 640, width: 300, height: 24 });
  await doc.save();
  serial.acroField.setDefaultAppearance("/Courier 12 Tf 0 g");
  form.markFieldAsClean(serial.ref);
  return doc.save({ updateFieldAppearances: false });
}

describe(
  "Fill Forms: only the answers the person changed are written",
  { timeout: 30_000 },
  () => {
    it("an untouched field keeps its author's font in the download", async () => {
      const bytes = await courierFormPdf();
      const before = await PDFDocument.load(bytes);
      expect(
        before
          .getForm()
          .getTextField("applicant.serial")
          .acroField.getDefaultAppearance(),
        "fixture health: the untouched field is styled in Courier",
      ).toBe("/Courier 12 Tf 0 g");

      const { container } = render(withRouter(<FillFormsRunner />));
      await dropSheetsLive(container);
      const picker = container.querySelector('input[type="file"]');
      fireEvent.drop(picker!.closest("label")!, {
        dataTransfer: {
          files: [
            new File([bytes.slice().buffer as ArrayBuffer], "courier.pdf", {
              type: "application/pdf",
            }),
          ],
        },
      });
      await screen.findByTitle("applicant.name", undefined, {
        timeout: 10_000,
      });
      fireEvent.change(inputFor("applicant.name"), {
        target: { value: "Ada Lovelace" },
      });

      const blobs: Blob[] = [];
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: (blob: Blob) => {
          blobs.push(blob);
          return "blob:fill-forms-runner-test";
        },
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        writable: true,
        value: () => {},
      });
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
        () => {},
      );
      fireEvent.click(screen.getByRole("button", { name: /^fill form$/i }));
      const button = await screen.findByRole(
        "button",
        { name: /download filled pdf/i },
        { timeout: 10_000 },
      );
      const panel = button.closest<HTMLElement>('[role="group"]');
      expect(panel).toHaveTextContent(/1 field filled/);
      fireEvent.click(button);
      await waitFor(() => expect(blobs).toHaveLength(1));

      const after = await PDFDocument.load(
        new Uint8Array(await blobs[0]!.arrayBuffer()),
      );
      const form = after.getForm();
      expect(form.getTextField("applicant.name").getText()).toBe(
        "Ada Lovelace",
      );
      expect(form.getTextField("applicant.serial").getText()).toBe("AB-12");
      expect(
        form.getTextField("applicant.serial").acroField.getDefaultAppearance(),
      ).toBe("/Courier 12 Tf 0 g");
    });
  },
);

/**
 * Audit #16 (2026-11-06), WCAG 1.3.1 / 4.1.2: each row printed the field's
 * name in a plain <span> tied to nothing, so a text box was announced by its
 * placeholder ("Type here…"), a select had no name at all, a checkbox was
 * named by its state ("Checked"), and radio/list groups had no group name.
 * Every control is now named by the field it fills.
 */
async function everyKindFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  const name = form.createTextField("first.name");
  name.addToPage(page, { x: 10, y: 740, width: 200, height: 20 });
  const notes = form.createTextField("notes");
  notes.enableMultiline();
  notes.addToPage(page, { x: 10, y: 680, width: 200, height: 40 });
  const agree = form.createCheckBox("agree");
  agree.addToPage(page, { x: 10, y: 650, width: 15, height: 15 });
  const color = form.createRadioGroup("color");
  color.addOptionToPage("Red", page, { x: 10, y: 620, width: 15, height: 15 });
  color.addOptionToPage("Blue", page, { x: 40, y: 620, width: 15, height: 15 });
  const city = form.createDropdown("city");
  city.addOptions(["NYC", "LA"]);
  city.addToPage(page, { x: 10, y: 580, width: 200, height: 20 });
  const combo = form.createDropdown("town");
  combo.addOptions(["Paris", "Lyon"]);
  combo.enableEditing();
  combo.addToPage(page, { x: 10, y: 550, width: 200, height: 20 });
  const langs = form.createOptionList("langs");
  langs.addOptions(["EN", "FR"]);
  langs.enableMultiselect();
  langs.addToPage(page, { x: 10, y: 480, width: 200, height: 60 });
  return doc.save();
}

describe(
  "Fill Forms: every field control is named by its field",
  { timeout: 30_000 },
  () => {
    it("text, multiline, checkbox, select, combo and both groups carry the field name", async () => {
      const bytes = await everyKindFormPdf();
      const { container } = render(withRouter(<FillFormsRunner />));
      await dropSheetsLive(container);
      const picker = container.querySelector('input[type="file"]');
      fireEvent.drop(picker!.closest("label")!, {
        dataTransfer: {
          files: [
            new File([bytes.slice().buffer as ArrayBuffer], "all.pdf", {
              type: "application/pdf",
            }),
          ],
        },
      });
      await screen.findByTitle("first.name", undefined, { timeout: 10_000 });

      expect(
        screen.getByRole("textbox", { name: "first.name" }),
      ).toBeInstanceOf(HTMLInputElement);
      expect(screen.getByRole("textbox", { name: "notes" })).toBeInstanceOf(
        HTMLTextAreaElement,
      );
      screen.getByRole("checkbox", { name: "agree" });
      screen.getByRole("combobox", { name: "city" });
      screen.getByRole("combobox", { name: "town" });
      screen.getByRole("radiogroup", { name: "color" });
      screen.getByRole("group", { name: "langs" });
      // No control is left to be announced by its placeholder or its state.
      expect(screen.queryAllByRole("textbox", { name: /type here/i })).toEqual(
        [],
      );
      expect(
        screen.queryAllByRole("checkbox", { name: /^(un)?checked$/i }),
      ).toEqual([]);
      expect(screen.queryAllByRole("combobox", { name: "" })).toEqual([]);
    });
  },
);

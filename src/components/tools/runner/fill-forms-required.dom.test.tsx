// @vitest-environment jsdom
/**
 * Audit fill-forms#8: required fields carried only a red "*", and Fill form
 * went ahead with them empty; afterwards the result said "N values couldn't
 * be applied" and dropped every field's name and reason. Now the runner names
 * each empty required field before filling and offers "Fill anyway", and the
 * result lists every value that was not applied by field name, with why.
 *
 * Driven through the real runner (no module mocked); the forced failure is a
 * real one the engine refuses — right-to-left text in a field — not a stub.
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { dropSheetsLive } from "@/tests/drop-sheets-live";
import { FillFormsRunner, emptyRequiredFields } from "./fill-forms-runner";

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

afterEach(() => {
  cleanup();
  resetAnnouncer();
  vi.restoreAllMocks();
});

/** Two required text fields, one required checkbox, one optional field. */
async function requiredForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 500]);
  const form = doc.getForm();
  const surname = form.createTextField("applicant.surname");
  surname.enableRequired();
  surname.addToPage(page, { x: 40, y: 420, width: 200, height: 24 });
  const dob = form.createTextField("applicant.dob");
  dob.enableRequired();
  dob.addToPage(page, { x: 40, y: 380, width: 200, height: 24 });
  const agree = form.createCheckBox("applicant.agree");
  agree.enableRequired();
  agree.check();
  agree.addToPage(page, { x: 40, y: 340, width: 16, height: 16 });
  form
    .createTextField("applicant.notes")
    .addToPage(page, { x: 40, y: 300, width: 200, height: 24 });
  return doc.save();
}

async function open(bytes: Uint8Array) {
  const { container } = render(withRouter(<FillFormsRunner />));
  await dropSheetsLive(container);
  const picker = container.querySelector('input[type="file"]')!;
  fireEvent.drop(picker.closest("label")!, {
    dataTransfer: {
      files: [
        new File([bytes.slice()], "form.pdf", { type: "application/pdf" }),
      ],
    },
  });
  await screen.findByTitle("applicant.surname", undefined, { timeout: 10_000 });
}

function inputFor(field: string): HTMLInputElement {
  let node: HTMLElement | null = screen.getByTitle(field);
  while (node && node.querySelectorAll('input[type="text"]').length !== 1)
    node = node.parentElement;
  return node!.querySelector<HTMLInputElement>('input[type="text"]')!;
}

describe("required fields and fields not applied (audit fill-forms#8)", () => {
  it("names every empty required field before filling, and Fill anyway goes ahead", async () => {
    await open(await requiredForm());
    fireEvent.change(inputFor("applicant.notes"), {
      target: { value: "Call after 5" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^fill form$/i }));
    const warning = await screen.findByRole("alert");
    expect(warning.textContent).toContain("applicant.surname");
    expect(warning.textContent).toContain("applicant.dob");
    // The checked required checkbox and the optional field are not named.
    expect(warning.textContent).not.toContain("applicant.agree");
    expect(warning.textContent).not.toContain("applicant.notes");
    // Nothing ran yet.
    expect(screen.queryByText(/Download filled PDF/)).toBeNull();

    fireEvent.click(
      within(warning).getByRole("button", { name: "Fill anyway" }),
    );
    expect(
      await screen.findByRole(
        "button",
        { name: /Download filled PDF/ },
        { timeout: 30_000 },
      ),
    ).toBeTruthy();
  });

  it("filling the required fields clears the warning; the run then needs no confirmation", async () => {
    await open(await requiredForm());
    fireEvent.click(screen.getByRole("button", { name: /^fill form$/i }));
    await screen.findByRole("alert");
    fireEvent.change(inputFor("applicant.surname"), {
      target: { value: "Lovelace" },
    });
    fireEvent.change(inputFor("applicant.dob"), {
      target: { value: "1815-12-10" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^fill form$/i }));
    expect(
      await screen.findByRole(
        "button",
        { name: /Download filled PDF/ },
        { timeout: 30_000 },
      ),
    ).toBeTruthy();
  });

  it("lists each value that was not applied, by field name, with the reason", async () => {
    await open(await requiredForm());
    fireEvent.change(inputFor("applicant.surname"), {
      target: { value: "Lovelace" },
    });
    fireEvent.change(inputFor("applicant.dob"), {
      target: { value: "1815-12-10" },
    });
    // Right-to-left text: refused for this field, the others are filled.
    fireEvent.change(inputFor("applicant.notes"), {
      target: { value: "مرحبا" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^fill form$/i }));
    await screen.findByRole(
      "button",
      { name: /Download filled PDF/ },
      { timeout: 30_000 },
    );
    const list = screen.getByRole("list", { name: /couldn.t be applied/ });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain("applicant.notes");
    expect(items[0]!.textContent).toMatch(/Arabic/);
  });

  it("emptyRequiredFields: every kind's empty, and nothing else", () => {
    const base = { widgetLabel: "", readOnly: false, required: true };
    const fields = [
      { ...base, name: "t", type: "text" as const },
      { ...base, name: "c", type: "checkbox" as const },
      { ...base, name: "r", type: "radio" as const },
      { ...base, name: "d", type: "dropdown" as const },
      { ...base, name: "l", type: "optionlist" as const },
      { ...base, name: "ro", type: "text" as const, readOnly: true },
      { ...base, name: "opt", type: "text" as const, required: false },
    ];
    expect(
      emptyRequiredFields(fields, {
        t: "  ",
        c: false,
        r: "",
        d: [],
        l: "",
        ro: "",
        opt: "",
      }),
    ).toEqual(["t", "c", "r", "d", "l"]);
    // Positive control: each filled, none named.
    expect(
      emptyRequiredFields(fields, {
        t: "x",
        c: true,
        r: "A",
        d: ["B"],
        l: "C",
      }),
    ).toEqual([]);
  });
});

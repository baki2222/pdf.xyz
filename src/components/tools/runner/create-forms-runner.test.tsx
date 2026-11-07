// @vitest-environment jsdom
/**
 * The Create Fillable Forms builder, driven the way a person drives it.
 *
 * Audit #39 (2026-11-06) found three things the card said that were not so:
 *  - the starter card sat at y = 700 whatever the page, so a landscape Letter
 *    or A5 PDF opened with a red "Field extends past page 1" and a disabled
 *    "Create form" before anything was touched;
 *  - Dropdown offered "Allow multiple selections", which set MultiSelect on a
 *    combo box: no viewer honours it, so the toggle did nothing;
 *  - a default typed while "Allow custom typing" was on survived the toggle
 *    going off, hidden behind a select reading "— None —", and blocked the
 *    build with "isn't one of the options" — choosing "— None —" fires no
 *    change, so the person was stuck.
 *
 * No module is mocked (see `src/tests/mock-isolation.test.ts`): a real PDF is
 * dropped, read by the real engine, and the card is judged on what it shows.
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { dropSheetsLive } from "@/tests/drop-sheets-live";
import { CreateFormsRunner } from "./create-forms-runner";
import { EDITOR_FIELD_LABEL } from "@/lib/pdf/editor/model";
import { EDITOR_FORMS_GROUP } from "@/lib/pdf/offered-kinds";
import { getToolBySlug } from "@/lib/tools";
import { getToolContent } from "@/lib/tools/content";
import { TOOL_GROUPS } from "./editor/toolbar";

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

async function pdfOfSize(size: [number, number]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage(size);
  return doc.save();
}

/** Drop a PDF of `size` into the runner and wait for the builder. */
async function openBuilder(size: [number, number]): Promise<void> {
  const bytes = await pdfOfSize(size);
  const { container } = render(withRouter(<CreateFormsRunner />));
  await dropSheetsLive(container);
  const picker = container.querySelector('input[type="file"]');
  expect(picker, "the runner offers a file picker").not.toBeNull();
  fireEvent.drop(picker!.closest("label")!, {
    dataTransfer: {
      files: [
        new File([bytes.slice().buffer as ArrayBuffer], "blank.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  await screen.findByRole(
    "button",
    { name: /create form/i },
    {
      timeout: 10_000,
    },
  );
}

const createButton = () => screen.getByRole("button", { name: /create form/i });
const isBlocked = (button: HTMLElement) =>
  button.hasAttribute("disabled") ||
  button.getAttribute("aria-disabled") === "true";

function chooseType(label: string) {
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: "Field type" })).getByRole(
      "radio",
      { name: label },
    ),
  );
}

describe(
  "Create Forms: the starter card fits the page it is on",
  { timeout: 30_000 },
  () => {
    it.each([
      ["landscape Letter", [792, 612]],
      ["A5", [420, 595]],
      ["portrait Letter (control)", [612, 792]],
    ] as const)("%s: no error and Create form is enabled", async (_, size) => {
      await openBuilder([size[0], size[1]]);
      expect(screen.queryByText(/extends past page/i)).toBeNull();
      expect(isBlocked(createButton())).toBe(false);
    });
  },
);

describe(
  "Create Forms: a dropdown is single-choice",
  { timeout: 30_000 },
  () => {
    it("Dropdown offers no multiple-selection toggle; List still does", async () => {
      await openBuilder([612, 792]);
      chooseType("Dropdown");
      expect(
        screen.queryByRole("checkbox", { name: /allow multiple selections/i }),
      ).toBeNull();
      chooseType("List");
      screen.getByRole("checkbox", { name: /allow multiple selections/i });
    });
  },
);

describe(
  "Create Forms: a hidden default never blocks the build",
  { timeout: 30_000 },
  () => {
    it("unticking custom typing clears a default that is not an option", async () => {
      await openBuilder([612, 792]);
      chooseType("Dropdown");
      fireEvent.change(screen.getByLabelText(/options/i), {
        target: { value: "A\nB" },
      });
      fireEvent.click(
        screen.getByRole("checkbox", { name: /allow custom typing/i }),
      );
      fireEvent.change(screen.getByLabelText(/default value/i), {
        target: { value: "Other" },
      });
      fireEvent.click(
        screen.getByRole("checkbox", { name: /allow custom typing/i }),
      );
      expect(screen.queryByText(/isn.t one of the options/i)).toBeNull();
      expect(isBlocked(createButton())).toBe(false);
    });

    it("switching to Radio with options already present clears a stale default", async () => {
      await openBuilder([612, 792]);
      chooseType("Dropdown");
      fireEvent.change(screen.getByLabelText(/options/i), {
        target: { value: "A\nB" },
      });
      fireEvent.click(
        screen.getByRole("checkbox", { name: /allow custom typing/i }),
      );
      fireEvent.change(screen.getByLabelText(/default value/i), {
        target: { value: "Other" },
      });
      chooseType("Radio");
      expect(screen.queryByText(/isn.t one of the options/i)).toBeNull();
      expect(isBlocked(createButton())).toBe(false);
    });

    it("control: a default that IS an option survives the same toggle", async () => {
      await openBuilder([612, 792]);
      chooseType("Dropdown");
      fireEvent.change(screen.getByLabelText(/options/i), {
        target: { value: "A\nB" },
      });
      fireEvent.click(
        screen.getByRole("checkbox", { name: /allow custom typing/i }),
      );
      fireEvent.change(screen.getByLabelText(/default value/i), {
        target: { value: "B" },
      });
      fireEvent.click(
        screen.getByRole("checkbox", { name: /allow custom typing/i }),
      );
      expect(
        (screen.getByLabelText(/default selection/i) as HTMLSelectElement)
          .value,
      ).toBe("B");
    });
  },
);

describe(
  "Create Forms: points to Edit PDF's drag-out form fields (audit create-forms#1)",
  { timeout: 30_000 },
  () => {
    // The page said there was "no canvas for dragging fields into place" and
    // "no signature field type", while Edit PDF's Forms group drags out every
    // field this builder makes plus a signature field. A visitor who wanted
    // either was never told where it was.
    const editPdf = getToolBySlug("edit-pdf")!;
    const signature = EDITOR_FIELD_LABEL.signature;

    it("the Forms group exists in the editor and holds a signature field", () => {
      const group = TOOL_GROUPS.find((g) => g.name === EDITOR_FORMS_GROUP);
      expect(
        group,
        `no "${EDITOR_FORMS_GROUP}" group in the toolbar`,
      ).toBeTruthy();
      expect(group!.tools).toContain("field-signature");
      expect(editPdf.processing).toBe("client");
    });

    it("the coordinate help links to Edit PDF, naming Forms and the signature field", async () => {
      await openBuilder([612, 792]);
      const link = screen.getByRole("link", { name: editPdf.name });
      expect(link.getAttribute("href")).toBe(`/tools/${editPdf.slug}`);
      const help = link.closest("div")!.textContent ?? "";
      expect(help).toContain(EDITOR_FORMS_GROUP);
      expect(help.toLowerCase()).toContain(signature.toLowerCase());
    });

    it("the tool page says the same, and no longer that no tool drags fields", () => {
      const content = getToolContent("create-forms")!;
      const text = [
        ...content.intro,
        ...content.faqs.map((f) => `${f.q} ${f.a}`),
      ].join(" ");
      expect(text).toContain(editPdf.name);
      expect(text).toContain(`its ${EDITOR_FORMS_GROUP} group`);
      expect(text.toLowerCase()).toContain(signature.toLowerCase());
    });
  },
);

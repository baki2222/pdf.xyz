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
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { inspectFormFields, type FormInspection } from "@/lib/pdf/forms";
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

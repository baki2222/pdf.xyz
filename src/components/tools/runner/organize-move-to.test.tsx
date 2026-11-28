// @vitest-environment jsdom
// @native-canvas
/**
 * Organize Pages' "Move to position…" (audit organize-pages#4, 2026-11-22).
 *
 * Pages moved one step at a time: a Move left / Move right button, a native
 * drag that touch browsers never fire, and Home / End only on a grabbed
 * handle. Taking page 80 to the front on a phone was 79 presses. Each tile
 * now has a Move to position action: type the position, press Enter.
 *
 * Judged on the downloaded file, through the runner a person uses: every
 * page of the fixture has its own width, so the saved order is read back
 * from the page sizes with no text extraction. No module is mocked.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PDFDocument } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { OrganizeRunner } from "./organize-runner";

const router = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};

function renderRunner(ui: ReactNode) {
  return render(
    <AppRouterContext.Provider value={router as never}>
      {ui}
    </AppRouterContext.Provider>,
  );
}

const PAGES = 6;
/** Page n (1-based) is 200 + 10n points wide: its width names it. */
const widthOf = (n: number) => 200 + 10 * n;

async function sizedPdf(): Promise<File> {
  const doc = await PDFDocument.create();
  for (let n = 1; n <= PAGES; n += 1) doc.addPage([widthOf(n), 400]);
  const bytes = await doc.save();
  return new File([bytes.slice()], "stack.pdf", { type: "application/pdf" });
}

let downloads: Blob[] = [];
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
beforeEach(() => {
  downloads = [];
  URL.createObjectURL = (blob: Blob | MediaSource) => {
    if (blob instanceof Blob && blob.type === "application/pdf")
      downloads.push(blob);
    return "blob:organize-move-to";
  };
  URL.revokeObjectURL = () => {};
});
afterEach(() => {
  cleanup();
  resetAnnouncer();
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

async function open() {
  const { container } = renderRunner(<OrganizeRunner />);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  fireEvent.change(input!, { target: { files: [await sizedPdf()] } });
  await screen.findByRole(
    "button",
    { name: `Move page ${PAGES} to position…` },
    { timeout: 10_000 },
  );
}

/** The tiles' names, in their order on screen. */
const tileOrder = () =>
  within(screen.getByRole("list", { name: /^Pages/ }))
    .getAllByRole("listitem")
    .map((li) => li.getAttribute("aria-label"));

/** Export, download, and read the saved order back from the page widths. */
async function savedOrder(): Promise<number[]> {
  fireEvent.click(screen.getByRole("button", { name: /apply & export/i }));
  fireEvent.click(
    await screen.findByRole(
      "button",
      { name: /download organized pdf/i },
      { timeout: 10_000 },
    ),
  );
  await waitFor(() => expect(downloads).toHaveLength(1));
  const doc = await PDFDocument.load(
    new Uint8Array(await downloads[0]!.arrayBuffer()),
  );
  return doc.getPages().map((p) => (p.getWidth() - 200) / 10);
}

describe("Organize Pages — Move to position", () => {
  it(
    "takes the last page to position 1 in one step, keeping the others in order",
    { timeout: 30_000 },
    async () => {
      await open();
      fireEvent.click(
        screen.getByRole("button", { name: `Move page ${PAGES} to position…` }),
      );
      const field = screen.getByLabelText(
        `New position for page ${PAGES}, 1 to ${PAGES}`,
      );
      // The field takes focus, so a keyboard or screen-reader user is in it.
      expect(document.activeElement).toBe(field);
      fireEvent.change(field, { target: { value: "1" } });
      fireEvent.submit(field.closest("form")!);

      expect(tileOrder()[0]).toBe(`Page ${PAGES}, position 1 of ${PAGES}`);
      expect(tileOrder()[1]).toBe(`Page 1, position 2 of ${PAGES}`);
      // Said to a screen reader, and focus goes back to the moved page.
      expect(
        screen
          .getAllByRole("status")
          .some((n) =>
            n.textContent?.includes(
              `Moved page ${PAGES} to position 1 of ${PAGES}`,
            ),
          ),
      ).toBe(true);
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole("button", {
            name: `Move page ${PAGES} to position…`,
          }),
        ),
      );

      expect(await savedOrder()).toEqual([6, 1, 2, 3, 4, 5]);
    },
  );

  it(
    "Escape closes the field without moving anything",
    { timeout: 30_000 },
    async () => {
      await open();
      const trigger = screen.getByRole("button", {
        name: "Move page 3 to position…",
      });
      fireEvent.click(trigger);
      const field = screen.getByLabelText(
        `New position for page 3, 1 to ${PAGES}`,
      );
      fireEvent.change(field, { target: { value: "1" } });
      fireEvent.keyDown(field, { key: "Escape" });
      expect(
        screen.queryByLabelText(`New position for page 3, 1 to ${PAGES}`),
      ).toBeNull();
      expect(tileOrder()[0]).toBe(`Page 1, position 1 of ${PAGES}`);
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: "Move page 3 to position…" }),
        ),
      );
    },
  );

  it(
    "refuses a position outside the document, and says the range",
    { timeout: 30_000 },
    async () => {
      await open();
      fireEvent.click(
        screen.getByRole("button", { name: "Move page 2 to position…" }),
      );
      const field = screen.getByLabelText(
        `New position for page 2, 1 to ${PAGES}`,
      );
      fireEvent.change(field, { target: { value: String(PAGES + 1) } });
      fireEvent.submit(field.closest("form")!);
      // Nothing moved, and the field is still open with the reason.
      expect(tileOrder()[1]).toBe(`Page 2, position 2 of ${PAGES}`);
      expect(
        screen.getByText(`Type a position from 1 to ${PAGES}.`),
      ).toBeInTheDocument();
    },
  );
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  BOOKLET_BACK_COVER_LABEL,
  BOOKLET_FLIPS,
  BOOKLET_RESULT_TITLE,
  BOOKLET_RUN_LABEL,
  bookletBackCoverBlocked,
} from "@/lib/pdf/booklet";
import { getToolBySlug } from "@/lib/tools";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { InToolPage } from "@/tests/in-tool-page";
import { BOOKLET_PREVIEW_SIDES } from "@/lib/pdf/booklet";
import { BookletEditor } from "./booklet-editor";
import { N_UP_RUN_LABEL } from "./n-up-editor";
import { NUpRunner } from "./n-up-runner";

/**
 * What a person using PDF Booklet Maker sees: the n-up runner switching to
 * the booklet editor on Booklet's page (and NOT on Multiple Pages per
 * Sheet's), the page-order preview, the back-cover checkbox's reason when it
 * is off, and the numbers the result states — from the real engine.
 */

afterEach(() => {
  cleanup();
  resetAnnouncer();
});

async function pagesPdf(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= count; i += 1)
    doc.addPage([300, 400]).drawText(`P${i}`, { x: 20, y: 360, font });
  return doc.save();
}

/** The checkbox, found by its label (its name also carries the hint). */
const backCoverBox = () =>
  screen.getByRole("checkbox", {
    name: new RegExp(`^${BOOKLET_BACK_COVER_LABEL}`),
  });

async function editor(count: number) {
  const bytes = await pagesPdf(count);
  const file = new File([new Uint8Array(bytes)], "zine.pdf", {
    type: "application/pdf",
  });
  render(
    <BookletEditor
      pdf={{
        file,
        bytes,
        pageCount: count,
        rotations: Array(count).fill(0),
        digitalSignatures: 0,
      }}
      onReset={() => {}}
    />,
  );
}

describe("the n-up runner on each page", () => {
  it("draws the booklet picker on Booklet's page", () => {
    render(
      <InToolPage tool={getToolBySlug("booklet-pdf")!}>
        <NUpRunner />
      </InToolPage>,
    );
    expect(screen.getByText(/booklet order/i)).toBeTruthy();
    expect(screen.queryByText(/laid out on sheets/i)).toBeNull();
  });

  it("control: draws Multiple Pages per Sheet's picker on its own page", () => {
    render(
      <InToolPage tool={getToolBySlug("n-up-pdf")!}>
        <NUpRunner />
      </InToolPage>,
    );
    expect(screen.getByText(/laid out on sheets/i)).toBeTruthy();
    expect(screen.queryByText(/booklet order/i)).toBeNull();
  });
});

describe("the booklet editor", () => {
  it("draws the labels the tool page quotes, as booklet.ts spells them", async () => {
    await editor(6);
    expect(backCoverBox()).toBeTruthy();
    expect(
      screen.getByRole("button", { name: BOOKLET_RUN_LABEL }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: BOOKLET_RUN_LABEL }));
    expect(
      (await screen.findByRole("heading", { name: BOOKLET_RESULT_TITLE }))
        .textContent,
    ).toBe(BOOKLET_RESULT_TITLE);
  });

  it("previews each side's pages, blanks named, from the same order the engine uses", async () => {
    await editor(6);
    const list = screen.getByRole("list", { name: /page order/i });
    const items = within(list)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items).toEqual([
      "Sheet 1 frontblank | 1",
      "Sheet 1 back2 | blank",
      "Sheet 2 front6 | 3",
      "Sheet 2 back4 | 5",
    ]);
    expect(screen.getByText(/6 pages \+ 2 blanks → 2 sheets/)).toBeTruthy();
    // The back cover moves the blanks inside.
    fireEvent.click(backCoverBox());
    expect(
      within(screen.getByRole("list", { name: /page order/i })).getAllByRole(
        "listitem",
      )[0]!.textContent,
    ).toBe("Sheet 1 front6 | 1");
  });

  it("collapses the preview past the first sides", async () => {
    await editor(17);
    const list = screen.getByRole("list", { name: /page order/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(
      BOOKLET_PREVIEW_SIDES,
    );
    expect(screen.getByText(/and 2 more sides/)).toBeTruthy();
  });

  it("turns the back cover off with its reason when there is nothing to move", async () => {
    await editor(8);
    const box = backCoverBox();
    expect(box.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(bookletBackCoverBlocked(8)!)).toBeTruthy();
    // A press does not tick it, and the order does not change.
    fireEvent.click(box);
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(
      within(screen.getByRole("list", { name: /page order/i })).getAllByRole(
        "listitem",
      )[0]!.textContent,
    ).toBe("Sheet 1 front8 | 1");
  });

  it("control: the back cover is on offer when blanks are added", async () => {
    await editor(7);
    const box = backCoverBox();
    expect(box.getAttribute("aria-disabled")).toBeNull();
  });

  // WAS "The 1 blank page go before your last page…" (review, 2026-11-10):
  // the verb did not follow the count.
  it("says where the blanks go in agreement with their count", async () => {
    await editor(7);
    expect(
      screen.getByText(
        "The blank page goes before your last page instead of after it.",
      ),
    ).toBeTruthy();
    cleanup();
    await editor(6);
    expect(
      screen.getByText(
        "The 2 blank pages go before your last page instead of after it.",
      ),
    ).toBeTruthy();
  });

  // WAS identical to an enabled box but for its hint, so on a phone (no
  // cursor) a tap on it just did nothing (review, 2026-11-10).
  it("an off back-cover box LOOKS off: muted label, faded box; control: an on-offer one does not", async () => {
    const look = () => {
      const box = backCoverBox();
      const label = box.closest("label")!;
      return {
        muted: label.className.includes("text-muted"),
        faded: box.className.includes("opacity-50"),
      };
    };
    await editor(8);
    expect(look()).toEqual({ muted: true, faded: true });
    cleanup();
    await editor(7);
    expect(look()).toEqual({ muted: false, faded: false });
  });

  // WAS the logical pair on both flips: on Long edge the PDF draws each back
  // turned, so a reader checking the file against the list saw the halves
  // swapped (review, 2026-11-10). booklet.test.ts holds bookletDrawnPair to
  // the file pdf.js reads back.
  it("lists each back as the PDF draws it on Long edge, and as laid out on Short edge", async () => {
    await editor(8);
    const items = () =>
      within(screen.getByRole("list", { name: /page order/i }))
        .getAllByRole("listitem")
        .map((li) => li.textContent);
    expect(items()).toEqual([
      "Sheet 1 front8 | 1",
      "Sheet 1 back2 | 7",
      "Sheet 2 front6 | 3",
      "Sheet 2 back4 | 5",
    ]);
    fireEvent.click(
      screen.getByRole("button", {
        name: BOOKLET_FLIPS.find((f) => f.id === "long")!.label,
      }),
    );
    expect(items()).toEqual([
      "Sheet 1 front8 | 1",
      "Sheet 1 back7 | 2 (upside down)",
      "Sheet 2 front6 | 3",
      "Sheet 2 back5 | 4 (upside down)",
    ]);
  });

  it("states the result's numbers, the flip and the size the pages are drawn at", async () => {
    await editor(6);
    fireEvent.click(
      screen.getByRole("button", {
        name: BOOKLET_FLIPS.find((f) => f.id === "long")!.label,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: BOOKLET_RUN_LABEL }));
    const panel = await screen.findByRole("group", {
      name: new RegExp(BOOKLET_RESULT_TITLE, "i"),
    });
    const text = panel.textContent ?? "";
    expect(text).toContain("6 pages + 2 blank pages on 2 sheets");
    expect(text).toContain("4 PDF pages");
    expect(text).toContain("flipping on the long edge");
    // 300 × 400 in half a landscape A4 sheet (420.9 × 595.3 pt): 140%.
    expect(text).toContain(
      `Pages are drawn at ${Math.round(Math.min(841.89 / 2 / 300, 595.28 / 400) * 100)}% of their size.`,
    );
    expect(text).not.toContain(N_UP_RUN_LABEL);
  });
});

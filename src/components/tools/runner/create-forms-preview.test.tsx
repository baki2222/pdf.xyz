// @vitest-environment jsdom
/**
 * Create Fillable Forms' page preview (backlog #17, 2026-11-17), driven
 * through the real runner: a real PDF is dropped, read by the real engine,
 * and the preview chunk is the one the runner loads.
 *
 * What is held, each against the CARD (the numbers the engine is handed),
 * never against the preview's own state:
 *  - every draft field on the shown page is drawn from its card's numbers,
 *    a radio group as its whole downward stack (an oracle written here, not
 *    the engine's `fieldBoxes`, so the two are compared, not copied);
 *  - the drawing follows the numbers as they change;
 *  - a click on the page, a drag and the arrow keys change the card's X/Y,
 *    and only the selected field's; a press the browser takes back (a swipe
 *    that scrolls) leaves them as they were;
 *  - the page shown is the selected card's, drawn the shape the sheet is
 *    (the fake renderer reads the page's own /Rotate and any override, so a
 *    preview that rendered a turned page unturned draws the wrong shape);
 *  - every box is a button named by its field's name and type.
 *
 * The renderer is swapped through `pageImageDeps`, the hook's own seam (a
 * `vi.mock` would leave modules cached against the stub for the next file),
 * and records what it was asked for.
 */
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { dropSheetsLive } from "@/tests/drop-sheets-live";
import { RADIO_STACK_GAP } from "@/lib/pdf/create-forms";
import { FIELD_TYPE_LABELS } from "@/lib/pdf/offered-kinds";
import { CreateFormsRunner } from "./create-forms-runner";
import { PREVIEW_INK } from "./create-forms-preview";
import { pageImageDeps } from "./use-page-image";

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

const asked: { index: number; options: Record<string, unknown> }[] = [];
const realRenderer = pageImageDeps.renderer;
beforeEach(() => {
  asked.length = 0;
  pageImageDeps.renderer = async () =>
    ({
      createThumbnailRenderer: async (
        bytes: Uint8Array,
        options: Record<string, unknown>,
      ) => {
        // Draws each page the shape the real renderer would: its MediaBox,
        // turned by `options.rotation` when one is given, else by the
        // page's own /Rotate. The shape rides in the URL, so a test can hold
        // the image against the sheet it is drawn on.
        const doc = await PDFDocument.load(bytes);
        return {
          numPages: doc.getPageCount(),
          renderPage: async (index: number) => {
            asked.push({ index, options });
            const page = doc.getPage(index);
            const turn =
              typeof options.rotation === "number"
                ? options.rotation
                : page.getRotation().angle;
            const { width, height } = page.getSize();
            const [w, h] =
              ((turn % 360) + 360) % 180 === 90
                ? [height, width]
                : [width, height];
            return {
              index,
              url: `blob:page-${index}-${w}x${h}`,
              width: 840,
              height: Math.round((840 * h) / w),
            };
          },
          destroy: async () => {},
        };
      },
    }) as unknown as typeof import("@/lib/pdf/render");
});
afterEach(() => {
  pageImageDeps.renderer = realRenderer;
});

/** Pages of these sizes; a third number is the page's own /Rotate. */
async function pdfOfSizes(
  sizes: ([number, number] | [number, number, number])[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const [w, h, turn] of sizes) {
    const page = doc.addPage([w, h]);
    if (turn) page.setRotation(degrees(turn));
  }
  return doc.save();
}

const SHEET_PX = 420;

/** Drop a PDF and wait for the builder AND its preview. */
async function openBuilder(
  sizes: Parameters<typeof pdfOfSizes>[0],
): Promise<HTMLElement> {
  const bytes = await pdfOfSizes(sizes);
  const { container } = render(withRouter(<CreateFormsRunner />));
  await dropSheetsLive(container);
  const picker = container.querySelector('input[type="file"]');
  fireEvent.drop(picker!.closest("label")!, {
    dataTransfer: {
      files: [
        new File([bytes.slice().buffer as ArrayBuffer], "blank.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  return sheet();
}

/** The sheet, with an on-screen size: 420 px wide at the page's own shape. */
async function sheet(): Promise<HTMLElement> {
  const el = await screen.findByTestId(
    "form-page-preview",
    {},
    { timeout: 10_000 },
  );
  el.getBoundingClientRect = () => {
    const [w, h] = el.style.aspectRatio.split("/").map(Number) as [
      number,
      number,
    ];
    const height = (SHEET_PX * h) / w;
    return {
      left: 0,
      top: 0,
      width: SHEET_PX,
      height,
      right: SHEET_PX,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return el;
}

const cards = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-field-card]"));

/** What a card says: the numbers the engine will be handed. */
function cardNumbers(card: HTMLElement) {
  const n = (label: RegExp) =>
    Number((within(card).getByLabelText(label) as HTMLInputElement).value);
  const radio = within(card).queryByLabelText(/^button w$/i) !== null;
  return {
    id: card.getAttribute("data-field-card")!,
    page: n(/^page$/i),
    x: n(/^x$/i),
    y: n(/^y$/i),
    width: n(radio ? /^button w$/i : /^width$/i),
    height: n(radio ? /^button h$/i : /^height$/i),
    options: radio
      ? (within(card).getByLabelText(/options/i) as HTMLTextAreaElement).value
          .split("\n")
          .filter((o) => o.trim())
      : null,
  };
}

/** The boxes a card asks for, written here (not the engine's fieldBoxes). */
function askedBoxes(c: ReturnType<typeof cardNumbers>) {
  if (!c.options) return [{ x: c.x, y: c.y, width: c.width, height: c.height }];
  return c.options.map((_, i) => ({
    x: c.x,
    y: c.y - i * (c.height + RADIO_STACK_GAP),
    width: c.width,
    height: c.height,
  }));
}

/** Each drawn box of field `id`, back in points of a page `size`. */
function drawn(id: string, size: { width: number; height: number }) {
  return Array.from(
    document.querySelectorAll<HTMLElement>(`[data-field-box][data-of="${id}"]`),
  ).map((el) => ({
    x: (parseFloat(el.style.left) / 100) * size.width,
    y: (parseFloat(el.style.bottom) / 100) * size.height,
    width: (parseFloat(el.style.width) / 100) * size.width,
    height: (parseFloat(el.style.height) / 100) * size.height,
  }));
}

function expectDrawnAsCards(size: { width: number; height: number }, page = 1) {
  let compared = 0;
  for (const card of cards()) {
    const c = cardNumbers(card);
    if (c.page !== page) {
      // A field on another page is not drawn on this one.
      expect(drawn(c.id, size), `${c.id} is on page ${c.page}`).toEqual([]);
      continue;
    }
    const want = askedBoxes(c);
    const got = drawn(c.id, size);
    expect(got.length, `boxes drawn for ${c.id}`).toBe(want.length);
    got.forEach((box, i) => {
      for (const k of ["x", "y", "width", "height"] as const)
        expect(box[k]).toBeCloseTo(want[i]![k], 6);
      compared += 1;
    });
  }
  return compared;
}

function addRadioField() {
  fireEvent.click(screen.getByRole("button", { name: /add field/i }));
  const card = cards().at(-1)!;
  fireEvent.click(
    within(
      within(card).getByRole("radiogroup", { name: "Field type" }),
    ).getByRole("radio", { name: "Radio" }),
  );
  fireEvent.change(within(card).getByLabelText(/options/i), {
    target: { value: "Yes\nNo\nMaybe" },
  });
  return card;
}

const setNumber = (card: HTMLElement, label: RegExp, value: number) =>
  fireEvent.change(within(card).getByLabelText(label), {
    target: { value: String(value) },
  });

const LETTER: [number, number] = [612, 792];
const LETTER_SIZE = { width: 612, height: 792 };

describe(
  "Create Forms: the page preview draws what the cards say (backlog #17)",
  { timeout: 30_000 },
  () => {
    it("every field is drawn from its card's numbers, a radio group as its whole downward stack", async () => {
      await openBuilder([LETTER]);
      addRadioField();
      // Health: two cards, and 1 + 3 boxes compared — a preview that drew
      // nothing would compare nothing and pass.
      expect(cards()).toHaveLength(2);
      expect(expectDrawnAsCards(LETTER_SIZE)).toBe(4);
    });

    it("the drawing follows the numbers as they change", async () => {
      await openBuilder([LETTER]);
      const [card] = cards();
      setNumber(card!, /^x$/i, 150);
      setNumber(card!, /^y$/i, 420);
      setNumber(card!, /^width$/i, 90);
      expect(cardNumbers(card!)).toMatchObject({ x: 150, y: 420, width: 90 });
      expect(expectDrawnAsCards(LETTER_SIZE)).toBe(1);
    });

    it("a click on the page puts the selected field's bottom-left corner there; the other field stays", async () => {
      const el = await openBuilder([LETTER]);
      const radio = addRadioField();
      const first = cardNumbers(cards()[0]!);
      const radioBefore = cardNumbers(radio);
      // Select the text field by focusing its card.
      fireEvent.focus(within(cards()[0]!).getByLabelText(/^x$/i));
      const height = (SHEET_PX * 792) / 612;
      fireEvent.pointerDown(el, {
        pointerId: 1,
        button: 0,
        clientX: 210,
        clientY: 100,
      });
      fireEvent.pointerUp(el, {
        pointerId: 1,
        button: 0,
        clientX: 210,
        clientY: 100,
      });
      expect(cardNumbers(cards()[0]!)).toMatchObject({
        x: Math.round((210 / SHEET_PX) * 612),
        y: Math.round((1 - 100 / height) * 792),
      });
      // Control: the unselected radio group did not move.
      expect(cardNumbers(radio)).toEqual(radioBefore);
      // Now the radio group: a click near the bottom holds its LOWEST
      // button on the page, so its own Y is two buttons up.
      fireEvent.focus(within(radio).getByLabelText(/^x$/i));
      fireEvent.pointerDown(el, {
        pointerId: 2,
        button: 0,
        clientX: 50,
        clientY: height - 2,
      });
      fireEvent.pointerUp(el, {
        pointerId: 2,
        button: 0,
        clientX: 50,
        clientY: height - 2,
      });
      const after = cardNumbers(radio);
      expect(after.x).toBe(Math.round((50 / SHEET_PX) * 612));
      expect(after.y).toBe(2 * (after.height + RADIO_STACK_GAP));
      expect(after.y).not.toBe(radioBefore.y);
      expect(cardNumbers(cards()[0]!).x).not.toBe(first.x);
      expect(expectDrawnAsCards(LETTER_SIZE)).toBe(4);
    });

    it("a box drags by the distance the pointer moved, in points of the page", async () => {
      await openBuilder([LETTER]);
      const card = cards()[0]!;
      const before = cardNumbers(card);
      const button = screen.getByRole("button", {
        name: /^field_1, Text field/,
      });
      const height = (SHEET_PX * 792) / 612;
      const at = { pointerId: 1, button: 0, pointerType: "mouse" };
      fireEvent.pointerDown(button, { ...at, clientX: 100, clientY: 100 });
      // A 2 px wobble is a press, not a drag.
      fireEvent.pointerMove(button, { ...at, clientX: 102, clientY: 100 });
      expect(cardNumbers(card).x).toBe(before.x);
      fireEvent.pointerMove(button, { ...at, clientX: 142, clientY: 140 });
      fireEvent.pointerUp(button, { ...at, clientX: 142, clientY: 140 });
      expect(cardNumbers(card)).toMatchObject({
        x: Math.round(before.x + (42 / SHEET_PX) * 612),
        y: Math.round(before.y - (40 / height) * 792),
      });
      expect(expectDrawnAsCards(LETTER_SIZE)).toBe(1);
    });

    it("a finger that swipes from the page to scroll it leaves the field where it was", async () => {
      const el = await openBuilder([LETTER]);
      const card = cards()[0]!;
      fireEvent.focus(within(card).getByLabelText(/^x$/i));
      const before = cardNumbers(card);
      const touch = { pointerId: 7, button: 0, pointerType: "touch" };
      fireEvent.pointerDown(el, { ...touch, clientX: 336, clientY: 400 });
      fireEvent.pointerMove(el, { ...touch, clientX: 336, clientY: 300 });
      // Health: the press DID move the field, so what follows is a restore
      // and not a press that never landed.
      expect(cardNumbers(card)).not.toEqual(before);
      // The browser takes the gesture as a scroll.
      fireEvent.pointerCancel(el, { ...touch, clientX: 336, clientY: 300 });
      expect(cardNumbers(card)).toEqual(before);
      expect(expectDrawnAsCards(LETTER_SIZE)).toBe(1);
      // Control: a cancel of some OTHER pointer restores nothing.
      fireEvent.pointerDown(el, { ...touch, clientX: 210, clientY: 100 });
      const placed = cardNumbers(card);
      expect(placed).not.toEqual(before);
      fireEvent.pointerCancel(el, { ...touch, pointerId: 8 });
      expect(cardNumbers(card)).toEqual(placed);
      fireEvent.pointerUp(el, { ...touch, clientX: 210, clientY: 100 });
      expect(cardNumbers(card)).toEqual(placed);
    });

    it("a selected box moves with the arrow keys, 1 pt and 10 pt with Shift, never off the page", async () => {
      await openBuilder([LETTER]);
      const card = cards()[0]!;
      const before = cardNumbers(card);
      const button = () =>
        screen.getByRole("button", { name: /^field_1, Text field/ });
      fireEvent.keyDown(button(), { key: "ArrowRight" });
      fireEvent.keyDown(button(), { key: "ArrowUp", shiftKey: true });
      expect(cardNumbers(card)).toMatchObject({
        x: before.x + 1,
        y: before.y + 10,
      });
      // The name follows the numbers, so a screen reader hears where it is.
      expect(button().getAttribute("aria-label")).toBe(
        `field_1, ${FIELD_TYPE_LABELS.text}, X ${before.x + 1}, Y ${before.y + 10}`,
      );
      // Down and Left, each in its own direction.
      fireEvent.keyDown(button(), { key: "ArrowDown" });
      fireEvent.keyDown(button(), { key: "ArrowLeft", shiftKey: true });
      expect(cardNumbers(card)).toMatchObject({
        x: before.x + 1 - 10,
        y: before.y + 10 - 1,
      });
      // Held on the page at the bottom-left corner...
      setNumber(card, /^x$/i, 3);
      setNumber(card, /^y$/i, 4);
      fireEvent.keyDown(button(), { key: "ArrowLeft", shiftKey: true });
      fireEvent.keyDown(button(), { key: "ArrowDown", shiftKey: true });
      expect(cardNumbers(card)).toMatchObject({ x: 0, y: 0 });
      // ...and at the right.
      setNumber(card, /^x$/i, 612 - 200);
      fireEvent.keyDown(button(), { key: "ArrowRight", shiftKey: true });
      expect(cardNumbers(card).x).toBe(612 - 200);
      // Control: a key that is not an arrow changes nothing.
      fireEvent.keyDown(button(), { key: "a" });
      expect(cardNumbers(card).x).toBe(612 - 200);
    });

    it("shows the selected card's page, drawn the shape it is displayed, and names every box by field and type", async () => {
      // Page 2 is a portrait page turned a quarter by its own /Rotate: it
      // is DISPLAYED landscape, and only a render that honours the /Rotate
      // is that shape.
      const el = await openBuilder([LETTER, [612, 792, 90]]);
      expect(el.style.aspectRatio.replace(/\s/g, "")).toBe("612/792");
      const radio = addRadioField();
      setNumber(radio, /^page$/i, 2);
      fireEvent.focus(within(radio).getByLabelText(/^x$/i));
      await act(async () => {});
      expect(
        screen.getByText(/^Showing page 2, where field_2 is$/),
      ).toBeTruthy();
      const turned = await sheet();
      expect(turned.style.aspectRatio.replace(/\s/g, "")).toBe("792/612");
      // The renderer was asked for page 2 (index 1), and the image drawn is
      // the shape of the sheet it sits on (the property; the e2e spec holds
      // the real render's naturalWidth/naturalHeight to the same).
      expect(asked.some((a) => a.index === 1)).toBe(true);
      await act(async () => {});
      const src = turned.querySelector("img")?.getAttribute("src") ?? "";
      const shape = /^blob:page-1-(\d+)x(\d+)$/.exec(src);
      expect(shape, `image src ${src}`).toBeTruthy();
      expect(`${shape![1]}/${shape![2]}`).toBe("792/612");
      expect(asked.every((a) => a.options.orientation === "displayed")).toBe(
        true,
      );
      // Only page 2's field is drawn, and it is named by its name and type.
      expect(
        document.querySelectorAll("[data-field-box][data-of='f1']"),
      ).toHaveLength(0);
      expect(
        screen.getByRole("button", {
          name: new RegExp(
            `^field_2, ${FIELD_TYPE_LABELS.radio}, X \\d+, Y \\d+$`,
          ),
        }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(expectDrawnAsCards({ width: 792, height: 612 }, 2)).toBe(3);
    });

    it("the ink on the white page is at least 4.5:1, all three colours", () => {
      const lum = (hex: string) => {
        const [r, g, b] = [1, 3, 5].map((i) => {
          const c = parseInt(hex.slice(i, i + 2), 16) / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        }) as [number, number, number];
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratios = Object.values(PREVIEW_INK).map(
        (ink) => (1 + 0.05) / (lum(ink) + 0.05),
      );
      // Find fields' suggestions (S2) are the third ink.
      expect(Object.keys(PREVIEW_INK)).toEqual([
        "selected",
        "other",
        "proposed",
      ]);
      expect(ratios).toHaveLength(3);
      for (const r of ratios) expect(r).toBeGreaterThanOrEqual(4.5);
      // Positive control: a pale ink fails the same computation.
      expect((1 + 0.05) / (lum("#9ca3af") + 0.05)).toBeLessThan(4.5);
    });
  },
);

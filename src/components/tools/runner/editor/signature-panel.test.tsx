// @vitest-environment jsdom
/**
 * Audit #50 (sign-pdf#7, 2026-11-06): with "Save for next time" ticked and a
 * browser that would not store it, "Use signature" closed the panel with no
 * word, and a thumbnail of the unsaved signature could show until reload.
 * The panel now passes a notice with the signature, which the editor says.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  SAVED_SIGNATURES_KEY,
  saveSignature,
} from "@/lib/pdf/editor/saved-signatures";
import { SIGNATURE_INKS } from "@/lib/pdf/editor/signature-ink";
import { SignaturePanel } from "./signature-panel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

/*
 * ASYNC SINCE 2026-11-09 (audit sign-pdf#1): the Type tab now opens on a
 * handwriting style, and "Use signature" waits for that face's widths before
 * handing the signature over (so the placed box is as wide as the name will
 * be in the file). These tests wait for the hand-over instead of reading it
 * synchronously; what they assert is unchanged.
 */
async function signTyped(remember: boolean) {
  const onReady = vi.fn();
  render(<SignaturePanel onReady={onReady} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: "Ada Lovelace" },
  });
  if (remember) fireEvent.click(screen.getByLabelText("Save for next time"));
  fireEvent.click(screen.getByRole("button", { name: "Use signature" }));
  await waitFor(() => expect(onReady).toHaveBeenCalled(), { timeout: 20_000 });
  return onReady;
}

describe("SignaturePanel — Save for next time", () => {
  it("control: a save that works passes no notice and is stored", async () => {
    const onReady = await signTyped(true);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0]![1]).toBeUndefined();
    expect(localStorage.getItem(SAVED_SIGNATURES_KEY)).toContain(
      "Ada Lovelace",
    );
  });

  it("a browser that refuses the save says so, and the signature is still used", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    const onReady = await signTyped(true);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0]![0]).toMatchObject({
      kind: "typed",
      text: "Ada Lovelace",
    });
    expect(onReady.mock.calls[0]![1]).toMatch(/couldn.t be saved/i);
  });

  it("control: nothing is said when saving was not asked for", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    const onReady = await signTyped(false);
    expect(onReady.mock.calls[0]![1]).toBeUndefined();
  });
});

/*
 * Audit sign-pdf#2 (2026-11-06): no ink colour could be chosen. The panel
 * offers the palette's swatches for Draw and Type; a typed signature carries
 * the chosen ink to the editor, and a saved one keeps it.
 */
describe("SignaturePanel — ink colour", () => {
  it("a typed signature carries the chosen ink, and keeps it when saved", async () => {
    const onReady = vi.fn();
    render(<SignaturePanel onReady={onReady} onClose={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Ink colour" });
    const blue = SIGNATURE_INKS.find((i) => i.id === "blue")!;
    const swatch = within(group).getByRole("radio", { name: blue.label });
    expect(swatch.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(swatch);
    expect(swatch.getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.click(screen.getByLabelText("Save for next time"));
    fireEvent.click(screen.getByRole("button", { name: "Use signature" }));
    await waitFor(() => expect(onReady).toHaveBeenCalled(), {
      timeout: 20_000,
    });
    expect(onReady.mock.calls[0]![0]).toMatchObject({
      kind: "typed",
      color: blue.hex,
    });
    const stored = JSON.parse(localStorage.getItem(SAVED_SIGNATURES_KEY)!);
    expect(stored[0]).toMatchObject({ kind: "typed", color: blue.hex });
  });

  it("control: left alone, the ink is the palette's first, black", async () => {
    const onReady = await signTyped(false);
    expect(onReady.mock.calls[0]![0]).toMatchObject({
      color: SIGNATURE_INKS[0]!.hex,
    });
  });

  it("every swatch is reachable by name and at least 44px tall", () => {
    render(<SignaturePanel onReady={() => {}} onClose={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Ink colour" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual(
      SIGNATURE_INKS.map((i) => i.label),
    );
    for (const r of radios) expect(r.className).toMatch(/\bh-11\b/);
  });

  // Review, 2026-11-08: each swatch was its own tab stop and arrows did
  // nothing — not what a radiogroup promises a keyboard or screen-reader
  // user. Now one tab stop (the checked swatch); arrows move and select.
  it("is one tab stop, and the arrow keys move the choice, wrapping", () => {
    render(<SignaturePanel onReady={() => {}} onClose={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Ink colour" });
    const radios = within(group).getAllByRole("radio");
    const tabbable = () =>
      radios.filter((r) => r.getAttribute("tabindex") !== "-1");
    const checked = () =>
      radios.find((r) => r.getAttribute("aria-checked") === "true");
    expect(tabbable()).toEqual([radios[0]]);
    expect(checked()).toBe(radios[0]);

    fireEvent.keyDown(radios[0]!, { key: "ArrowRight" });
    expect(checked()).toBe(radios[1]);
    expect(document.activeElement).toBe(radios[1]);
    expect(tabbable()).toEqual([radios[1]]);

    fireEvent.keyDown(radios[1]!, { key: "ArrowLeft" });
    fireEvent.keyDown(radios[0]!, { key: "ArrowLeft" });
    expect(checked()).toBe(radios.at(-1));
    expect(document.activeElement).toBe(radios.at(-1));
    fireEvent.keyDown(radios.at(-1)!, { key: "ArrowDown" });
    expect(checked()).toBe(radios[0]);
  });
});

/*
 * Lane D's axe sweep (2026-11-18, e2e/axe.spec.ts KNOWN_OPEN, now emptied):
 * in dark mode the style previews drew the name in the chosen ink straight on
 * the dark panel, black (#0f172a) at 1.21:1. An ink is the colour that lands
 * on a WHITE page, so every preview drawn in one now sits on paper, a white
 * chip, in both schemes; and every ink clears 4.5:1 on that paper.
 */
const PAPER = "rgb(255, 255, 255)";

function rgbOf(hex: string): string {
  const n = Number.parseInt(hex.replace(/^#/, ""), 16);
  return `rgb(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff})`;
}

/** WCAG 2.x relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.replace(/^#/, ""), 16);
  const [r, g, b] = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Every element whose own inline colour is `hex`, with the background it sits on. */
function inkedElements(root: HTMLElement, hex: string) {
  const want = rgbOf(hex);
  return Array.from(root.querySelectorAll<HTMLElement>("*"))
    .filter((el) => el.style.color === want)
    .map((el) => {
      let at: HTMLElement | null = el;
      while (at && !at.style.backgroundColor) at = at.parentElement;
      return { el, background: at?.style.backgroundColor ?? "" };
    });
}

describe("SignaturePanel — ink previews sit on paper", () => {
  it("health: the contrast helper gives black on white about 21:1, and white on white 1:1", () => {
    expect(contrast("#000000", "#ffffff")).toBeGreaterThan(20.9);
    expect(contrast("#000000", "#ffffff")).toBeLessThan(21.1);
    expect(contrast("#0f172a", "#ffffff")).toBeGreaterThan(17);
    expect(contrast("#ffffff", "#ffffff")).toBe(1);
  });

  it.each(SIGNATURE_INKS.map((i) => [i.id, i.hex] as const))(
    "%s (%s) clears 4.5:1 on the paper",
    (_id, hex) => {
      expect(contrast(hex, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(SIGNATURE_INKS.map((i) => [i.id, i.label, i.hex] as const))(
    "%s: every style preview, the name preview and a saved typed signature are drawn on paper",
    (_id, label, hex) => {
      saveSignature({
        kind: "typed",
        text: "Saved Name",
        style: "print",
        color: hex,
      });
      const { container } = render(
        <SignaturePanel onReady={() => {}} onClose={() => {}} />,
      );
      const group = screen.getByRole("radiogroup", { name: "Ink colour" });
      fireEvent.click(within(group).getByRole("radio", { name: label }));
      fireEvent.change(screen.getByLabelText("Your name"), {
        target: { value: "Ada Lovelace" },
      });
      const inked = inkedElements(container, hex);
      // Positive control on the corpus: one per style tile, the big name
      // preview, and the saved thumbnail. A shrunken set passes vacuously.
      const styles = screen
        .getByRole("radiogroup", { name: "Style" })
        .querySelectorAll('[role="radio"]');
      expect(styles.length).toBeGreaterThan(1);
      expect(inked.length).toBe(styles.length + 2);
      expect(
        container.querySelector("[data-signature-preview]")?.textContent,
      ).toBe("Ada Lovelace");
      for (const { el, background } of inked)
        expect(
          { text: el.textContent, background },
          `${el.textContent} in ${hex}`,
        ).toEqual({ text: el.textContent, background: PAPER });
    },
  );

  it("a typed signature saved before inks existed previews in black, on paper", () => {
    saveSignature({ kind: "typed", text: "Old Name", style: "print" });
    render(<SignaturePanel onReady={() => {}} onClose={() => {}} />);
    const thumb = screen.getByText("Old Name");
    expect(thumb.style.color).toBe(rgbOf(SIGNATURE_INKS[0]!.hex));
    expect(thumb.style.backgroundColor).toBe(PAPER);
  });
});

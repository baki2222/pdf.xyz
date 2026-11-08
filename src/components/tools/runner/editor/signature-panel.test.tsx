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
  within,
} from "@testing-library/react";
import { SAVED_SIGNATURES_KEY } from "@/lib/pdf/editor/saved-signatures";
import { SIGNATURE_INKS } from "@/lib/pdf/editor/signature-ink";
import { SignaturePanel } from "./signature-panel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

function signTyped(remember: boolean) {
  const onReady = vi.fn();
  render(<SignaturePanel onReady={onReady} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: "Ada Lovelace" },
  });
  if (remember) fireEvent.click(screen.getByLabelText("Save for next time"));
  fireEvent.click(screen.getByRole("button", { name: "Use signature" }));
  return onReady;
}

describe("SignaturePanel — Save for next time", () => {
  it("control: a save that works passes no notice and is stored", () => {
    const onReady = signTyped(true);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0]![1]).toBeUndefined();
    expect(localStorage.getItem(SAVED_SIGNATURES_KEY)).toContain(
      "Ada Lovelace",
    );
  });

  it("a browser that refuses the save says so, and the signature is still used", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    const onReady = signTyped(true);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0]![0]).toMatchObject({
      kind: "typed",
      text: "Ada Lovelace",
    });
    expect(onReady.mock.calls[0]![1]).toMatch(/couldn.t be saved/i);
  });

  it("control: nothing is said when saving was not asked for", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    const onReady = signTyped(false);
    expect(onReady.mock.calls[0]![1]).toBeUndefined();
  });
});

/*
 * Audit sign-pdf#2 (2026-11-06): no ink colour could be chosen. The panel
 * offers the palette's swatches for Draw and Type; a typed signature carries
 * the chosen ink to the editor, and a saved one keeps it.
 */
describe("SignaturePanel — ink colour", () => {
  it("a typed signature carries the chosen ink, and keeps it when saved", () => {
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
    expect(onReady.mock.calls[0]![0]).toMatchObject({
      kind: "typed",
      color: blue.hex,
    });
    const stored = JSON.parse(localStorage.getItem(SAVED_SIGNATURES_KEY)!);
    expect(stored[0]).toMatchObject({ kind: "typed", color: blue.hex });
  });

  it("control: left alone, the ink is the palette's first, black", () => {
    const onReady = signTyped(false);
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

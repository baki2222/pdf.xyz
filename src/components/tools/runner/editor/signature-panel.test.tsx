// @vitest-environment jsdom
/**
 * Audit #50 (sign-pdf#7, 2026-11-06): with "Save for next time" ticked and a
 * browser that would not store it, "Use signature" closed the panel with no
 * word, and a thumbnail of the unsaved signature could show until reload.
 * The panel now passes a notice with the signature, which the editor says.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SAVED_SIGNATURES_KEY } from "@/lib/pdf/editor/saved-signatures";
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

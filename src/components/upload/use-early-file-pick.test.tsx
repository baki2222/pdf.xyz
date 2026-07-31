// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { renderHook } from "@testing-library/react";
import { useEarlyFilePick } from "./use-early-file-pick";

/**
 * A file input holding `files`, as one does after the user picks something.
 * jsdom has no `DataTransfer` and `files`/`value` are getter-only, so we define
 * an array-like list on the instance — enough for the read-and-clear the hook
 * does, and clearing `value` empties the list exactly as a real input would.
 *
 * The element is deliberately *not* rendered by React: react-dom installs its
 * own `value` tracker on inputs it owns, which would shadow this shim.
 */
function inputHolding(...names: string[]): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  const files = names.map(
    (name) => new File([new Uint8Array([1, 2, 3])], name, { type: "application/pdf" }),
  );
  let current: File[] = files;
  Object.defineProperty(input, "files", {
    configurable: true,
    get: () =>
      ({
        ...current,
        length: current.length,
        item: (i: number) => current[i] ?? null,
      }) as unknown as FileList,
  });
  Object.defineProperty(input, "value", {
    configurable: true,
    get: () => (current[0] ? `C:\\fakepath\\${current[0].name}` : ""),
    set: () => {
      current = [];
    },
  });
  return input;
}

describe("useEarlyFilePick", () => {
  it("adopts a file that was chosen before React attached its listener", () => {
    const emit = vi.fn();
    const ref = createRef<HTMLInputElement>();
    ref.current = inputHolding("spin.pdf");

    renderHook(() => useEarlyFilePick(ref, emit));

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]?.[0]?.name).toBe("spin.pdf");
  });

  it("clears the input so the same file can be picked again later", () => {
    const ref = createRef<HTMLInputElement>();
    ref.current = inputHolding("spin.pdf");

    renderHook(() => useEarlyFilePick(ref, vi.fn()));

    expect(ref.current.value).toBe("");
    expect(ref.current.files?.length).toBe(0);
  });

  it("adopts every file when the zone accepts more than one", () => {
    const emit = vi.fn();
    const ref = createRef<HTMLInputElement>();
    ref.current = inputHolding("a.pdf", "b.pdf");

    renderHook(() => useEarlyFilePick(ref, emit));

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("stays silent when nothing was picked before hydration", () => {
    const emit = vi.fn();
    const ref = createRef<HTMLInputElement>();
    ref.current = inputHolding();

    renderHook(() => useEarlyFilePick(ref, emit));

    expect(emit).not.toHaveBeenCalled();
  });

  it("stays silent when the input never mounted", () => {
    const emit = vi.fn();
    renderHook(() => useEarlyFilePick(createRef<HTMLInputElement>(), emit));

    expect(emit).not.toHaveBeenCalled();
  });

  it("looks exactly once, even as callers pass a new handler each render", () => {
    const emit = vi.fn();
    const ref = createRef<HTMLInputElement>();
    ref.current = inputHolding("spin.pdf");

    // Our callers pass inline arrows, so `emit` changes identity every render;
    // the adopt pass must not re-run and double-report the pick.
    const { rerender } = renderHook(
      ({ handler }) => useEarlyFilePick(ref, handler),
      { initialProps: { handler: (list: FileList | null) => emit(list) } },
    );
    rerender({ handler: (list: FileList | null) => emit(list) });
    rerender({ handler: (list: FileList | null) => emit(list) });

    expect(emit).toHaveBeenCalledTimes(1);
  });
});
